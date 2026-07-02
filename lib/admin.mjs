#!/usr/bin/env node
// =============================================================================
// admin.mjs — deterministische kern voor de vink-plugin.
//
// Principe (overgenomen uit Vink): "AI bepaalt WAT, deterministische code bepaalt HOE."
// Alle harde correctheid (factuurnummer, BTW-rekenwerk, koersconversie, PDF-render,
// CSV-I/O) zit HIER, zodat de skills (markdown) alleen hoeven te orkestreren.
//
// Subcommando's:
//   next-invoice-number                 -> volgend YYYY-NNNN op basis van invoices.csv
//   fx <CUR> <YYYY-MM-DD>               -> ECB-dagkoers (frankfurter.app); print {rate, rate_date}
//   compute-invoice <invoice.json>      -> herberekent regels/subtotaal/BTW/totaal; print JSON (preview)
//   render-invoice <invoice.json> <out.pdf>   -> factuur-PDF via headless Chrome
//   record-invoice <invoice.json> <out.pdf>   -> compute + due_date + PDF + invoices.csv + invoice_items.csv
//   dashboard                           -> stand van zaken (openstaand/omzet/kosten/deadline); print JSON
//   render-dashboard <dashboard.json> <out.html>  -> HTML-dashboard (scherm, geen PDF)
//   aangifte <YYYY-QN>                  -> berekent alle rubrieken uit CSV's; print JSON
//   render-aangifte <aangifte.json> <out.pdf> -> aangifte-PDF via headless Chrome
//   record-aangifte <aangifte.json> <out.pdf> -> PDF + aangiftes.csv-rij uit de berekende JSON
//   append <csvfile> <row.json>         -> veilige CSV-append (quoting + header-aanmaak)
//   mark-paid <number> [YYYY-MM-DD]     -> zet factuur op status=paid + paid_at (default vandaag)
//
// Geldhelpers (round2/formatCurrency/formatDate) zijn ports van vink-app/src/lib/formatting.ts.
// VAT-routing is een port van calculateBtw() uit vink-app/src/lib/btw.ts.
// =============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// CODE_ROOT = waar deze code/plugin staat (templates, rules horen hierbij; updaten mee).
// WORK_DIR  = waar de administratie van de gebruiker staat = de map waar Claude Code draait.
//             Als plugin leeft de code in ~/.claude/plugins/..., maar de data (CSV's, PDF's)
//             moet in de eigen map van de gebruiker blijven — dus die hangt aan de cwd, niet
//             aan CODE_ROOT. Override desnoods met ADMIN_DATA_DIR.
// Bij niet-plugin gebruik (code en data in dezelfde map) vallen beide gewoon samen.
const CODE_ROOT = path.dirname(__dirname)
const WORK_DIR = process.env.ADMIN_DATA_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd()
const DATA = path.join(WORK_DIR, 'data')
const TEMPLATES = path.join(CODE_ROOT, 'templates')

// Pad naar Chrome/Chromium voor de PDF-render (headless). Override met de env-var
// ADMIN_CHROME als Chrome ergens anders staat of je Chromium/Brave/Edge gebruikt.
const CHROME = process.env.ADMIN_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// EU BTW-prefixen (zonder NL) — in sync met EU_COUNTRY_PREFIXES in vink btw.ts.
const EU_COUNTRY_PREFIXES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES',
  'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]

// Categorieën waar BTW NIET aftrekbaar is (vink csv.ts NON_DEDUCTIBLE_CATEGORIES).
const NON_DEDUCTIBLE_CATEGORIES = ['food_drinks', 'insurance']

const UNIT_LABELS = { hours: 'Uren', pieces: 'Stuks', days: 'Dagen', months: 'Maanden', times: 'Keer' }

// Aangifte-deadlines per kwartaal (vink btw.ts DEADLINE_DATES).
const DEADLINES = { 1: '30 april', 2: '31 juli', 3: '31 oktober', 4: '31 januari' }
// Zelfde deadlines als MM-DD, voor het deterministisch rekenen met resterende dagen (dashboard).
const DEADLINE_MMDD = { 1: '04-30', 2: '07-31', 3: '10-31', 4: '01-31' }

// ---- Geldhelpers (port van formatting.ts) ----

function round2(n) { return Math.round(n * 100) / 100 }

