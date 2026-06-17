---
name: aangifte
description: Stel de kwartaal-BTW-aangifte samen uit de facturen en bonnen — berekent alle rubrieken (1a t/m 5g) en de ICP-opgaaf, genereert een PDF-overzicht en schrijft een regel weg naar aangiftes.csv. Ter voorbereiding van de aangifte op Mijn Belastingdienst Zakelijk.
allowed-tools: Bash, Read, Write
---

# BTW-aangifte samenstellen

Maak een kwartaaloverzicht voor de BTW-aangifte uit alle verkoopfacturen en bonnen. De
gebruiker geeft een kwartaal op (bv. "Q1 2026", "dit kwartaal", "vorig kwartaal").

## Stappen

### 1. Bepaal het kwartaal
Reken om naar `YYYY-QN`. "Dit kwartaal" / "vorig kwartaal" → leid af van vandaag
(Q1=jan–mrt, Q2=apr–jun, Q3=jul–sep, Q4=okt–dec). Bij twijfel: vraag het kwartaal.

### 2. Bereken de rubrieken (deterministisch)
```
node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" aangifte 2026-Q2
```
Dit leest `invoices.csv` (alleen `status` sent/paid in het kwartaal) + `receipts.csv`
(`vat_period` = kwartaal) + `clients.csv`, en geeft JSON terug met:
- `rubrieken[]` — 1a (21%), 1b (9%), 1e (overig/0%), 3a (buiten EU), 3b (binnen EU, verlegd),
  4a (inkoop buiten EU, verlegd), 4b (inkoop binnen EU, verlegd), 5a (verschuldigd),
  5b (voorbelasting), 5g (saldo).
- `icpEntries[]` + `icp_total` — intracommunautaire prestaties per EU-klant.
- `summary` (verschuldigd / voorbelasting / saldo), `saldo_richting`, `deadline`, `warnings`, `counts`.

De rekenregels (port van Vink `calculateBtw`): 5a = BTW van 1a+1b+4a+4b; 5b = voorbelasting +
4a-BTW + 4b-BTW (verlegging netto €0); 5g = 5a − 5b. Niets zelf narekenen — gebruik deze output.

### 3. Toon het overzicht + waarschuwingen
Presenteer de rubrieken beknopt, het saldo (te betalen of terug te vragen) en de deadline.
Loop de `warnings` na en meld ze (concept-facturen niet meegeteld, ontbrekend `business_pct`,
geen data, geen bonnen). Als iets oogt alsof er data mist (bv. wel facturen maar 0 bonnen),
wijs daarop voordat je een PDF maakt.

### 4. Genereer PDF + schrijf weg
Bouw `/tmp/aangifte.json`:
```json
{ "business": { …uit business.json… }, "aangifte": <de volledige JSON uit stap 2> }
```
Dan:
1. **PDF:** `node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" render-aangifte /tmp/aangifte.json aangiftes/2026-Q2-btw-aangifte.pdf`
2. **aangiftes.csv:** `node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" append data/aangiftes.csv '<row>'` met:
   `quarter, generated_at` (vandaag) `, r1a_omzet, r1a_btw, r1b_omzet, r1b_btw, r1e_omzet, r3a, r3b,
   r4a_omzet, r4a_btw, r4b_omzet, r4b_btw, r5a, r5b, r5g, icp_total, deadline, pdf_path`.
   Haal de rubriekwaarden uit de JSON (`r3a`/`r3b` = de omzet-velden van rubriek 3a/3b;
   `r5a`/`r5b`/`r5g` = `summary.verschuldigd`/`voorbelasting`/`saldo`).
3. Open de PDF: `open aangiftes/2026-Q2-btw-aangifte.pdf`.

Meld kort: kwartaal, saldo (te betalen/terug), deadline, pad naar de PDF. Als er ICP-regels zijn,
herinner de gebruiker dat er naast de BTW-aangifte ook een **ICP-opgaaf** moet (zie
`$CLAUDE_PLUGIN_ROOT/rules/icp-opgaaf.md`).

## Belangrijk
- Dit is een **voorbereidend overzicht**, geen ingediende aangifte. De gebruiker neemt de
  rubrieken over op Mijn Belastingdienst Zakelijk.
- Alleen facturen met `status` sent/paid tellen mee; concepten niet.
- Bonnen tellen mee op hun `vat_period`, niet op datum — zo kun je een vergeten bon in een al
  betaald kwartaal alsnog in het eerstvolgende kwartaal meenemen (geen suppletie nodig).
- Een al ingediend kwartaal opnieuw draaien geeft simpelweg een nieuwe PDF + extra CSV-regel; dat
  overschrijft niets. Corrigeren doet de gebruiker met de hand.
