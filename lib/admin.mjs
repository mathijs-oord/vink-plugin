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
//   jaaropgave <YYYY> [opties.json]     -> jaaroverzicht voor de IB-aangifte (W&V → belastbare winst); print JSON
//   render-jaaropgave <jaaropgave.json> <out.pdf> -> jaaropgave-PDF via headless Chrome
//   record-jaaropgave <jaaropgave.json> <out.pdf> -> PDF + jaaropgaven.csv-rij uit de berekende JSON
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

// Aangifte-deadlines per kwartaal (vink btw.ts DEADLINE_DATES).
const DEADLINES = { 1: '30 april', 2: '31 juli', 3: '31 oktober', 4: '31 januari' }
// Zelfde deadlines als MM-DD, voor het deterministisch rekenen met resterende dagen (dashboard).
const DEADLINE_MMDD = { 1: '04-30', 2: '07-31', 3: '10-31', 4: '01-31' }

// ---- Jaaropgave: fiscale jaarparameters (inkomstenbelasting) ----
// Bron: Belastingdienst — zie rules/jaaropgave.md. Bijwerken zodra de bedragen van een nieuw jaar
// vaststaan. Ontbreekt een jaar, dan rekent de jaaropgave t/m de fiscale winst en slaat ze de
// aftrekposten (KIA, ondernemersaftrek, MKB-winstvrijstelling) over.
const IB_PARAMS = {
  2025: {
    zelfstandigenaftrek: 2470, startersaftrek: 2123, mkb_pct: 12.7, km_tarief: 0.23,
    kia: { floor: 2900, pct: 28, pct_to: 70602, fixed: 19769, fixed_to: 130744, taper_pct: 7.56, max: 392230 },
  },
  2026: {
    zelfstandigenaftrek: 1200, startersaftrek: 2123, mkb_pct: 12.7, km_tarief: 0.25,
    kia: { floor: 2900, pct: 28, pct_to: 71683, fixed: 20072, fixed_to: 132746, taper_pct: 7.56, max: 398236 },
  },
}
// Bedrijfsmiddel vanaf dit bedrag (excl. aftrekbare BTW) = investering: activeren en afschrijven.
const ASSET_THRESHOLD = 450
const ASSET_DEFAULT_YEARS = 5   // fiscaal max. 20% van de aanschafkosten per jaar
// Eten & drinken/representatie: 80% aftrekbaar voor de IB (art. 3.15 Wet IB) → 20% bijtellen.
const LIMITED_DEDUCTIBLE_CATEGORIES = ['food_drinks']
const LIMITED_DEDUCTIBLE_PCT = 80
// Bon-categorie → NL-label + de rubriek onder "Overige bedrijfskosten" in de IB-aangifte.
const COST_CATEGORIES = {
  office: { label: 'Kantoorkosten', rubriek: 'Andere kosten' },
  travel: { label: 'Reiskosten', rubriek: 'Auto- en transportkosten' },
  software: { label: 'Software & abonnementen', rubriek: 'Andere kosten' },
  phone_internet: { label: 'Telefoon & internet', rubriek: 'Andere kosten' },
  insurance: { label: 'Verzekeringen', rubriek: 'Andere kosten' },
  marketing: { label: 'Marketing & reclame', rubriek: 'Verkoopkosten' },
  education: { label: 'Opleiding & vakliteratuur', rubriek: 'Andere kosten' },
  food_drinks: { label: 'Eten & drinken (zakelijk)', rubriek: 'Verkoopkosten' },
  equipment: { label: 'Apparatuur & inventaris (< € 450)', rubriek: 'Andere kosten' },
  other: { label: 'Overige kosten', rubriek: 'Andere kosten' },
}