function formatCurrency(amount, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2).replace('.', ',')}`
  }
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-')
  return `${day}-${month}-${year}`
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ---- CSV (robuuste mini-parser/serializer) ----

function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else { field += c }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* skip */ }
      else field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => !(r.length === 1 && r[0] === ''))
}

function readCsvObjects(file) {
  if (!fs.existsSync(file)) return []
  const rows = parseCsv(fs.readFileSync(file, 'utf8'))
  if (rows.length === 0) return []
  const header = rows[0]
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function appendCsv(file, rowObj) {
  let header
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim().length > 0) {
    header = parseCsv(fs.readFileSync(file, 'utf8'))[0]
  } else {
    header = Object.keys(rowObj)
    fs.writeFileSync(file, header.map(csvCell).join(',') + '\n')
  }
  const line = header.map(h => csvCell(rowObj[h])).join(',')
  fs.appendFileSync(file, line + '\n')
}

// Herschrijf een hele CSV (header + rijen) atomisch via temp-file + rename.
// Nodig voor het bewerken van een bestaande rij (mark-paid) — append kan dat niet.
function rewriteCsv(file, header, objs) {
  const out = [header.map(csvCell).join(',')]
  for (const o of objs) out.push(header.map(h => csvCell(o[h] ?? '')).join(','))
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, out.join('\n') + '\n')
  fs.renameSync(tmp, file)
}

// ---- Invoice numbering (port van nextInvoiceNumberCounter / generateInvoiceNumber) ----

function nextInvoiceNumber() {
  const invoices = readCsvObjects(path.join(DATA, 'invoices.csv'))
  const pattern = /^\d{4}[-/]?(\d{1,4})$/
  const counters = invoices
    .map(inv => (inv.number || '').match(pattern))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10))
  const counter = counters.length === 0 ? 1 : Math.max(...counters) + 1
  const year = new Date().getFullYear()
  return `${year}-${String(counter).padStart(4, '0')}`
}

// ---- Factuur op betaald zetten (status -> paid + paid_at) ----

function todayISO() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Datum + n dagen, deterministisch in UTC (geen tijdzone-verschuivingen, correcte maandgrenzen).
// Gebruikt voor de vervaldatum — datumrekenen hoort in code, niet in het hoofd van de AI.
function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + Number(days))
  const p = n => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

// Aantal hele dagen tussen twee ISO-datums (toISO − fromISO), deterministisch in UTC.
// Positief = toISO ligt later. Gebruikt voor "dagen te laat" / "over N dagen" in het dashboard.
function daysBetween(fromISO, toISO) {
  const [y1, m1, d1] = fromISO.split('-').map(Number)
  const [y2, m2, d2] = toISO.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

// Kwartaal (1–4) + jaar waarin een ISO-datum valt.
function quarterOf(isoDate) {
  const [y, m] = isoDate.split('-').map(Number)
  return { year: y, q: Math.floor((m - 1) / 3) + 1 }
}

function markPaid(number, paidAt) {
  const file = path.join(DATA, 'invoices.csv')
  if (!fs.existsSync(file)) throw new Error('invoices.csv niet gevonden')
  const rows = parseCsv(fs.readFileSync(file, 'utf8'))
  let header = rows[0]
  if (!header.includes('paid_at')) header = [...header, 'paid_at']      // kolom toevoegen indien nog afwezig
  const objs = rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
  const match = objs.find(o => o.number === number)
  if (!match) throw new Error(`Factuur ${number} niet gevonden in invoices.csv`)
  const wasAlreadyPaid = match.status === 'paid'
  match.status = 'paid'
  match.paid_at = paidAt
  rewriteCsv(file, header, objs)
  return { number, client_name: match.client_name, total: match.total, status: 'paid', paid_at: paidAt, was_already_paid: wasAlreadyPaid }
}

// ---- FX: ECB-dagkoers via frankfurter.app ----

async function fx(cur, date) {
  const c = cur.toUpperCase()
  if (c === 'EUR') return { rate: 1, rate_date: date }
  const url = `https://api.frankfurter.app/${date}?from=${c}&to=EUR`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FX lookup faalde (${res.status}) voor ${c} op ${date}`)
  const json = await res.json()
  const rate = json?.rates?.EUR
  if (typeof rate !== 'number') throw new Error(`Geen EUR-koers voor ${c} op ${date} (valuta gedekt door ECB?)`)
  // frankfurter geeft de werkelijk gebruikte beursdag terug in json.date (weekend -> vorige werkdag).
  return { rate, rate_date: json.date || date }
}

// ---- Invoice compute (subtotaal/BTW/totaal uit regels) ----

function computeInvoice(inv) {
  const lines = (inv.line_items || []).map((li, idx) => {
    const quantity = Number(li.quantity)
    const rate = Number(li.rate)
    const amount = round2(quantity * rate)
    return {
      line_no: idx + 1,
      description: li.description,
      quantity,
      unit: li.unit || 'hours',
      rate: round2(rate),
      amount,
      vat_percentage: inv.vat_reverse_charged ? 0 : Number(li.vat_percentage ?? 21),
    }
  })
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0))

  let vat_amount = 0
  let vat_lines = []                       // [{ percentage, amount }] voor PDF
  if (inv.vat_reverse_charged) {
    vat_amount = 0
  } else {
    const byRate = new Map()
    for (const l of lines) {
      const v = round2(l.amount * l.vat_percentage / 100)
      byRate.set(l.vat_percentage, round2((byRate.get(l.vat_percentage) || 0) + v))
    }
    vat_amount = round2([...byRate.values()].reduce((s, v) => s + v, 0))
    vat_lines = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([percentage, amount]) => ({ percentage, amount }))
  }
  const total = round2(subtotal + vat_amount)
  // Invoice-niveau percentage = het dominante tarief (voor CSV/overzicht).
  const vat_percentage = inv.vat_reverse_charged ? 0 : (vat_lines[0]?.percentage ?? 21)

  return { line_items: lines, subtotal, vat_percentage, vat_amount, vat_lines, total, vat_reverse_charged: !!inv.vat_reverse_charged }
}

// ---- Factuur-PDF ----

