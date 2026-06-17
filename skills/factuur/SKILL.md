---
name: factuur
description: Maak een verkoopfactuur voor een klant — vult uurprijs/omschrijving/aantal aan op basis van eerdere facturen, kent het juiste oplopende factuurnummer toe (YYYY-NNNN), genereert een PDF in het vaste Vink-format en schrijft alles weg naar de CSV's voor de BTW-aangifte.
allowed-tools: Bash, Read, Write
---

# Factuur maken

Maak een verkoopfactuur. De gebruiker geeft een **klant** op en optioneel een **omschrijving**
van wat gefactureerd moet worden. Vul ontbrekende details zoveel mogelijk zelf aan op basis van
eerdere facturen voor dezelfde klant.

## Stappen

### 1. Lees de basis
- `data/business.json` (afzender).
- `data/clients.csv` — zoek de klant (fuzzy op naam). Meerdere matches → vraag welke.
- **Klant niet gevonden?** Vraag de ontbrekende gegevens (naam, t.a.v., adres, postcode, plaats,
  land, evt. BTW-nummer) en voeg een rij toe aan `clients.csv` met een nieuw `id` (`c_002`, …,
  hoogste bestaande +1). Zonder adres/postcode/plaats kan er geen geldige factuur (Art. 35a).

### 2. Smart defaults uit eerdere facturen
- Filter `data/invoices.csv` op deze `client_id`; pak de **meest recente** factuur.
- Haal de bijbehorende regels uit `data/invoice_items.csv` (`invoice_number` match).
- Gebruik die als default voor **uurprijs (`rate`), eenheid (`unit`) en omschrijving** waar de
  gebruiker niets opgeeft. Aantal (`quantity`) vraag je als het niet gegeven is — dat verschilt
  meestal per maand. Pas omschrijvingen met een maand/periode erin aan naar de juiste periode
  (bv. "Product consultancy mar 2026" → "… apr 2026").
- Geen eerdere factuur én geen input → vraag de gebruiker om regels (omschrijving, aantal,
  eenheid, tarief).

### 3. Bepaal BTW
- Default: **NL 21%** per regel. 9% of 0% alleen als de gebruiker dat expliciet aangeeft;
  gemengde tarieven per regel mogen (zie `$CLAUDE_PLUGIN_ROOT/rules/btw-tarieven.md`).
- **Uitzondering — verlegd** (`vat_reverse_charged: true`): alléén als je een **buitenlandse
  zakelijke klant** factureert (BTW-nummer begint niet met `NL`). Dan geen BTW op de factuur +
  automatische verleggings-zin op de PDF, en het telt in rubriek 3a/3b + ICP. Zeldzaam — bij
  NL-klanten nooit. Twijfel? Lees `$CLAUDE_PLUGIN_ROOT/rules/nultarief-verlegd-vrijgesteld.md`.

### 4. Nummer & datums
- Factuurnummer: `node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" next-invoice-number` → `YYYY-NNNN`. **Nooit zelf verzinnen.**
- Datum: vandaag, tenzij anders opgegeven.
- Vervaldatum: datum + betaaltermijn. Termijn = `client.payment_terms` (kolom in clients.csv),
  anders `business.payment_terms_days` (14).
- **Kwartaal** uit de factuurdatum: `YYYY-QN` (Q1=jan–mrt, Q2=apr–jun, Q3=jul–sep, Q4=okt–dec).
  De PDF gaat in het kwartaalmapje `facturen/<YYYY-QN>/` (bv. datum 2026-05-08 → `facturen/2026-Q2/`).
  Het mapje wordt automatisch aangemaakt door `render-invoice` als het nog niet bestaat.

### 5. Preview (compact) → bevestiging
Bouw de invoice-JSON en draai `node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" compute-invoice <pad.json>` om subtotaal/BTW/
totaal deterministisch te krijgen. Toon een **compacte** preview met alleen beslis-relevante data:

```
Factuur 2026-0005 — Voorbeeld Klant B.V. — datum 05-06-2026, vervalt 19-06-2026
  24    Uren   Consultancy apr 2026        € 100,00   € 2.400,00
  5,5   Uren   AI-consultancy apr 2026     € 100,00   €   550,00
  Subtotaal € 2.950,00   BTW 21% € 619,50   Totaal € 3.569,50
```

Vraag expliciet om bevestiging vóór je iets wegschrijft. Pas aan op feedback en toon opnieuw.

### 6. Na bevestiging: schrijf weg + genereer PDF
Bouw `/tmp/factuur.json`:
```json
{
  "business": { …uit business.json… },
  "client":   { …uit clients.csv (name, attention, address, postal_code, city, vat_number)… },
  "invoice": {
    "number": "2026-0005", "date": "2026-06-05", "due_date": "2026-06-19",
    "vat_reverse_charged": false, "reference": "", "notes": "",
    "line_items": [
      {"description":"…","quantity":24,"unit":"hours","rate":150,"vat_percentage":21}
    ]
  },
  "payment_term_days": 14
}
```
Dan (vervang `<YYYY-QN>` door het kwartaal uit stap 4):
1. **PDF:** `node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" render-invoice /tmp/factuur.json facturen/<YYYY-QN>/2026-0005.pdf`
   (print de berekende totalen terug — gebruik die voor de CSV zodat ze 1-op-1 kloppen). Het
   kwartaalmapje wordt automatisch aangemaakt.
2. **invoices.csv:** `node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" append data/invoices.csv '<row>'` met:
   `number, date, due_date, client_id, client_name, subtotal, vat_percentage, vat_amount,
   total, vat_reverse_charged, status="sent", source="created", self_billing="false",
   reference, notes, pdf_path, created_at` (vandaag). `pdf_path` = `facturen/<YYYY-QN>/2026-0005.pdf`
   (hetzelfde pad als bij render — moet exact kloppen).
3. **invoice_items.csv:** per regel een append met
   `invoice_number, line_no, description, quantity, unit, rate, amount, vat_percentage`.
4. Open de PDF: `open facturen/<YYYY-QN>/2026-0005.pdf`.

Meld kort: nummer, klant, totaal, pad naar de PDF.

## Factuureisen (Art. 35a Wet OB) — afgedwongen
Afzender naam/adres/BTW-nr/KvK/IBAN, klantnaam + adres, oplopend factuurnummer, factuurdatum,
≥1 regel met omschrijving/aantal/tarief, BTW-bedrag (of verleggings-vermelding). Ontbreekt er
iets bij afzender of klant → vul aan vóór je genereert. Details: `$CLAUDE_PLUGIN_ROOT/rules/factuureisen.md`.

## Belangrijk
- `status` van een nieuwe factuur = `sent` (hij telt dan mee in de BTW-aangifte). Gebruik
  `draft` alleen als de gebruiker een concept wil — concepten tellen niet mee in de aangifte.
- Status later op `paid` zetten (+ betaaldatum): met `/betaald`. Een factuur
  corrigeren/verwijderen: met de hand in `invoices.csv`. De skill heeft geen verwijder-actie
  (bewuste keuze).