// ---- i18n: teksten voor factuur- en dashboard-render ----
// Taal komt uit business.language (default 'nl'); per factuur override via invoice.language.
// De aangifte blijft bewust Nederlands: de rubrieken (1a/1b/…/5g) zijn de officiële
// Belastingdienst-formulierlabels die je 1-op-1 overtikt op Mijn Belastingdienst Zakelijk.
const LOCALES = { nl: 'nl-NL', en: 'en-IE' }  // en-IE = euro met Engelse notatie (€1,234.56)
const MONTHS_SHORT = {
  nl: ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
const STRINGS = {
  nl: {
    // factuur
    invTitle: 'FACTUUR', to: 'Aan', attention: 'T.a.v.',
    number: 'Nummer', date: 'Datum', dueDate: 'Vervaldatum', reference: 'Kenmerk',
    colDesc: 'Omschrijving', colQty: 'Aantal', colUnit: 'Eenheid', colRate: 'Tarief', colAmount: 'Bedrag',
    vat: 'BTW', coc: 'KvK',
    subtotal: 'Subtotaal', total: 'Totaal',
    vatReversedCell: 'verlegd', vatReversedRow: 'BTW verlegd',
    vatRow: pct => `BTW ${pct}%`,
    reverseNote: 'BTW verlegd naar de ontvanger op grond van artikel 44 Btw-richtlijn.',
    termImmediate: 'direct', termWithin: d => `binnen ${d} dagen`,
    payInstruction: (term, iban, holder, num) =>
      `Gelieve het bedrag ${term} over te maken op IBAN ${iban} t.n.v. ${holder} o.v.v. factuurnummer ${num}.`,
    units: { hours: 'Uren', pieces: 'Stuks', days: 'Dagen', months: 'Maanden', times: 'Keer' },
    // dashboard
    dashTitle: 'Stand van zaken',
    dashSubtitle: (name, year, q) => `${name} · boekjaar ${year} · je zit nu in Q${q}`,
    generatedOn: d => `Gegenereerd op ${d}`,
    resultStrip: 'Indicatief resultaat dit jaar', resultHint: '(omzet − kosten)',
    chartTitle: 'Omzet & kosten per kwartaal', legendRevenue: 'Omzet', legendCosts: 'Kosten',
    secQuarter: 'Per kwartaal', secOutstanding: 'Openstaande facturen',
    thQuarter: 'Kwartaal', thRevenue: 'Omzet', thCosts: 'Kosten', thResult: 'Resultaat', thReturn: 'BTW-aangifte',
    thInvoice: 'Factuur', thClient: 'Klant', thAmount: 'Bedrag', thDue: 'Vervaldatum', thStatus: 'Status',
    kpiRevenue: 'Omzet dit jaar', kpiCosts: 'Kosten dit jaar', kpiOutstanding: 'Openstaand', kpiReturn: 'Volgende BTW-aangifte',
    inclVat: 'incl. btw',
    invoiceCount: n => `${n} factu${n === 1 ? 'ur' : 'ren'}`,
    receiptCount: n => `${n} bon${n === 1 ? '' : 'nen'}`,
    nothingOutstanding: 'niets open',
    overdueCount: n => `${n} te laat`,
    overdueAmount: amt => `${amt} te laat`,
    recorded: 'vastgelegd', recordedCap: 'Vastgelegd', inProgress: 'Loopt nog',
    daysOverdue: n => `${n} ${n === 1 ? 'dag' : 'dagen'} te laat`,
    dueToday: 'vervalt vandaag',
    inDays: n => `over ${n} ${n === 1 ? 'dag' : 'dagen'}`,
    wasOverdue: d => `Te laat — was ${d}`,
    fileBefore: d => `Aangeven vóór ${d}`,
    now: 'nu',
    noOutstanding: 'Geen openstaande facturen — alles is betaald.',
    businessFallback: 'Mijn onderneming',
    qmonths: { 1: 'jan–mrt', 2: 'apr–jun', 3: 'jul–sep', 4: 'okt–dec' },
  },
  en: {
    invTitle: 'INVOICE', to: 'To', attention: 'Attn.',
    number: 'Number', date: 'Date', dueDate: 'Due date', reference: 'Reference',
    colDesc: 'Description', colQty: 'Quantity', colUnit: 'Unit', colRate: 'Rate', colAmount: 'Amount',
    vat: 'VAT', coc: 'CoC',
    subtotal: 'Subtotal', total: 'Total',
    vatReversedCell: 'reverse charged', vatReversedRow: 'VAT reverse charged',
    vatRow: pct => `VAT ${pct}%`,
    reverseNote: 'VAT reverse charged to the recipient pursuant to Article 44 of the EU VAT Directive.',
    termImmediate: 'immediately', termWithin: d => `within ${d} days`,
    payInstruction: (term, iban, holder, num) =>
      `Please transfer the amount ${term} to IBAN ${iban}, account holder ${holder}, quoting invoice number ${num}.`,
    units: { hours: 'Hours', pieces: 'Pieces', days: 'Days', months: 'Months', times: 'Times' },
    dashTitle: 'Status overview',
    dashSubtitle: (name, year, q) => `${name} · financial year ${year} · you're now in Q${q}`,
    generatedOn: d => `Generated on ${d}`,
    resultStrip: 'Indicative result this year', resultHint: '(revenue − costs)',
    chartTitle: 'Revenue & costs per quarter', legendRevenue: 'Revenue', legendCosts: 'Costs',
    secQuarter: 'Per quarter', secOutstanding: 'Outstanding invoices',
    thQuarter: 'Quarter', thRevenue: 'Revenue', thCosts: 'Costs', thResult: 'Result', thReturn: 'VAT return',
    thInvoice: 'Invoice', thClient: 'Client', thAmount: 'Amount', thDue: 'Due date', thStatus: 'Status',
    kpiRevenue: 'Revenue this year', kpiCosts: 'Costs this year', kpiOutstanding: 'Outstanding', kpiReturn: 'Next VAT return',
    inclVat: 'incl. VAT',
    invoiceCount: n => `${n} invoice${n === 1 ? '' : 's'}`,
    receiptCount: n => `${n} receipt${n === 1 ? '' : 's'}`,
    nothingOutstanding: 'nothing outstanding',
    overdueCount: n => `${n} overdue`,
    overdueAmount: amt => `${amt} overdue`,
    recorded: 'recorded', recordedCap: 'Recorded', inProgress: 'In progress',
    daysOverdue: n => `${n} day${n === 1 ? '' : 's'} overdue`,
    dueToday: 'due today',
    inDays: n => `in ${n} day${n === 1 ? '' : 's'}`,
    wasOverdue: d => `Overdue — was ${d}`,
    fileBefore: d => `File before ${d}`,
    now: 'now',
    noOutstanding: 'No outstanding invoices — everything is paid.',
    businessFallback: 'My business',
    qmonths: { 1: 'Jan–Mar', 2: 'Apr–Jun', 3: 'Jul–Sep', 4: 'Oct–Dec' },
  },
}
function L(lang) { return STRINGS[lang] || STRINGS.nl }

// ---- Geldhelpers (port van formatting.ts) ----

function round2(n) { return Math.round(n * 100) / 100 }

function formatCurrency(amount, currency = 'EUR', lang = 'nl') {
  try {
    return new Intl.NumberFormat(LOCALES[lang] || 'nl-NL', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2).replace('.', ',')}`
  }
}

function formatDate(isoDate, lang = 'nl') {
  const [year, month, day] = isoDate.split('-')
  if (lang === 'en') return `${parseInt(day, 10)} ${MONTHS_SHORT.en[parseInt(month, 10) - 1]} ${year}`
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

  // Taal: per factuur (invoice.language) override op de bedrijfs-default (business.language).
  const lang = data.invoice?.language || business?.language || 'nl'
  const S = L(lang)
  const fmtC = a => formatCurrency(a, 'EUR', lang)
  const fmtD = iso => formatDate(iso, lang)

  // BTW-kolom per regel tonen we alleen als er iets te kiezen valt: bij verlegd of bij
  // gemengde tarieven. Bij één uniform tarief (de normale consultant-factuur) laten we 'm weg
  // zodat de factuur niet onnodig drukker wordt — het tarief staat dan onderaan bij de totalen.
  const showVatColumn = c.vat_reverse_charged || c.vat_lines.length > 1
  const vatCellText = li => c.vat_reverse_charged ? S.vatReversedCell : `${li.vat_percentage}%`

  const rowsHtml = c.line_items.map(li => `
      <tr>
        <td class="desc">${escapeHtml(li.description)}</td>
        <td class="num">${escapeHtml(String(li.quantity))}</td>
        <td class="unit">${escapeHtml(S.units[li.unit] || li.unit)}</td>
        <td class="num">${escapeHtml(fmtC(li.rate))}</td>
        ${showVatColumn ? `<td class="num">${escapeHtml(vatCellText(li))}</td>` : ''}
        <td class="num">${escapeHtml(fmtC(li.amount))}</td>
      </tr>`).join('')

  const vatHeader = showVatColumn ? `<th class="num">${escapeHtml(S.vat)}</th>` : ''

  let vatRowHtml
  if (c.vat_reverse_charged) {
    vatRowHtml = `<tr><td class="t-label">${escapeHtml(S.vatReversedRow)}</td><td class="t-val">${escapeHtml(fmtC(0))}</td></tr>`
  } else if (c.vat_lines.length <= 1) {
    const pct = c.vat_lines[0]?.percentage ?? inv.vat_percentage
    vatRowHtml = `<tr><td class="t-label">${escapeHtml(S.vatRow(pct))}</td><td class="t-val">${escapeHtml(fmtC(c.vat_amount))}</td></tr>`
  } else {
    vatRowHtml = c.vat_lines.map(v =>
      `<tr><td class="t-label">${escapeHtml(S.vatRow(v.percentage))}</td><td class="t-val">${escapeHtml(fmtC(v.amount))}</td></tr>`).join('')
  }

  const contactParts = [business.phone, business.email].filter(Boolean).join(' &mdash; ')
  const termDays = data.payment_term_days ?? business.payment_terms_days ?? 14
  const termText = Number(termDays) === 0 ? S.termImmediate : S.termWithin(termDays)
  const reverseNote = c.vat_reverse_charged
    ? `<p class="reverse-note">${escapeHtml(S.reverseNote)}</p>` : ''
  const referenceRow = inv.reference
    ? `<div class="meta-line">${escapeHtml(S.reference)}: ${escapeHtml(inv.reference)}</div>` : ''
  const notesHtml = inv.notes ? `<p class="notes">${escapeHtml(inv.notes)}</p>` : ''
  const accountHolder = business.account_holder || business.name
  const payInstruction = escapeHtml(
    S.payInstruction(termText, business.iban, accountHolder, inv.number))

  const html = tpl
    .replaceAll('{{LANG}}', lang)
    .replaceAll('{{L_TO}}', escapeHtml(S.to))
    .replaceAll('{{L_TITLE}}', escapeHtml(S.invTitle))
    .replaceAll('{{L_NUMBER}}', escapeHtml(S.number))
    .replaceAll('{{L_DATE}}', escapeHtml(S.date))
    .replaceAll('{{L_DUE}}', escapeHtml(S.dueDate))
    .replaceAll('{{L_COL_DESC}}', escapeHtml(S.colDesc))
    .replaceAll('{{L_COL_QTY}}', escapeHtml(S.colQty))
    .replaceAll('{{L_COL_UNIT}}', escapeHtml(S.colUnit))
    .replaceAll('{{L_COL_RATE}}', escapeHtml(S.colRate))
    .replaceAll('{{L_COL_AMOUNT}}', escapeHtml(S.colAmount))
    .replaceAll('{{L_COC}}', escapeHtml(S.coc))
    .replaceAll('{{L_VAT}}', escapeHtml(S.vat))
    .replaceAll('{{L_SUBTOTAL}}', escapeHtml(S.subtotal))
    .replaceAll('{{L_TOTAL}}', escapeHtml(S.total))
    .replaceAll('{{BUSINESS_NAME}}', escapeHtml(business.name))
    .replaceAll('{{BUSINESS_ADDRESS}}', escapeHtml(business.address))
    .replaceAll('{{BUSINESS_POSTCODE_CITY}}', escapeHtml(`${business.postal_code} ${business.city}`))
    .replaceAll('{{BUSINESS_CONTACT}}', contactParts)
    .replaceAll('{{BUSINESS_KVK}}', escapeHtml(business.coc_number))
    .replaceAll('{{BUSINESS_VAT}}', escapeHtml(business.vat_number))
    .replaceAll('{{BUSINESS_IBAN}}', escapeHtml(business.iban))
    .replaceAll('{{CLIENT_NAME}}', escapeHtml(client.name))
    .replaceAll('{{CLIENT_ATTENTION}}', client.attention ? `<div>${escapeHtml(S.attention)} ${escapeHtml(client.attention)}</div>` : '')
    .replaceAll('{{CLIENT_ADDRESS}}', escapeHtml(client.address))
    .replaceAll('{{CLIENT_POSTCODE_CITY}}', escapeHtml(`${client.postal_code} ${client.city}`))
    .replaceAll('{{CLIENT_VAT}}', client.vat_number ? `<div>${escapeHtml(S.vat)}: ${escapeHtml(client.vat_number)}</div>` : '')
    .replaceAll('{{INVOICE_NUMBER}}', escapeHtml(inv.number))
    .replaceAll('{{INVOICE_DATE}}', escapeHtml(fmtD(inv.date)))
    .replaceAll('{{INVOICE_DUE_DATE}}', escapeHtml(fmtD(inv.due_date)))
    .replaceAll('{{REFERENCE_ROW}}', referenceRow)
    .replaceAll('{{VAT_HEADER}}', vatHeader)
    .replaceAll('{{LINE_ITEMS}}', rowsHtml)
    .replaceAll('{{SUBTOTAL}}', escapeHtml(fmtC(c.subtotal)))
    .replaceAll('{{VAT_ROWS}}', vatRowHtml)
    .replaceAll('{{TOTAL}}', escapeHtml(fmtC(c.total)))
    .replaceAll('{{REVERSE_NOTE}}', reverseNote)
    .replaceAll('{{NOTES}}', notesHtml)
    .replaceAll('{{PAY_INSTRUCTION}}', payInstruction)

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

  // Is het vorige kwartaal al vastgelegd, dan is er niets meer te doen: de "volgende" aangifte
  // om naar toe te werken is dan het lopende kwartaal (dat nog loopt, dus nog niet in te dienen is).
  // Zo blijft de tegel niet hangen op een allang afgehandeld kwartaal.
  const currentDeadlineYear = q === 4 ? year + 1 : year
  const currentDeadlineDate = `${currentDeadlineYear}-${DEADLINE_MMDD[q]}`
  const next_aangifte = recorded
    ? {
        quarter: `${year}-Q${q}`,
        deadline_date: currentDeadlineDate,
        deadline_days: daysBetween(today, currentDeadlineDate),
        recorded: false,
        quarter_ended: false,   // kwartaal loopt nog, aangifte kan nog niet worden ingediend
      }
    : { quarter: pQuarterStr, deadline_date, deadline_days, recorded, quarter_ended: true }

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
    next_aangifte,
    warnings,
  }
}

// ---- Dashboard-HTML (Vink "Rapport": printbaar statusvel, scherm/PDF-vriendelijk) ----
// Vink Design System-kleuren. Status-stippen: betaald/groen, verstuurd/oranje, te laat/rood, grijs.
const VINK = {
  green: '#22C55E', amber: '#FBBF24', red: '#EF4444', grey: '#9CA3AF',
  overdueText: '#B91C1C', ink: '#0A0A0B', teal: '#00C9A7', costBar: '#B7B1A6',
}
function renderDashboardHtml(data, outPath) {
  const { business } = data
  const d = data.dashboard
  const yt = d.year_totals
  const na = d.next_aangifte
  const currentQ = d.quarters.find(q => q.phase === 'current')
  const tpl = fs.readFileSync(path.join(TEMPLATES, 'dashboard.html'), 'utf8')

  // Taal: het dashboard is voor jezelf, dus altijd de bedrijfs-default (geen per-item override).
  const lang = business?.language || 'nl'
  const S = L(lang)
  const fmtC = a => formatCurrency(a, 'EUR', lang)
  const fmtD = iso => formatDate(iso, lang)

  const dayLabel = n => {
    if (n > 0) return S.daysOverdue(n)
    if (n === 0) return S.dueToday
    return S.inDays(-n)
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
    ? [{ t: S.nothingOutstanding }]
    : d.outstanding.overdue_count > 0
      ? [
          // Aantal facturen blijft muted; alleen het "N te laat"-deel kleurt rood.
          { html: `${escapeHtml(S.invoiceCount(d.outstanding.count))} · <span class="red">${escapeHtml(S.overdueCount(d.outstanding.overdue_count))}</span>` },
          { t: S.overdueAmount(fmtC(d.outstanding.overdue_total)), red: true },
        ]
      : [{ t: S.invoiceCount(d.outstanding.count) }]

  let aangifteLine
  if (na.recorded) aangifteLine = { t: `${na.quarter} · ${S.recorded}` }
  else if (!na.quarter_ended) aangifteLine = { t: `${na.quarter} · ${S.inProgress}` }
  else if (na.deadline_days < 0) aangifteLine = { t: `${na.quarter} · ${S.daysOverdue(-na.deadline_days)}`, red: true }
  else aangifteLine = { t: `${na.quarter} · ${S.inDays(na.deadline_days)}` }

  const kpiCards = [
    kpiCard(S.kpiRevenue, fmtC(yt.omzet), [
      { t: `${S.invoiceCount(yt.invoice_count)} · ${S.inclVat}` },
      { t: fmtC(yt.omzet_incl) },
    ]),
    kpiCard(S.kpiCosts, fmtC(yt.kosten), [
      { t: S.receiptCount(yt.receipt_count) },
    ]),
    kpiCard(S.kpiOutstanding, fmtC(d.outstanding.total), openstaandLines),
    kpiCard(S.kpiReturn, fmtD(na.deadline_date), [aangifteLine]),
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
    `<div><b style="color:${VINK.ink}">Q${q.q}</b> ${S.qmonths[q.q]}</div>`).join('')

  // --- Per-kwartaal-tabel: huidig kwartaal gemarkeerd, aangifte-status met stip. ---
  const quarterRows = d.quarters.map(qr => {
    const a = qr.aangifte
    let color, label
    if (a.recorded) { color = VINK.green; label = S.recordedCap }
    else if (qr.phase === 'future') { color = VINK.grey; label = '—' }
    else if (qr.phase === 'current') { color = VINK.grey; label = S.inProgress }
    else if (a.deadline_days < 0) { color = VINK.red; label = S.wasOverdue(fmtD(a.deadline_date)) }
    else { color = VINK.amber; label = S.fileBefore(fmtD(a.deadline_date)) }
    const isNow = qr.phase === 'current'
    return `
                <tr style="background:${isNow ? '#F7F3EB' : 'transparent'}">
                  <td><span class="qname">Q${qr.q}</span><span class="qmonths">${S.qmonths[qr.q]}</span>${isNow ? `<span class="nu">${escapeHtml(S.now)}</span>` : ''}</td>
                  <td class="r">${escapeHtml(fmtC(qr.omzet))}</td>
                  <td class="r">${escapeHtml(fmtC(qr.kosten))}</td>
                  <td class="r strong">${escapeHtml(fmtC(qr.net))}</td>
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
                  <td class="r strong">${escapeHtml(fmtC(i.total))}</td>
                  <td>${escapeHtml(fmtD(i.due_date))}</td>
                  <td><span class="status" style="color:${textColor}"><span class="dot" style="background:${dot}"></span>${escapeHtml(dayLabel(i.days_overdue))}</span></td>
                </tr>`
      }).join('')
    : `<tr><td colspan="5" class="empty">${escapeHtml(S.noOutstanding)}</td></tr>`

  const bizName = escapeHtml(business?.name || S.businessFallback)
  const subtitle = S.dashSubtitle(bizName, String(d.year), String(currentQ?.q ?? ''))
  const stamp = S.generatedOn(fmtD(d.generated_at))

  const html = tpl
    .replaceAll('{{LANG}}', lang)
    .replaceAll('{{L_TITLE}}', escapeHtml(S.dashTitle))
    .replaceAll('{{SUBTITLE}}', subtitle)
    .replaceAll('{{STAMP}}', stamp)
    .replaceAll('{{L_RESULT}}', escapeHtml(S.resultStrip))
    .replaceAll('{{L_RESULT_HINT}}', escapeHtml(S.resultHint))
    .replaceAll('{{L_CHART_TITLE}}', escapeHtml(S.chartTitle))
    .replaceAll('{{L_LEG_REV}}', escapeHtml(S.legendRevenue))
    .replaceAll('{{L_LEG_COST}}', escapeHtml(S.legendCosts))
    .replaceAll('{{L_SEC_QUARTER}}', escapeHtml(S.secQuarter))
    .replaceAll('{{L_SEC_OUTSTANDING}}', escapeHtml(S.secOutstanding))
    .replaceAll('{{L_TH_QUARTER}}', escapeHtml(S.thQuarter))
    .replaceAll('{{L_TH_REVENUE}}', escapeHtml(S.thRevenue))
    .replaceAll('{{L_TH_COSTS}}', escapeHtml(S.thCosts))
    .replaceAll('{{L_TH_RESULT}}', escapeHtml(S.thResult))
    .replaceAll('{{L_TH_RETURN}}', escapeHtml(S.thReturn))
    .replaceAll('{{L_TH_INVOICE}}', escapeHtml(S.thInvoice))
    .replaceAll('{{L_TH_CLIENT}}', escapeHtml(S.thClient))
    .replaceAll('{{L_TH_AMOUNT}}', escapeHtml(S.thAmount))
    .replaceAll('{{L_TH_DUE}}', escapeHtml(S.thDue))
    .replaceAll('{{L_TH_STATUS}}', escapeHtml(S.thStatus))
    .replaceAll('{{KPI_CARDS}}', kpiCards)
    .replaceAll('{{RESULTAAT}}', escapeHtml(fmtC(yt.net)))
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

// ---- Jaaropgave (jaaroverzicht voor de aangifte inkomstenbelasting) ----
// Eén boekjaar uit dezelfde CSV's: winst-en-verliesrekening, afschrijvingen, KIA, ondernemersaftrek
// en MKB-winstvrijstelling tot aan de belastbare winst, plus het BTW-jaaroverzicht en de
// balansposten die uit de administratie volgen. Wat de CSV's niet weten (urencriterium, starter,
// posten zonder bon) levert de skill aan via `opts`; al het rekenwerk zit hier.

// IB-kosten van één bon. Aftrekbare BTW is geen kost, niet-aftrekbare BTW wél; daarna telt alleen
// het zakelijke deel (business_pct). Zelfde aftrekbaarheidsregels als computeAangifte.
function receiptCost(r) {
  const amount = Number(r.amount_eur || 0)
  const vat = Number(r.vat_amount_eur || 0)
  const status = r.vat_status || 'non_deductible'
  const reverse = status === 'reverse_charge_non_eu' || status === 'reverse_charge_eu'
  const vatRecoverable = reverse || (status === 'deductible' && !NON_DEDUCTIBLE_CATEGORIES.includes(r.category))
  const pct = r.business_pct === '' || r.business_pct == null ? 100 : Number(r.business_pct)
  const base = round2(vatRecoverable ? amount - vat : amount)
  return { base, pct, cost: round2(base * pct / 100) }
}

// Lineaire afschrijving, tijdsevenredig per maand vanaf de aanschafmaand. Cumulatief gerekend
// (stand t/m 31-12 van een jaar), zodat alle jaren samen exact op aanschaf − restwaarde uitkomen.
function depreciate(asset, year) {
  const [py, pm] = asset.purchase_date.split('-').map(Number)
  const totalMonths = asset.years * 12
  const depreciable = Math.max(0, asset.cost - asset.residual)
  const cum = y => round2(depreciable * Math.min(totalMonths, Math.max(0, (y - py) * 12 + 13 - pm)) / totalMonths)
  return {
    afschrijving: round2(cum(year) - cum(year - 1)),
    boekwaarde_begin: round2(asset.cost - cum(year - 1)),
    boekwaarde_eind: round2(asset.cost - cum(year)),
  }
}

// Kleinschaligheidsinvesteringsaftrek over het totale investeringsbedrag van het jaar.
function computeKia(amount, k) {
  if (amount <= k.floor || amount > k.max) return 0
  if (amount <= k.pct_to) return round2(amount * k.pct / 100)
  if (amount <= k.fixed_to) return k.fixed
  return Math.max(0, round2(k.fixed - (amount - k.fixed_to) * k.taper_pct / 100))
}

function computeJaaropgave(year, opts = {}) {
  const today = todayISO()
  const yearEnd = `${year}-12-31`
  const provisional = today <= yearEnd
  const inYear = d => String(d || '').slice(0, 4) === String(year)
  const isIso = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
  const invoices = readCsvObjects(path.join(DATA, 'invoices.csv'))
  const receipts = readCsvObjects(path.join(DATA, 'receipts.csv'))
  const assetRows = readCsvObjects(path.join(DATA, 'assets.csv'))
  const aangiftes = readCsvObjects(path.join(DATA, 'aangiftes.csv'))
  const params = IB_PARAMS[year] || null
  const warnings = []

  if (provisional)
    warnings.push(`Boekjaar ${year} loopt nog — voorlopige stand per ${formatDate(today)} (omzet en kosten t/m vandaag, afschrijvingen over het hele jaar).`)

  // --- Omzet: verzonden/betaalde facturen op factuurdatum, excl. btw (zelfde grondslag als de BTW-aangifte) ---
  const yInvoices = invoices.filter(i => (i.status === 'sent' || i.status === 'paid') && inYear(i.date))
  const draftCount = invoices.filter(i => i.status === 'draft' && inYear(i.date)).length
  const omzet = round2(yInvoices.reduce((s, i) => s + Number(i.subtotal || 0), 0))
  const perKwartaal = [1, 2, 3, 4].map(q => {
    const qInv = yInvoices.filter(i => quarterOf(i.date).q === q)
    return { quarter: `${year}-Q${q}`, omzet: round2(qInv.reduce((s, i) => s + Number(i.subtotal || 0), 0)), invoice_count: qInv.length }
  })
  const klantMap = new Map()
  for (const i of yInvoices) {
    const key = i.client_id || i.client_name || 'onbekend'
    const k = klantMap.get(key) || { client_name: i.client_name || 'Onbekend', omzet: 0, invoice_count: 0 }
    k.omzet += Number(i.subtotal || 0)
    k.invoice_count++
    klantMap.set(key, k)
  }
  const perKlant = [...klantMap.values()]
    .map(k => ({ ...k, omzet: round2(k.omzet), aandeel_pct: omzet ? round2(k.omzet / omzet * 100) : 0 }))
    .sort((a, b) => b.omzet - a.omzet)

  // --- Bedrijfsmiddelen: apparatuur-bonnen ≥ €450 (alle jaren t/m dit jaar) + handmatig register ---
  // Een investering is geen kost in het aanschafjaar maar wordt geactiveerd en afgeschreven.
  const isInvestment = (r, c) => r.category === 'equipment' && c.base >= ASSET_THRESHOLD
  const assets = []
  let undatedReceipts = 0
  for (const r of receipts) {
    if (!isIso(r.date)) { undatedReceipts++; continue }
    const c = receiptCost(r)
    if (!isInvestment(r, c) || Number(r.date.slice(0, 4)) > year) continue
    if (c.pct < 100 && inYear(r.date))
      warnings.push(`Investering "${r.description || r.supplier_name}" is ${c.pct}% zakelijk — alleen dat deel (${formatCurrency(c.cost)}) is geactiveerd. Controleer of dat klopt met je keuze ondernemings-/privévermogen.`)
    assets.push({
      description: r.description || r.supplier_name || 'Bedrijfsmiddel', purchase_date: r.date,
      cost: c.cost, residual: 0, years: ASSET_DEFAULT_YEARS, kia: true, source: 'bon',
    })
  }
  for (const a of assetRows) {
    const cost = Number(a.cost_eur)
    const years = a.years === '' || a.years == null ? ASSET_DEFAULT_YEARS : Number(a.years)
    const residual = Number(a.residual_value_eur || 0)
    if (!isIso(a.purchase_date) || !(cost > 0) || !(years >= 1) || !(residual >= 0)) {
      warnings.push(`assets.csv: regel "${a.description || '?'}" overgeslagen (aanschafdatum, bedrag, restwaarde of aantal jaren ontbreekt of klopt niet).`)
      continue
    }
    if (Number(a.purchase_date.slice(0, 4)) > year) continue
    if ((cost - residual) / years > cost * 0.2 + 0.005)
      warnings.push(`assets.csv: "${a.description}" schrijft meer dan 20% per jaar af — fiscaal is 20% van de aanschafkosten het maximum.`)
    assets.push({
      description: a.description || 'Bedrijfsmiddel', purchase_date: a.purchase_date,
      cost: round2(cost), residual: round2(residual), years,
      kia: String(a.kia ?? '').toLowerCase() !== 'false', source: 'register',
    })
  }
  const activa = assets
    .map(a => ({ ...a, new_this_year: inYear(a.purchase_date), ...depreciate(a, year) }))
    .filter(a => a.afschrijving > 0 || a.boekwaarde_eind > 0)
    .sort((a, b) => a.purchase_date.localeCompare(b.purchase_date))
  const afschrijvingen = round2(activa.reduce((s, a) => s + a.afschrijving, 0))
  const investeringsbedrag = round2(activa.filter(a => a.new_this_year && a.kia).reduce((s, a) => s + a.cost, 0))

  // --- Kosten: bonnen op bondatum (niet op vat_period), excl. aftrekbare btw, zonder investeringen ---
  const catMap = new Map()
  let receiptCount = 0, otherVatYear = 0
  for (const r of receipts) {
    if (!inYear(r.date) || !isIso(r.date)) continue
    const c = receiptCost(r)
    if (isInvestment(r, c)) continue
    const cat = COST_CATEGORIES[r.category] ? r.category : 'other'
    const e = catMap.get(cat) || { bedrag: 0, count: 0 }
    e.bedrag += c.cost
    e.count++
    catMap.set(cat, e)
    receiptCount++
    if (r.vat_period && r.vat_period.slice(0, 4) !== String(year)) otherVatYear++
  }
  const perCategorie = Object.keys(COST_CATEGORIES).filter(c => catMap.has(c)).map(c => ({
    category: c, label: COST_CATEGORIES[c].label, rubriek: COST_CATEGORIES[c].rubriek,
    bedrag: round2(catMap.get(c).bedrag), count: catMap.get(c).count,
  }))
  const kostenBonnen = round2(perCategorie.reduce((s, c) => s + c.bedrag, 0))

  // --- Extra posten buiten de bonnen/facturen om (bv. zakelijke km privéauto, nog te factureren omzet) ---
  const extraPosten = (opts.extra_posten || []).map(p => {
    const bedrag = Number(p.bedrag)
    if (!p.omschrijving || !Number.isFinite(bedrag) || bedrag < 0 || !['kosten', 'opbrengst'].includes(p.soort))
      throw new Error('extra_posten: elke post heeft een omschrijving, een bedrag (≥ 0) en soort "kosten" of "opbrengst" nodig')
    return {
      omschrijving: String(p.omschrijving), soort: p.soort, bedrag: round2(bedrag),
      rubriek: p.soort === 'kosten' ? 'Andere kosten' : 'Overige opbrengsten',
    }
  })
  // Zakelijke kilometers met een privévervoermiddel: vast bedrag per km (jaarparameter), geen bon nodig.
  const zakelijkeKm = opts.zakelijke_km === '' || opts.zakelijke_km == null ? 0 : Number(opts.zakelijke_km)
  if (!Number.isFinite(zakelijkeKm) || zakelijkeKm < 0) throw new Error('zakelijke_km moet een getal ≥ 0 zijn')
  if (zakelijkeKm > 0 && params) {
    extraPosten.push({
      omschrijving: `Zakelijke kilometers privévervoermiddel (${new Intl.NumberFormat('nl-NL').format(zakelijkeKm)} km × ${formatCurrency(params.km_tarief)})`,
      soort: 'kosten', bedrag: round2(zakelijkeKm * params.km_tarief), rubriek: 'Auto- en transportkosten',
    })
  } else if (zakelijkeKm > 0) {
    warnings.push(`Zakelijke kilometers niet meegeteld: het kilometertarief voor ${year} zit niet in deze plugin-versie.`)
  }
  const extraKosten = round2(extraPosten.filter(p => p.soort === 'kosten').reduce((s, p) => s + p.bedrag, 0))
  const overigeOpbrengsten = round2(extraPosten.filter(p => p.soort === 'opbrengst').reduce((s, p) => s + p.bedrag, 0))
  const kosten = round2(kostenBonnen + extraKosten)

  const perRubriekMap = new Map()
  for (const c of perCategorie) perRubriekMap.set(c.rubriek, round2((perRubriekMap.get(c.rubriek) || 0) + c.bedrag))
  for (const p of extraPosten.filter(p => p.soort === 'kosten')) perRubriekMap.set(p.rubriek, round2((perRubriekMap.get(p.rubriek) || 0) + p.bedrag))
  const perRubriek = [...perRubriekMap.entries()].map(([rubriek, bedrag]) => ({ rubriek, bedrag }))

  // --- Van winst naar belastbare winst ---
  const winst = round2(omzet + overigeOpbrengsten - kosten - afschrijvingen)
  const beperktAftrekbaar = round2(perCategorie
    .filter(c => LIMITED_DEDUCTIBLE_CATEGORIES.includes(c.category)).reduce((s, c) => s + c.bedrag, 0))
  const nietAftrekbaar = round2(beperktAftrekbaar * (100 - LIMITED_DEDUCTIBLE_PCT) / 100)
  const fiscaleWinst = round2(winst + nietAftrekbaar)

  const urencriterium = opts.urencriterium === true ? true : opts.urencriterium === false ? false : null
  const starter = opts.startersaftrek === true
  let fiscaal = {
    winst, beperkt_aftrekbaar: beperktAftrekbaar, niet_aftrekbaar: nietAftrekbaar, fiscale_winst: fiscaleWinst,
    investeringsbedrag, kia: null, winst_voor_ondernemersaftrek: null,
    zelfstandigenaftrek: null, startersaftrek: null, niet_gerealiseerde_zelfstandigenaftrek: null,
    mkb_winstvrijstelling: null, belastbare_winst: null,
  }
  if (!params) {
    warnings.push(`Fiscale bedragen voor ${year} zitten niet in deze plugin-versie (wel: ${Object.keys(IB_PARAMS).join(', ')}) — KIA, ondernemersaftrek en MKB-winstvrijstelling zijn niet berekend.`)
  } else {
    const kia = computeKia(investeringsbedrag, params.kia)
    const winstVoorOA = round2(fiscaleWinst - kia)
    let zelfstandigenaftrek = 0, startersaftrek = 0, nietGerealiseerd = 0
    if (urencriterium) {
      startersaftrek = starter ? params.startersaftrek : 0
      // Zonder startersaftrek kan de zelfstandigenaftrek niet hoger zijn dan de winst; het restant
      // schuift door (9 jaar). Met startersaftrek mag de aftrek de winst wél overtreffen (verlies).
      zelfstandigenaftrek = starter ? params.zelfstandigenaftrek : Math.min(params.zelfstandigenaftrek, Math.max(0, winstVoorOA))
      nietGerealiseerd = round2(params.zelfstandigenaftrek - zelfstandigenaftrek)
    }
    const naOA = round2(winstVoorOA - zelfstandigenaftrek - startersaftrek)
    const mkb = round2(naOA * params.mkb_pct / 100)   // bij verlies negatief: verkleint het verlies
    fiscaal = {
      ...fiscaal, kia, winst_voor_ondernemersaftrek: winstVoorOA,
      zelfstandigenaftrek, startersaftrek, niet_gerealiseerde_zelfstandigenaftrek: nietGerealiseerd,
      mkb_winstvrijstelling: mkb, belastbare_winst: round2(naOA - mkb),
    }
    if (urencriterium === null)
      warnings.push('Urencriterium niet opgegeven — zelfstandigenaftrek (en startersaftrek) zijn niet toegepast.')
    if (starter && !urencriterium)
      warnings.push('Startersaftrek opgegeven zonder urencriterium — niet toegepast (startersaftrek vereist het urencriterium).')
    if (nietGerealiseerd > 0)
      warnings.push(`Winst is lager dan de zelfstandigenaftrek: ${formatCurrency(nietGerealiseerd)} is niet gerealiseerd en schuift door naar de volgende 9 jaar.`)
    if (investeringsbedrag > 0 && kia === 0)
      warnings.push(`Investeringen dit jaar ${formatCurrency(investeringsbedrag)} — onder de KIA-drempel van ${formatCurrency(params.kia.floor + 1)}, dus geen investeringsaftrek.`)
  }

  // --- BTW-jaaroverzicht: de vier kwartalen herberekend, naast wat met /aangifte is vastgelegd ---
  const quarterEnd = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' }
  const btwKwartalen = [1, 2, 3, 4].map(q => {
    const a = computeAangifte(year, q)
    const rec = aangiftes.filter(x => x.quarter === a.quarter).pop()   // laatst vastgelegde telt
    const vastgelegd_saldo = rec ? round2(Number(rec.r5g || 0)) : null
    return {
      quarter: a.quarter,
      ended: today > `${year}-${quarterEnd[q]}`,
      omzet: round2(a.rubrieken.filter(r => ['1a', '1b', '1e', '3a', '3b'].includes(r.code)).reduce((s, r) => s + r.omzet, 0)),
      verschuldigd: a.summary.verschuldigd,
      voorbelasting: a.summary.voorbelasting,
      saldo: a.summary.saldo,
      has_data: a.counts.invoices + a.counts.receipts > 0,
      vastgelegd: !!rec,
      vastgelegd_saldo,
      verschil: rec ? round2(a.summary.saldo - vastgelegd_saldo) : null,
    }
  })
  const btw = {
    kwartalen: btwKwartalen,
    omzet: round2(btwKwartalen.reduce((s, k) => s + k.omzet, 0)),
    verschuldigd: round2(btwKwartalen.reduce((s, k) => s + k.verschuldigd, 0)),
    voorbelasting: round2(btwKwartalen.reduce((s, k) => s + k.voorbelasting, 0)),
    saldo: round2(btwKwartalen.reduce((s, k) => s + k.saldo, 0)),
    verschil_vastgelegd: round2(btwKwartalen.reduce((s, k) => s + (k.verschil || 0), 0)),
  }
  const afwijkend = btwKwartalen.filter(k => k.vastgelegd && Math.abs(k.verschil) >= 0.01)
  if (afwijkend.length > 0) {
    const detail = afwijkend.map(k => `${k.quarter} ${formatCurrency(k.verschil)}`).join(', ')
    const actie = Math.abs(btw.verschil_vastgelegd) > 1000
      ? 'meer dan € 1.000: dien een suppletie in (binnen 8 weken na ontdekking)'
      : '€ 1.000 of minder: verwerk het in je eerstvolgende btw-aangifte'
    warnings.push(`BTW wijkt af van de vastgelegde aangifte(s) — ${detail} (herberekend − vastgelegd). Samen ${formatCurrency(btw.verschil_vastgelegd)}; ${actie}.`)
  }
  const nietVastgelegd = btwKwartalen.filter(k => k.ended && k.has_data && !k.vastgelegd)
  if (nietVastgelegd.length > 0)
    warnings.push(`BTW-aangifte nog niet vastgelegd voor ${nietVastgelegd.map(k => k.quarter).join(', ')} — draai /aangifte.`)
  if (Math.abs(btw.omzet - omzet) >= 0.01)
    warnings.push(`Omzet volgens de btw-rubrieken (${formatCurrency(btw.omzet)}) sluit niet aan op de omzet uit de facturen (${formatCurrency(omzet)}) — controleer invoice_items.csv.`)

  // --- Balansposten die uit de administratie volgen (peildatum: 31-12, of vandaag als het jaar nog loopt) ---
  const peildatum = provisional ? today : yearEnd
  const debiteuren = invoices
    .filter(i => (i.status === 'sent' || i.status === 'paid') && isIso(i.date) && i.date <= peildatum)
    .filter(i => i.status === 'sent' || (i.paid_at && i.paid_at > peildatum))
    .map(i => ({ number: i.number, client_name: i.client_name, date: i.date, total: round2(Number(i.total || 0)) }))
  const banksaldo = opts.banksaldo === '' || opts.banksaldo == null ? null : round2(Number(opts.banksaldo))
  if (banksaldo !== null && !Number.isFinite(banksaldo)) throw new Error('banksaldo moet een getal zijn')
  const q4 = btwKwartalen[3]
  const balans = {
    peildatum,
    materiele_vaste_activa: round2(activa.reduce((s, a) => s + a.boekwaarde_eind, 0)),
    debiteuren: round2(debiteuren.reduce((s, d) => s + d.total, 0)),
    debiteuren_lijst: debiteuren,
    // Btw-schuld/-vordering per 31-12 = saldo van het vierde kwartaal; null zolang dat nog loopt.
    btw_q4_te_betalen: !q4.ended ? null : q4.saldo > 0 ? q4.saldo : 0,
    btw_q4_te_vorderen: !q4.ended ? null : q4.saldo < 0 ? round2(-q4.saldo) : 0,
    banksaldo,
  }

  if (draftCount > 0) warnings.push(`${draftCount} concept-factu(u)r(en) in ${year} niet meegeteld (alleen verzonden/betaald telt mee).`)
  if (yInvoices.length === 0 && receiptCount === 0) warnings.push(`Geen facturen of bonnen gevonden in ${year}.`)
  if (undatedReceipts > 0) warnings.push(`${undatedReceipts} bon(nen) zonder geldige datum (YYYY-MM-DD) niet meegeteld.`)
  if (otherVatYear > 0)
    warnings.push(`${otherVatYear} bon(nen) uit ${year} zijn in een btw-kwartaal van een ander jaar geboekt — kosten tellen hier op bondatum mee, de btw in het geboekte kwartaal.`)
  const nieuw = activa.filter(a => a.new_this_year && a.source === 'bon')
  if (nieuw.length > 0)
    warnings.push(`${nieuw.length} apparatuur-bon(nen) van € ${ASSET_THRESHOLD} of meer als investering geactiveerd (lineair over ${ASSET_DEFAULT_YEARS} jaar, restwaarde € 0) in plaats van direct als kosten geboekt.`)
  if (beperktAftrekbaar > 0)
    warnings.push(`Eten & drinken ${formatCurrency(beperktAftrekbaar)}: ${LIMITED_DEDUCTIBLE_PCT}% aftrekbaar, ${formatCurrency(nietAftrekbaar)} bijgeteld bij de winst.`)
  if (perKlant.length > 0 && perKlant.length < 3)
    warnings.push(`Omzet komt van ${perKlant.length} opdrachtgever(s) — het aantal opdrachtgevers weegt mee bij de beoordeling van ondernemerschap (vuistregel, geen harde eis).`)

  return {
    year,
    generated_at: today,
    provisional,
    omzet: { totaal: omzet, per_kwartaal: perKwartaal, per_klant: perKlant, invoice_count: yInvoices.length },
    kosten: {
      totaal: kosten, bonnen: kostenBonnen, per_categorie: perCategorie, per_rubriek: perRubriek,
      receipt_count: receiptCount,
    },
    extra_posten: extraPosten,
    overige_opbrengsten: overigeOpbrengsten,
    activa,
    afschrijvingen,
    fiscaal,
    btw,
    balans,
    params: params ? { zelfstandigenaftrek: params.zelfstandigenaftrek, startersaftrek: params.startersaftrek, mkb_pct: params.mkb_pct, km_tarief: params.km_tarief } : null,
    options: { urencriterium, startersaftrek: starter, zakelijke_km: zakelijkeKm },
    ib_deadline: `1 mei ${year + 1}`,
    warnings,
  }
}

// ---- Jaaropgave-PDF ----
// Bewust Nederlands (net als de aangifte): de posten volgen de rubrieken van de IB-aangifte.
function renderJaaropgavePdf(data, outPath) {
  const { business } = data
  const j = data.jaaropgave
  const f = j.fiscaal
  const tpl = fs.readFileSync(path.join(TEMPLATES, 'jaaropgave.html'), 'utf8')
  const fmt = a => escapeHtml(formatCurrency(a))
  const min = a => `&minus;&nbsp;${fmt(a)}`

  // --- Winst-en-verliesrekening ---
  const row = (label, value, cls = '', hint = '') =>
    `<tr class="${cls}"><td class="l">${escapeHtml(label)}</td><td class="hint">${escapeHtml(hint)}</td><td class="num">${value}</td></tr>`
  const wv = [row('Opbrengsten', '', 'group'), row('Netto-omzet (excl. btw)', fmt(j.omzet.totaal), 'item', `${j.omzet.invoice_count} factu${j.omzet.invoice_count === 1 ? 'ur' : 'ren'}`)]
  for (const p of j.extra_posten.filter(p => p.soort === 'opbrengst')) wv.push(row(p.omschrijving, fmt(p.bedrag), 'item', p.rubriek))
  wv.push(row('Kosten', '', 'group'))
  for (const c of j.kosten.per_categorie) wv.push(row(c.label, fmt(c.bedrag), 'item', c.rubriek))
  for (const p of j.extra_posten.filter(p => p.soort === 'kosten')) wv.push(row(p.omschrijving, fmt(p.bedrag), 'item', p.rubriek))
  wv.push(row('Afschrijvingen', fmt(j.afschrijvingen), 'item', 'Afschrijvingen'))
  wv.push(row('Totaal kosten', fmt(round2(j.kosten.totaal + j.afschrijvingen)), 'subtotal'))
  wv.push(row('Winst volgens winst-en-verliesrekening', fmt(f.winst), 'total-row'))

  // --- Van winst naar belastbare winst ---
  const fiscaalRows = [row('Winst volgens winst-en-verliesrekening', fmt(f.winst))]
  if (f.niet_aftrekbaar > 0)
    fiscaalRows.push(row(`Bij: niet-aftrekbaar deel eten & drinken (${100 - LIMITED_DEDUCTIBLE_PCT}% van ${formatCurrency(f.beperkt_aftrekbaar)})`, `+&nbsp;${fmt(f.niet_aftrekbaar)}`))
  let resultLabel = 'Fiscale winst (vóór aftrekposten)', resultValue = f.fiscale_winst
  if (f.belastbare_winst != null) {
    if (f.kia > 0) fiscaalRows.push(row(`Af: kleinschaligheidsinvesteringsaftrek (over ${formatCurrency(f.investeringsbedrag)})`, min(f.kia)))
    fiscaalRows.push(row('Winst vóór ondernemersaftrek', fmt(f.winst_voor_ondernemersaftrek), 'subtotal'))
    if (f.zelfstandigenaftrek > 0) fiscaalRows.push(row('Af: zelfstandigenaftrek', min(f.zelfstandigenaftrek)))
    if (f.startersaftrek > 0) fiscaalRows.push(row('Af: startersaftrek', min(f.startersaftrek)))
    // Bij verlies werkt de vrijstelling andersom: ze verkleint het verlies.
    const mkbPct = `${String(j.params.mkb_pct).replace('.', ',')}%`
    fiscaalRows.push(f.mkb_winstvrijstelling < 0
      ? row(`Bij: MKB-winstvrijstelling (${mkbPct}, verkleint het verlies)`, `+&nbsp;${fmt(-f.mkb_winstvrijstelling)}`)
      : row(`Af: MKB-winstvrijstelling (${mkbPct})`, min(f.mkb_winstvrijstelling)))
    resultLabel = 'Belastbare winst uit onderneming'
    resultValue = f.belastbare_winst
  }

  // --- Omzet per kwartaal + per klant (top 8, rest samengevoegd) ---
  const quarterRows = j.omzet.per_kwartaal.map(k =>
    `<tr><td>${escapeHtml(k.quarter.replace('-Q', ' Q'))}</td><td class="num">${k.invoice_count}</td><td class="num">${fmt(k.omzet)}</td></tr>`).join('')
  const top = j.omzet.per_klant.slice(0, 8)
  const rest = j.omzet.per_klant.slice(8)
  const klanten = rest.length
    ? [...top, {
        client_name: `Overige (${rest.length})`,
        invoice_count: rest.reduce((s, k) => s + k.invoice_count, 0),
        omzet: round2(rest.reduce((s, k) => s + k.omzet, 0)),
        aandeel_pct: round2(rest.reduce((s, k) => s + k.aandeel_pct, 0)),
      }]
    : top
  const clientRows = klanten.length
    ? klanten.map(k => `<tr><td>${escapeHtml(k.client_name)}</td><td class="num">${k.invoice_count}</td><td class="num">${fmt(k.omzet)}</td><td class="num">${Math.round(k.aandeel_pct)}%</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Geen facturen in dit jaar.</td></tr>'

  // --- Bedrijfsmiddelen (alleen tonen als er iets geactiveerd is) ---
  const assetsBlock = j.activa.length ? `
  <div class="section">
    <h2>Bedrijfsmiddelen &amp; afschrijving</h2>
    <table class="t"><thead><tr><th>Omschrijving</th><th>Aangeschaft</th><th class="num">Aanschafwaarde</th><th class="num">Afschrijving ${j.year}</th><th class="num">Boekwaarde 31-12</th></tr></thead>
    <tbody>${j.activa.map(a => `<tr><td>${escapeHtml(a.description)}</td><td>${escapeHtml(formatDate(a.purchase_date))}</td><td class="num">${fmt(a.cost)}</td><td class="num">${fmt(a.afschrijving)}</td><td class="num">${fmt(a.boekwaarde_eind)}</td></tr>`).join('')}
    <tr class="total-row"><td colspan="3">Totaal</td><td class="num">${fmt(j.afschrijvingen)}</td><td class="num">${fmt(j.balans.materiele_vaste_activa)}</td></tr></tbody></table>
  </div>` : ''

  // --- BTW-jaaroverzicht ---
  const btwRows = j.btw.kwartalen.map(k => {
    let status = '—'
    if (k.vastgelegd) status = Math.abs(k.verschil) >= 0.01 ? `Vastgelegd · wijkt ${formatCurrency(k.verschil)} af` : 'Vastgelegd'
    else if (k.ended && k.has_data) status = 'Nog niet vastgelegd'
    else if (!k.ended && k.has_data) status = 'Loopt nog'
    return `<tr><td>${escapeHtml(k.quarter.replace('-Q', ' Q'))}</td><td class="num">${fmt(k.verschuldigd)}</td><td class="num">${fmt(k.voorbelasting)}</td><td class="num">${fmt(k.saldo)}</td><td class="status">${escapeHtml(status)}</td></tr>`
  }).join('') +
    `<tr class="total-row"><td>Totaal</td><td class="num">${fmt(j.btw.verschuldigd)}</td><td class="num">${fmt(j.btw.voorbelasting)}</td><td class="num">${fmt(j.btw.saldo)}</td><td></td></tr>`

  // --- Balansposten ---
  const b = j.balans
  const balansRows = [
    row('Materiële vaste activa (boekwaarde bedrijfsmiddelen)', fmt(b.materiele_vaste_activa), '', 'Vaste activa'),
    row(`Debiteuren — ${b.debiteuren_lijst.length} openstaande factu${b.debiteuren_lijst.length === 1 ? 'ur' : 'ren'} (incl. btw)`, fmt(b.debiteuren), '', 'Vorderingen'),
    b.btw_q4_te_betalen == null ? ''
      : b.btw_q4_te_vorderen > 0
        ? row('Btw vierde kwartaal, terug te vragen', fmt(b.btw_q4_te_vorderen), '', 'Vorderingen')
        : row('Btw vierde kwartaal, te betalen', fmt(b.btw_q4_te_betalen), '', 'Kortlopende schulden'),
    row('Banksaldo zakelijke rekening', b.banksaldo == null ? '<span class="todo">zelf invullen</span>' : fmt(b.banksaldo), '', 'Liquide middelen'),
  ].join('')

  const warningsBlock = j.warnings.length
    ? `<div class="warnings"><strong>Aandachtspunten</strong><ul>${j.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>` : ''

  const html = tpl
    .replaceAll('{{YEAR}}', escapeHtml(String(j.year)))
    .replaceAll('{{BADGE}}', j.provisional ? `<span class="badge">Voorlopig · stand ${escapeHtml(formatDate(j.generated_at))}</span>` : '')
    .replaceAll('{{BUSINESS_NAME}}', escapeHtml(business.name))
    .replaceAll('{{BUSINESS_VAT}}', escapeHtml(business.vat_number))
    .replaceAll('{{BUSINESS_KVK}}', escapeHtml(business.coc_number))
    .replaceAll('{{IB_DEADLINE}}', escapeHtml(j.ib_deadline))
    .replaceAll('{{WV_ROWS}}', wv.join(''))
    .replaceAll('{{FISCAAL_ROWS}}', fiscaalRows.join(''))
    .replaceAll('{{RESULT_LABEL}}', escapeHtml(resultLabel))
    .replaceAll('{{RESULT_VALUE}}', fmt(resultValue))
    .replaceAll('{{QUARTER_ROWS}}', quarterRows)
    .replaceAll('{{CLIENT_ROWS}}', clientRows)
    .replaceAll('{{ASSETS_BLOCK}}', assetsBlock)
    .replaceAll('{{BTW_ROWS}}', btwRows)
    .replaceAll('{{PEILDATUM}}', escapeHtml(formatDate(b.peildatum)))
    .replaceAll('{{BALANS_ROWS}}', balansRows)
    .replaceAll('{{WARNINGS_BLOCK}}', warningsBlock)

  htmlToPdf(html, outPath)
}

// ---- Jaaropgave deterministisch vastleggen (PDF + CSV-rij uit de berekende JSON) ----
function recordJaaropgave(data, outPath) {
  const j = data.jaaropgave
  if (!j?.year) throw new Error('jaaropgave.year ontbreekt')
  renderJaaropgavePdf(data, outPath)

  const f = j.fiscaal
  appendCsv(path.join(DATA, 'jaaropgaven.csv'), {
    year: j.year,
    generated_at: todayISO(),
    provisional: !!j.provisional,
    omzet: j.omzet.totaal,
    overige_opbrengsten: j.overige_opbrengsten,
    kosten: j.kosten.totaal,
    afschrijvingen: j.afschrijvingen,
    winst: f.winst,
    niet_aftrekbaar: f.niet_aftrekbaar,
    kia: f.kia ?? '',
    zelfstandigenaftrek: f.zelfstandigenaftrek ?? '',
    startersaftrek: f.startersaftrek ?? '',
    mkb_winstvrijstelling: f.mkb_winstvrijstelling ?? '',
    belastbare_winst: f.belastbare_winst ?? '',
    btw_saldo: j.btw.saldo,
    pdf_path: outPath,
  })

  return {
    year: j.year,
    provisional: !!j.provisional,
    winst: f.winst,
    belastbare_winst: f.belastbare_winst,
    ib_deadline: j.ib_deadline,
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
    case 'jaaropgave': {
      const [yearArg, optsArg] = args
      if (!/^\d{4}$/.test(yearArg || '')) throw new Error('Gebruik: jaaropgave <YYYY> [opties.json], bv. jaaropgave 2026')
      console.log(JSON.stringify(computeJaaropgave(parseInt(yearArg, 10), optsArg ? readJsonArg(optsArg) : {}), null, 2))
      break
    }
    case 'render-jaaropgave': {
      const [dataArg, out] = args
      if (!dataArg || !out) throw new Error('Gebruik: render-jaaropgave <jaaropgave.json> <out.pdf>')
      renderJaaropgavePdf(readJsonArg(dataArg), out)
      console.log(JSON.stringify({ pdf_path: out }))
      break
    }
    case 'record-jaaropgave': {
      const [dataArg, out] = args
      if (!dataArg || !out) throw new Error('Gebruik: record-jaaropgave <jaaropgave.json> <out.pdf>')
      console.log(JSON.stringify(recordJaaropgave(readJsonArg(dataArg), out)))
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
Beschikbaar: next-invoice-number | fx | compute-invoice | render-invoice | record-invoice | dashboard | render-dashboard | aangifte | render-aangifte | record-aangifte | jaaropgave | render-jaaropgave | record-jaaropgave | append | mark-paid`)
      process.exit(1)
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1) })