function renderInvoicePdf(data, outPath) {
  const { business, client } = data
  const c = computeInvoice(data.invoice)
  const inv = { ...data.invoice, ...c }
  const tpl = fs.readFileSync(path.join(TEMPLATES, 'factuur.html'), 'utf8')

  // BTW-kolom per regel tonen we alleen als er iets te kiezen valt: bij verlegd of bij
  // gemengde tarieven. Bij één uniform tarief (de normale consultant-factuur) laten we 'm weg
  // zodat de factuur niet onnodig drukker wordt — het tarief staat dan onderaan bij de totalen.
  const showVatColumn = c.vat_reverse_charged || c.vat_lines.length > 1
  const vatCellText = li => c.vat_reverse_charged ? 'verlegd' : `${li.vat_percentage}%`

  const rowsHtml = c.line_items.map(li => `
      <tr>
        <td class="desc">${escapeHtml(li.description)}</td>
        <td class="num">${escapeHtml(String(li.quantity))}</td>
        <td class="unit">${escapeHtml(UNIT_LABELS[li.unit] || li.unit)}</td>
        <td class="num">${escapeHtml(formatCurrency(li.rate))}</td>
        ${showVatColumn ? `<td class="num">${escapeHtml(vatCellText(li))}</td>` : ''}
        <td class="num">${escapeHtml(formatCurrency(li.amount))}</td>
      </tr>`).join('')

  const vatHeader = showVatColumn ? '<th class="num">BTW</th>' : ''

  let vatRowHtml
  if (c.vat_reverse_charged) {
    vatRowHtml = `<tr><td class="t-label">BTW verlegd</td><td class="t-val">${escapeHtml(formatCurrency(0))}</td></tr>`
  } else if (c.vat_lines.length <= 1) {
    const pct = c.vat_lines[0]?.percentage ?? inv.vat_percentage
    vatRowHtml = `<tr><td class="t-label">BTW ${pct}%</td><td class="t-val">${escapeHtml(formatCurrency(c.vat_amount))}</td></tr>`
  } else {
    vatRowHtml = c.vat_lines.map(v =>
      `<tr><td class="t-label">BTW ${v.percentage}%</td><td class="t-val">${escapeHtml(formatCurrency(v.amount))}</td></tr>`).join('')
  }

  const contactParts = [business.phone, business.email].filter(Boolean).join(' &mdash; ')
  const termDays = data.payment_term_days ?? business.payment_terms_days ?? 14
  const termText = Number(termDays) === 0 ? 'direct' : `binnen ${termDays} dagen`
  const reverseNote = c.vat_reverse_charged
    ? `<p class="reverse-note">BTW verlegd naar de ontvanger op grond van artikel 44 Btw-richtlijn.</p>` : ''
  const referenceRow = inv.reference
    ? `<div class="meta-line">Kenmerk: ${escapeHtml(inv.reference)}</div>` : ''
  const notesHtml = inv.notes ? `<p class="notes">${escapeHtml(inv.notes)}</p>` : ''
  const accountHolder = business.account_holder || business.name

  const html = tpl
    .replaceAll('{{BUSINESS_NAME}}', escapeHtml(business.name))
    .replaceAll('{{BUSINESS_ADDRESS}}', escapeHtml(business.address))
    .replaceAll('{{BUSINESS_POSTCODE_CITY}}', escapeHtml(`${business.postal_code} ${business.city}`))
    .replaceAll('{{BUSINESS_CONTACT}}', contactParts)
    .replaceAll('{{BUSINESS_KVK}}', escapeHtml(business.coc_number))
    .replaceAll('{{BUSINESS_VAT}}', escapeHtml(business.vat_number))
    .replaceAll('{{BUSINESS_IBAN}}', escapeHtml(business.iban))
    .replaceAll('{{CLIENT_NAME}}', escapeHtml(client.name))
    .replaceAll('{{CLIENT_ATTENTION}}', client.attention ? `<div>T.a.v. ${escapeHtml(client.attention)}</div>` : '')
    .replaceAll('{{CLIENT_ADDRESS}}', escapeHtml(client.address))
    .replaceAll('{{CLIENT_POSTCODE_CITY}}', escapeHtml(`${client.postal_code} ${client.city}`))
    .replaceAll('{{CLIENT_VAT}}', client.vat_number ? `<div>BTW: ${escapeHtml(client.vat_number)}</div>` : '')
    .replaceAll('{{INVOICE_NUMBER}}', escapeHtml(inv.number))
    .replaceAll('{{INVOICE_DATE}}', escapeHtml(formatDate(inv.date)))
    .replaceAll('{{INVOICE_DUE_DATE}}', escapeHtml(formatDate(inv.due_date)))
    .replaceAll('{{REFERENCE_ROW}}', referenceRow)
    .replaceAll('{{VAT_HEADER}}', vatHeader)
    .replaceAll('{{LINE_ITEMS}}', rowsHtml)
    .replaceAll('{{SUBTOTAL}}', escapeHtml(formatCurrency(c.subtotal)))
    .replaceAll('{{VAT_ROWS}}', vatRowHtml)
    .replaceAll('{{TOTAL}}', escapeHtml(formatCurrency(c.total)))
    .replaceAll('{{REVERSE_NOTE}}', reverseNote)
    .replaceAll('{{NOTES}}', notesHtml)
    .replaceAll('{{PAYMENT_TERM}}', termText)
    .replaceAll('{{ACCOUNT_HOLDER}}', escapeHtml(accountHolder))

  htmlToPdf(html, outPath)
  return { ...c, number: inv.number, pdf_path: outPath }
}

// ---- Factuur deterministisch vastleggen (compute + due_date + PDF + CSV's) ----
// Eén stap die alle getallen zelf berekent en wegschrijft, zodat de AI nooit een bedrag
// of datum met de hand hoeft over te tikken. De AI levert alleen de "WAT" (klant + regels).
function recordInvoice(data, outPath) {
  const inv = data.invoice
  if (!inv?.number) throw new Error('invoice.number ontbreekt')
  if (!inv?.date) throw new Error('invoice.date ontbreekt (YYYY-MM-DD)')

  // Duplicaat-guard: nooit per ongeluk hetzelfde factuurnummer dubbel wegschrijven.
  const existing = readCsvObjects(path.join(DATA, 'invoices.csv'))
  if (existing.some(r => r.number === inv.number)) {
    throw new Error(`Factuur ${inv.number} staat al in invoices.csv — niets weggeschreven. Gebruik een nieuw nummer of corrigeer met de hand.`)
  }

  const termDays = data.payment_term_days ?? data.business?.payment_terms_days ?? 14
  const due_date = inv.due_date || addDays(inv.date, termDays)

  // PDF rendert met de (eventueel berekende) vervaldatum; computeInvoice bepaalt alle bedragen.
  const c = renderInvoicePdf({ ...data, invoice: { ...inv, due_date } }, outPath)

  const invoiceRow = {
    number: inv.number,
    date: inv.date,
    due_date,
    client_id: data.client?.id || inv.client_id || '',
    client_name: data.client?.name ?? inv.client_name ?? '',
    subtotal: c.subtotal,
    vat_percentage: c.vat_percentage,
    vat_amount: c.vat_amount,
    total: c.total,
    vat_reverse_charged: !!c.vat_reverse_charged,
    status: inv.status || 'sent',
    source: inv.source || 'created',
    self_billing: inv.self_billing ?? false,
    reference: inv.reference || '',
    notes: inv.notes || '',
    pdf_path: outPath,
    created_at: inv.created_at || todayISO(),
    paid_at: inv.paid_at || '',
  }
  appendCsv(path.join(DATA, 'invoices.csv'), invoiceRow)

  for (const li of c.line_items) {
    appendCsv(path.join(DATA, 'invoice_items.csv'), {
      invoice_number: inv.number,
      line_no: li.line_no,
      description: li.description,
      quantity: li.quantity,
      unit: li.unit,
      rate: li.rate,
      amount: li.amount,
      vat_percentage: li.vat_percentage,
    })
  }

  return {
    number: inv.number,
    client_name: invoiceRow.client_name,
    date: inv.date,
    due_date,
    subtotal: c.subtotal,
    vat_amount: c.vat_amount,
    total: c.total,
    line_count: c.line_items.length,
    pdf_path: outPath,
  }
}

// ---- BTW-aangifte (port van calculateBtw) ----

function isInQuarter(dateStr, year, q) {
  const d = new Date(dateStr)
  const startMonth = (q - 1) * 3
  const start = new Date(year, startMonth, 1)
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999)
  return d >= start && d <= end
}

function isEuVat(vatNumber) {
  if (!vatNumber) return false
  const prefix = vatNumber.replace(/\s/g, '').substring(0, 2).toUpperCase()
  return EU_COUNTRY_PREFIXES.includes(prefix)
}

function computeAangifte(year, q) {
  const invoices = readCsvObjects(path.join(DATA, 'invoices.csv'))
  const receipts = readCsvObjects(path.join(DATA, 'receipts.csv'))
  const clients = readCsvObjects(path.join(DATA, 'clients.csv'))
  const items = readCsvObjects(path.join(DATA, 'invoice_items.csv'))
  const clientMap = new Map(clients.map(c => [c.id, c]))
  // Regels per factuur — nodig om bij gemengde tarieven de omzet/BTW per regel in de juiste
  // rubriek (1a 21% / 1b 9% / 1e overig) te boeken i.p.v. alles op het dominante tarief.
  const itemsByInvoice = new Map()
  for (const it of items) {
    const arr = itemsByInvoice.get(it.invoice_number) || []
    arr.push(it)
    itemsByInvoice.set(it.invoice_number, arr)
  }
  const quarterStr = `${year}-Q${q}`

  const qInvoices = invoices.filter(i =>
    (i.status === 'sent' || i.status === 'paid') && isInQuarter(i.date, year, q))
  const draftCount = invoices.filter(i => i.status === 'draft' && isInQuarter(i.date, year, q)).length
  const qReceipts = receipts.filter(r => r.vat_period === quarterStr)

  let r1a_omzet = 0, r1a_btw = 0, r1b_omzet = 0, r1b_btw = 0, r1e_omzet = 0
  let r3a_omzet = 0, r3b_omzet = 0
  let r4a_omzet = 0, r4a_btw = 0, r4b_omzet = 0, r4b_btw = 0
  const icpMap = new Map()

  for (const inv of qInvoices) {
    const subtotal = Number(inv.subtotal)
    const vatPct = Number(inv.vat_percentage)
    const reverse = String(inv.vat_reverse_charged).toLowerCase() === 'true'
    const client = clientMap.get(inv.client_id)
    if (reverse) {
      if (isEuVat(client?.vat_number)) {
        r3b_omzet += subtotal
        const ex = icpMap.get(inv.client_id)
        if (ex) ex.amount += subtotal
        else icpMap.set(inv.client_id, { clientName: client?.name ?? inv.client_name ?? 'Onbekend', vatNumber: client?.vat_number ?? '', amount: subtotal })
      } else {
        r3a_omzet += subtotal
      }
    } else {
      // Boek per regel op het juiste tarief. Heeft de factuur regels in invoice_items.csv
      // (factuur + zelffactuur schrijven die altijd), dan splitsen we op `vat_percentage`;
      // anders vallen we terug op het factuur-niveau (één tarief).
      const lineItems = itemsByInvoice.get(inv.number)
      if (lineItems && lineItems.length) {
        for (const li of lineItems) {
          const amt = Number(li.amount)
          const pct = li.vat_percentage === '' || li.vat_percentage == null ? 21 : Number(li.vat_percentage)
          const btw = round2(amt * pct / 100)
          if (pct === 21) { r1a_omzet += amt; r1a_btw += btw }
          else if (pct === 9) { r1b_omzet += amt; r1b_btw += btw }
          else { r1e_omzet += amt }
        }
      } else if (vatPct === 21) { r1a_omzet += subtotal; r1a_btw += Number(inv.vat_amount) }
      else if (vatPct === 9) { r1b_omzet += subtotal; r1b_btw += Number(inv.vat_amount) }
      else { r1e_omzet += subtotal }
    }
  }

  let voorbelasting = 0
  const missingBusinessPct = []
  for (const r of qReceipts) {
    const status = r.vat_status || 'non_deductible'
    const amount = Number(r.amount_eur)
    const vatAmount = Number(r.vat_amount_eur || 0)
    const vatPct = r.vat_percentage === '' ? 21 : Number(r.vat_percentage)
    if (status === 'reverse_charge_non_eu' || status === 'reverse_charge_eu') {
      const base = round2(amount - vatAmount)
      const btw = round2(base * (vatPct / 100))
      if (status === 'reverse_charge_non_eu') { r4a_omzet += base; r4a_btw += btw }
      else { r4b_omzet += base; r4b_btw += btw }
    } else if (status === 'deductible') {
      if (!NON_DEDUCTIBLE_CATEGORIES.includes(r.category)) {
        const pct = r.business_pct === '' || r.business_pct == null ? 100 : Number(r.business_pct)
        voorbelasting += round2(vatAmount * pct / 100)
      }
    }
    if (r.category === 'phone_internet' && (r.business_pct === '' || r.business_pct == null)) missingBusinessPct.push(r)
  }

  const totaalVoorbelasting = round2(voorbelasting + r4a_btw + r4b_btw)
  const verschuldigd = round2(r1a_btw + r1b_btw + r4a_btw + r4b_btw)
  const saldo = round2(verschuldigd - totaalVoorbelasting)

  const rubrieken = [
    { code: '1a', label: 'Leveringen/diensten belast met hoog tarief (21%)', omzet: round2(r1a_omzet), btw: round2(r1a_btw) },
    { code: '1b', label: 'Leveringen/diensten belast met laag tarief (9%)', omzet: round2(r1b_omzet), btw: round2(r1b_btw) },
    { code: '1e', label: 'Leveringen/diensten belast met overige tarieven, incl. 0%', omzet: round2(r1e_omzet), btw: 0 },
    { code: '3a', label: 'Leveringen naar landen buiten de EU (uitvoer)', omzet: round2(r3a_omzet), btw: 0 },
    { code: '3b', label: 'Leveringen naar/diensten in landen binnen de EU', omzet: round2(r3b_omzet), btw: 0 },
    { code: '4a', label: 'Leveringen/diensten uit landen buiten de EU', omzet: round2(r4a_omzet), btw: round2(r4a_btw) },
    { code: '4b', label: 'Leveringen/diensten uit landen binnen de EU', omzet: round2(r4b_omzet), btw: round2(r4b_btw) },
    { code: '5a', label: 'Verschuldigde omzetbelasting (rubrieken 1 t/m 4)', omzet: null, btw: round2(verschuldigd) },
    { code: '5b', label: 'Voorbelasting', omzet: null, btw: round2(totaalVoorbelasting) },
    { code: '5g', label: saldo >= 0 ? 'Te betalen omzetbelasting' : 'Terug te vragen omzetbelasting', omzet: null, btw: round2(Math.abs(saldo)) },
  ]

  const warnings = []
  if (draftCount > 0) warnings.push(`${draftCount} concept-factu(u)r(en) niet meegeteld (alleen verzonden/betaald telt mee).`)
  if (qInvoices.length === 0 && qReceipts.length === 0) warnings.push('Geen gegevens gevonden voor dit kwartaal.')
  if (qInvoices.length > 0 && qReceipts.length === 0) warnings.push('Geen bonnen ingevoerd dit kwartaal — voorbelasting is €0.')
  if (missingBusinessPct.length > 0) warnings.push(`${missingBusinessPct.length} telefoon/internet-bon(nen) missen een zakelijk percentage (business_pct).`)

  const deadlineYear = q === 4 ? year + 1 : year
  return {
    quarter: quarterStr,
    rubrieken,
    icpEntries: [...icpMap.values()].map(e => ({ ...e, amount: round2(e.amount) })),
    icp_total: round2([...icpMap.values()].reduce((s, e) => s + e.amount, 0)),
    summary: { verschuldigd, voorbelasting: totaalVoorbelasting, saldo },
    deadline: `${DEADLINES[q]} ${deadlineYear}`,
    saldo_richting: saldo >= 0 ? 'te betalen' : 'terug te vragen',
    warnings,
    counts: { invoices: qInvoices.length, receipts: qReceipts.length, drafts: draftCount },
  }
}

// ---- Dashboard (stand van zaken) ----
// Read-only momentopname uit de CSV's: openstaande facturen (met dagen te laat/over datum),
// opbrengsten en kosten van het lopende kwartaal, en de eerstvolgende BTW-aangifte-deadline.
// Alle datum-/geldberekeningen zitten hier; de skill/HTML toont alleen.
function computeDashboard() {
  const today = todayISO()
  const { year, q } = quarterOf(today)
  const invoices = readCsvObjects(path.join(DATA, 'invoices.csv'))
  const receipts = readCsvObjects(path.join(DATA, 'receipts.csv'))
  const aangiftes = readCsvObjects(path.join(DATA, 'aangiftes.csv'))
  const recordedQuarters = new Set(aangiftes.map(a => a.quarter))

  // Per kwartaal van het lopende jaar: omzet (ex btw), kosten en aangifte-status. Zo blijft het
  // net-afgesloten kwartaal in beeld — ook als het lopende kwartaal net begon en nog leeg is —
  // en zie je in één oogopslag welk kwartaal loopt, welke voorbij zijn en of de aangifte al gedaan is.
  const quarters = []
  let y_omzet = 0, y_omzet_incl = 0, y_kosten = 0, y_inv = 0, y_rec = 0
  for (let qq = 1; qq <= 4; qq++) {
    const qStr = `${year}-Q${qq}`
    const qInv = invoices.filter(i =>
      (i.status === 'sent' || i.status === 'paid') && isInQuarter(i.date, year, qq))
    const qRec = receipts.filter(r => r.vat_period === qStr)
    const omzet = round2(qInv.reduce((s, i) => s + Number(i.subtotal || 0), 0))
    const omzet_incl = round2(qInv.reduce((s, i) => s + Number(i.total || 0), 0))
    const kosten = round2(qRec.reduce((s, r) => s + Number(r.amount_eur || 0), 0))
    y_omzet = round2(y_omzet + omzet)
    y_omzet_incl = round2(y_omzet_incl + omzet_incl)
    y_kosten = round2(y_kosten + kosten)
    y_inv += qInv.length
    y_rec += qRec.length
    const deadlineYear = qq === 4 ? year + 1 : year   // Q4 → deadline in januari erna
    const deadline_date = `${deadlineYear}-${DEADLINE_MMDD[qq]}`
    quarters.push({
      quarter: qStr,
      q: qq,
      phase: qq < q ? 'past' : qq === q ? 'current' : 'future',
      omzet, omzet_incl, kosten,
      net: round2(omzet - kosten),
      invoice_count: qInv.length,
      receipt_count: qRec.length,
      aangifte: {
        recorded: recordedQuarters.has(qStr),
        deadline_date,
        deadline_days: daysBetween(today, deadline_date),  // >0 = nog te gaan
      },
    })
  }
  const currentQ = quarters.find(x => x.q === q)

  // Openstaande verkoopfacturen = status 'sent' (betaald = klaar, concept = nog niet verstuurd).
  // days_overdue > 0 betekent over de vervaldatum; ≤ 0 betekent nog te gaan.
  const outstandingInvoices = invoices
    .filter(i => i.status === 'sent')
    .map(i => {
      const due = i.due_date || i.date
      const days_overdue = daysBetween(due, today)
      let state = 'ok'
      if (days_overdue > 0) state = 'overdue'
      else if (days_overdue >= -7) state = 'due_soon'
      return {
        number: i.number,
        client_name: i.client_name,
        total: round2(Number(i.total || 0)),
        due_date: due,
        days_overdue,
        state,
      }
    })
    .sort((a, b) => b.days_overdue - a.days_overdue)   // meest te laat bovenaan
  const outstanding_total = round2(outstandingInvoices.reduce((s, i) => s + i.total, 0))
  const overdue = outstandingInvoices.filter(i => i.state === 'overdue')
  const overdue_total = round2(overdue.reduce((s, i) => s + i.total, 0))

  // Eerstvolgende BTW-aangifte = het zojuist afgelopen kwartaal (het vorige t.o.v. vandaag).
  let pq = q - 1, pqYear = year
  if (pq === 0) { pq = 4; pqYear = year - 1 }
  const pQuarterStr = `${pqYear}-Q${pq}`
  const deadlineYear = pq === 4 ? pqYear + 1 : pqYear     // Q4 → deadline in januari erna
  const deadline_date = `${deadlineYear}-${DEADLINE_MMDD[pq]}`
  const deadline_days = daysBetween(today, deadline_date)  // >0 = nog te gaan
  const recorded = aangiftes.some(a => a.quarter === pQuarterStr)

  const warnings = []
  const draftCount = invoices.filter(i => i.status === 'draft').length
  if (overdue.length > 0)
    warnings.push(`${overdue.length} factu(u)r(en) over de vervaldatum, samen ${formatCurrency(overdue_total)}.`)
  if (!recorded && deadline_days < 0)
    warnings.push(`BTW-aangifte ${pQuarterStr} is over de deadline (${formatDate(deadline_date)}) en nog niet vastgelegd.`)
  else if (!recorded && deadline_days <= 21)
    warnings.push(`BTW-aangifte ${pQuarterStr} nog niet vastgelegd — deadline ${formatDate(deadline_date)} (over ${deadline_days} dagen). Draai /aangifte.`)
  if (draftCount > 0)
    warnings.push(`${draftCount} concept-factu(u)r(en) staan open — nog niet verzonden, tellen niet mee in de omzet.`)

  return {
    generated_at: today,
    year,
    current_quarter: currentQ.quarter,
    year_totals: {
      omzet: y_omzet,
      omzet_incl: y_omzet_incl,
      kosten: y_kosten,
      net: round2(y_omzet - y_kosten),
      invoice_count: y_inv,
      receipt_count: y_rec,
    },
    quarters,
    outstanding: {
      total: outstanding_total,
      count: outstandingInvoices.length,
      overdue_count: overdue.length,
      overdue_total,
      invoices: outstandingInvoices,
    },
    next_aangifte: { quarter: pQuarterStr, deadline_date, deadline_days, recorded },
    warnings,
  }
}

// ---- Dashboard-HTML (Vink "Rapport": printbaar statusvel, scherm/PDF-vriendelijk) ----
// Vink Design System-kleuren. Status-stippen: betaald/groen, verstuurd/oranje, te laat/rood, grijs.
const VINK = {
  green: '#22C55E', amber: '#FBBF24', red: '#EF4444', grey: '#9CA3AF',
  overdueText: '#B91C1C', ink: '#0A0A0B', teal: '#00C9A7', costBar: '#B7B1A6',
}
const QMONTHS = { 1: 'jan–mrt', 2: 'apr–jun', 3: 'jul–sep', 4: 'okt–dec' }

function renderDashboardHtml(data, outPath) {
  const { business } = data
  const d = data.dashboard
  const yt = d.year_totals
  const na = d.next_aangifte
  const currentQ = d.quarters.find(q => q.phase === 'current')
  const tpl = fs.readFileSync(path.join(TEMPLATES, 'dashboard.html'), 'utf8')

  const dayLabel = n => {
    if (n > 0) return `${n} ${n === 1 ? 'dag' : 'dagen'} te laat`
    if (n === 0) return 'vervalt vandaag'
    const a = -n
    return `over ${a} ${a === 1 ? 'dag' : 'dagen'}`
  }

  // --- KPI-kaarten (label · waarde · sub-regels). Een regel is muted, óf rood (l.red),
  // óf muted met alleen een rood deelstuk (l.html — vertrouwde, zelf-opgebouwde HTML). ---
  const kpiCard = (label, value, lines) => `
        <div class="kpi">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
          <div class="lines">${lines.map(l => `<div class="${l.red ? 'red' : 'muted'}">${l.html != null ? l.html : escapeHtml(l.t)}</div>`).join('')}</div>
        </div>`

  const openstaandLines = d.outstanding.count === 0
    ? [{ t: 'niets open' }]
    : d.outstanding.overdue_count > 0
      ? [
          // Aantal facturen blijft muted; alleen het "N te laat"-deel kleurt rood.
          { html: `${d.outstanding.count} facturen · <span class="red">${d.outstanding.overdue_count} te laat</span>` },
          { t: `${formatCurrency(d.outstanding.overdue_total)} te laat`, red: true },
        ]
      : [{ t: `${d.outstanding.count} factu${d.outstanding.count === 1 ? 'ur' : 'ren'}` }]

  let aangifteLine
  if (na.recorded) aangifteLine = { t: `${na.quarter} · vastgelegd` }
  else if (na.deadline_days < 0) aangifteLine = { t: `${na.quarter} · ${-na.deadline_days} dagen te laat`, red: true }
  else aangifteLine = { t: `${na.quarter} · over ${na.deadline_days} ${na.deadline_days === 1 ? 'dag' : 'dagen'}` }

  const kpiCards = [
    kpiCard('Omzet dit jaar', formatCurrency(yt.omzet), [
      { t: `${yt.invoice_count} factu${yt.invoice_count === 1 ? 'ur' : 'ren'} · incl. btw` },
      { t: formatCurrency(yt.omzet_incl) },
    ]),
    kpiCard('Kosten dit jaar', formatCurrency(yt.kosten), [
      { t: `${yt.receipt_count} bon${yt.receipt_count === 1 ? '' : 'nen'}` },
    ]),
    kpiCard('Openstaand', formatCurrency(d.outstanding.total), openstaandLines),
    kpiCard('Volgende BTW-aangifte', formatDate(na.deadline_date), [aangifteLine]),
  ].join('')

  // --- Staafgrafiek: bar-hoogte = waarde / maxOmzet * 110 (max ~110px in 130px-plot). ---
  const maxOmzet = Math.max(1, ...d.quarters.map(q => q.omzet))
  const barPx = v => Math.min(118, Math.max(0, Math.round(v / maxOmzet * 110)))
  const chartBars = d.quarters.map(q => `
            <div class="grp">
              <div class="bar" style="background:${VINK.teal};height:${barPx(q.omzet)}px"></div>
              <div class="bar" style="background:${VINK.costBar};height:${barPx(q.kosten)}px"></div>
            </div>`).join('')
  const chartLabels = d.quarters.map(q =>
    `<div><b style="color:${VINK.ink}">Q${q.q}</b> ${QMONTHS[q.q]}</div>`).join('')

  // --- Per-kwartaal-tabel: huidig kwartaal gemarkeerd, aangifte-status met stip. ---
  const quarterRows = d.quarters.map(qr => {
    const a = qr.aangifte
    let color, label
    if (a.recorded) { color = VINK.green; label = 'Vastgelegd' }
    else if (qr.phase === 'future') { color = VINK.grey; label = '—' }
    else if (qr.phase === 'current') { color = VINK.grey; label = 'Loopt nog' }
    else if (a.deadline_days < 0) { color = VINK.red; label = `Te laat — was ${formatDate(a.deadline_date)}` }
    else { color = VINK.amber; label = `Aangeven vóór ${formatDate(a.deadline_date)}` }
    const isNow = qr.phase === 'current'
    return `
                <tr style="background:${isNow ? '#F7F3EB' : 'transparent'}">
                  <td><span class="qname">Q${qr.q}</span><span class="qmonths">${QMONTHS[qr.q]}</span>${isNow ? '<span class="nu">nu</span>' : ''}</td>
                  <td class="r">${escapeHtml(formatCurrency(qr.omzet))}</td>
                  <td class="r">${escapeHtml(formatCurrency(qr.kosten))}</td>
                  <td class="r strong">${escapeHtml(formatCurrency(qr.net))}</td>
                  <td><span class="status"><span class="dot" style="background:${color}"></span>${escapeHtml(label)}</span></td>
                </tr>`
  }).join('')

  // --- Openstaande facturen: te laat = rode stip + rode tekst, anders groene stip. ---
  const invoiceRows = d.outstanding.invoices.length
    ? d.outstanding.invoices.map(i => {
        const overdue = i.state === 'overdue'
        const dot = overdue ? VINK.red : VINK.green
        const textColor = overdue ? VINK.overdueText : VINK.ink
        return `
                <tr>
                  <td class="muted">${escapeHtml(i.number)}</td>
                  <td>${escapeHtml(i.client_name)}</td>
                  <td class="r strong">${escapeHtml(formatCurrency(i.total))}</td>
                  <td>${escapeHtml(formatDate(i.due_date))}</td>
                  <td><span class="status" style="color:${textColor}"><span class="dot" style="background:${dot}"></span>${escapeHtml(dayLabel(i.days_overdue))}</span></td>
                </tr>`
      }).join('')
    : `<tr><td colspan="5" class="empty">Geen openstaande facturen — alles is betaald.</td></tr>`

  const html = tpl
    .replaceAll('{{BUSINESS_NAME}}', escapeHtml(business?.name || 'Mijn onderneming'))
    .replaceAll('{{YEAR}}', escapeHtml(String(d.year)))
    .replaceAll('{{CURRENT_Q}}', escapeHtml(String(currentQ?.q ?? '')))
    .replaceAll('{{GENERATED_AT}}', escapeHtml(formatDate(d.generated_at)))
    .replaceAll('{{KPI_CARDS}}', kpiCards)
    .replaceAll('{{RESULTAAT}}', escapeHtml(formatCurrency(yt.net)))
    .replaceAll('{{CHART_BARS}}', chartBars)
    .replaceAll('{{CHART_LABELS}}', chartLabels)
    .replaceAll('{{QUARTER_ROWS}}', quarterRows)
    .replaceAll('{{INVOICE_ROWS}}', invoiceRows)

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  fs.writeFileSync(outPath, html)
  return { html_path: outPath }
}

// ---- Aangifte-PDF ----

function renderAangiftePdf(data, outPath) {
  const { business, aangifte } = data
  const tpl = fs.readFileSync(path.join(TEMPLATES, 'aangifte.html'), 'utf8')

  const rubriekRows = aangifte.rubrieken.map(r => `
      <tr class="${r.code.startsWith('5') ? 'total-row' : ''}">
        <td class="code">${r.code}</td>
        <td class="rlabel">${escapeHtml(r.label)}</td>
        <td class="num">${r.omzet == null ? '' : escapeHtml(formatCurrency(r.omzet))}</td>
        <td class="num">${escapeHtml(formatCurrency(r.btw))}</td>
      </tr>`).join('')

  const icpRows = aangifte.icpEntries.length
    ? aangifte.icpEntries.map(e => `<tr><td>${escapeHtml(e.clientName)}</td><td>${escapeHtml(e.vatNumber)}</td><td class="num">${escapeHtml(formatCurrency(e.amount))}</td></tr>`).join('')
    : ''
  const icpBlock = aangifte.icpEntries.length ? `
    <h2>ICP-opgaaf (intracommunautaire prestaties)</h2>
    <table class="icp"><thead><tr><th>Afnemer</th><th>BTW-nummer</th><th class="num">Bedrag</th></tr></thead>
    <tbody>${icpRows}</tbody></table>` : ''

  const warningsBlock = aangifte.warnings.length
    ? `<div class="warnings"><strong>Aandachtspunten</strong><ul>${aangifte.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>` : ''

  const saldo = aangifte.summary.saldo
  const html = tpl
    .replaceAll('{{BUSINESS_NAME}}', escapeHtml(business.name))
    .replaceAll('{{BUSINESS_VAT}}', escapeHtml(business.vat_number))
    .replaceAll('{{BUSINESS_KVK}}', escapeHtml(business.coc_number))
    .replaceAll('{{QUARTER}}', escapeHtml(aangifte.quarter.replace('-Q', ' — kwartaal ')))
    .replaceAll('{{DEADLINE}}', escapeHtml(aangifte.deadline))
    .replaceAll('{{RUBRIEK_ROWS}}', rubriekRows)
    .replaceAll('{{ICP_BLOCK}}', icpBlock)
    .replaceAll('{{WARNINGS_BLOCK}}', warningsBlock)
    .replaceAll('{{SALDO_LABEL}}', escapeHtml(saldo >= 0 ? 'Te betalen aan Belastingdienst' : 'Terug te vragen van Belastingdienst'))
    .replaceAll('{{SALDO_VALUE}}', escapeHtml(formatCurrency(Math.abs(saldo))))

  htmlToPdf(html, outPath)
}

// ---- Aangifte deterministisch vastleggen (PDF + CSV-rij uit de berekende JSON) ----
// Mapt de rubrieken rechtstreeks naar de aangiftes.csv-kolommen, zodat de AI geen 18
// waarden hoeft over te tikken.
function recordAangifte(data, outPath) {
  const a = data.aangifte
  if (!a?.quarter) throw new Error('aangifte.quarter ontbreekt')
  renderAangiftePdf(data, outPath)

  const rb = Object.fromEntries(a.rubrieken.map(r => [r.code, r]))
  const row = {
    quarter: a.quarter,
    generated_at: todayISO(),
    r1a_omzet: rb['1a'].omzet, r1a_btw: rb['1a'].btw,
    r1b_omzet: rb['1b'].omzet, r1b_btw: rb['1b'].btw,
    r1e_omzet: rb['1e'].omzet,
    r3a: rb['3a'].omzet, r3b: rb['3b'].omzet,
    r4a_omzet: rb['4a'].omzet, r4a_btw: rb['4a'].btw,
    r4b_omzet: rb['4b'].omzet, r4b_btw: rb['4b'].btw,
    r5a: a.summary.verschuldigd, r5b: a.summary.voorbelasting, r5g: a.summary.saldo,
    icp_total: a.icp_total,
    deadline: a.deadline,
    pdf_path: outPath,
  }
  appendCsv(path.join(DATA, 'aangiftes.csv'), row)

  return {
    quarter: a.quarter,
    saldo: a.summary.saldo,
    saldo_richting: a.saldo_richting,
    deadline: a.deadline,
    icp_total: a.icp_total,
    pdf_path: outPath,
  }
}

// ---- Headless Chrome render ----

function htmlToPdf(html, outPath) {
  const tmp = path.join(os.tmpdir(), `admin-render-${process.pid}-${Date.now()}.html`)
  fs.writeFileSync(tmp, html)
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  try {
    execFileSync(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${path.resolve(outPath)}`,
      `file://${tmp}`,
    ], { stdio: 'ignore' })
  } finally {
    fs.unlinkSync(tmp)
  }
}

// ---- CLI dispatch ----

function readJsonArg(arg) {
  // Accepteer een pad naar een .json of een inline JSON-string.
  if (fs.existsSync(arg)) return JSON.parse(fs.readFileSync(arg, 'utf8'))
  return JSON.parse(arg)
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  switch (cmd) {
    case 'next-invoice-number':
      console.log(nextInvoiceNumber())
      break
    case 'fx': {
      const [cur, date] = args
      if (!cur || !date) throw new Error('Gebruik: fx <CUR> <YYYY-MM-DD>')
      console.log(JSON.stringify(await fx(cur, date)))
      break
    }
    case 'compute-invoice': {
      console.log(JSON.stringify(computeInvoice(readJsonArg(args[0]).invoice ?? readJsonArg(args[0])), null, 2))
      break
    }
    case 'render-invoice': {
      const [dataArg, out] = args
      const result = renderInvoicePdf(readJsonArg(dataArg), out)
      console.log(JSON.stringify(result))
      break
    }
    case 'record-invoice': {
      const [dataArg, out] = args
      if (!dataArg || !out) throw new Error('Gebruik: record-invoice <factuur.json> <out.pdf>')
      console.log(JSON.stringify(recordInvoice(readJsonArg(dataArg), out)))
      break
    }
    case 'dashboard': {
      console.log(JSON.stringify(computeDashboard(), null, 2))
      break
    }
    case 'render-dashboard': {
      const [dataArg, out] = args
      if (!dataArg || !out) throw new Error('Gebruik: render-dashboard <dashboard.json> <out.html>')
      console.log(JSON.stringify(renderDashboardHtml(readJsonArg(dataArg), out)))
      break
    }
    case 'aangifte': {
      const m = (args[0] || '').match(/^(\d{4})-Q([1-4])$/)
      if (!m) throw new Error('Gebruik: aangifte <YYYY-QN>, bv. 2026-Q2')
      console.log(JSON.stringify(computeAangifte(parseInt(m[1], 10), parseInt(m[2], 10)), null, 2))
      break
    }
    case 'render-aangifte': {
      const [dataArg, out] = args
      renderAangiftePdf(readJsonArg(dataArg), out)
      console.log(JSON.stringify({ pdf_path: out }))
      break
    }
    case 'record-aangifte': {
      const [dataArg, out] = args
      if (!dataArg || !out) throw new Error('Gebruik: record-aangifte <aangifte.json> <out.pdf>')
      console.log(JSON.stringify(recordAangifte(readJsonArg(dataArg), out)))
      break
    }
    case 'append': {
      const [file, rowArg] = args
      const resolved = path.isAbsolute(file) ? file : path.join(WORK_DIR, file)
      appendCsv(resolved, readJsonArg(rowArg))
      console.log(JSON.stringify({ ok: true, file: resolved }))
      break
    }
    case 'mark-paid': {
      const [number, dateArg] = args
      if (!number) throw new Error('Gebruik: mark-paid <factuurnummer> [YYYY-MM-DD]')
      const paidAt = dateArg || todayISO()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) throw new Error(`Ongeldige datum: ${paidAt} (verwacht YYYY-MM-DD)`)
      console.log(JSON.stringify(markPaid(number, paidAt)))
      break
    }
    default:
      console.error(`Onbekend commando: ${cmd || '(geen)'}
Beschikbaar: next-invoice-number | fx | compute-invoice | render-invoice | record-invoice | dashboard | render-dashboard | aangifte | render-aangifte | record-aangifte | append | mark-paid`)
      process.exit(1)
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1) })
