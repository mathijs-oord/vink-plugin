---
name: dashboard
description: Toon de huidige stand van zaken in een net HTML-dashboard — welke facturen nog openstaan (en hoeveel dagen te laat of nog te gaan), de opbrengsten en kosten van het lopende kwartaal, het indicatieve resultaat, en wanneer de eerstvolgende BTW-aangifte moet. Read-only momentopname uit facturen en bonnen.
allowed-tools: Bash, Read, Write
---

# Dashboard — stand van zaken

Genereer een overzichtelijk HTML-dashboard met de actuele stand: openstaande facturen, omzet en
kosten van het lopende kwartaal, en de eerstvolgende BTW-aangifte-deadline. Alles wordt
deterministisch uit de CSV's berekend; deze skill wijzigt niets aan de administratie.

## Stappen

### 1. Bereken de stand (deterministisch, read-only)
```
node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" dashboard
```
Dit leest `invoices.csv`, `receipts.csv` en `aangiftes.csv` en geeft JSON terug met:
- `year`, `current_quarter`, `generated_at`.
- `year_totals` — jaartotalen: `omzet` (ex btw), `omzet_incl`, `kosten`, `net`, `invoice_count`,
  `receipt_count`. Dit zijn de headline-cijfers, zodat een net-begonnen kwartaal geen leeg beeld geeft.
- `quarters[]` — de vier kwartalen van het jaar, elk met `omzet`, `kosten`, `net`, `phase`
  (`past`/`current`/`future`) en `aangifte` (`recorded`, `deadline_date`, `deadline_days`).
- `outstanding` — openstaande facturen (status `sent`): `total`, `count`, `overdue_count`,
  `overdue_total`, en `invoices[]` met per factuur `days_overdue` (>0 = te laat, ≤0 = nog te gaan),
  gesorteerd met de meest te late bovenaan.
- `next_aangifte` — het zojuist afgelopen kwartaal (het eerstvolgende dat je moet indienen):
  `quarter`, `deadline_date`, `deadline_days` (>0 = nog te gaan), `recorded`.
- `warnings` — bv. facturen over de vervaldatum, aangifte-deadline nabij/verlopen, concept-facturen.

De datum-, dagen- en geldberekeningen komen allemaal uit de code — niets zelf narekenen.

### 2. Genereer het HTML-dashboard
Lees de bedrijfsnaam uit `data/business.json` en bouw `/tmp/dashboard.json`:
```json
{ "business": { "name": "…uit business.json…" }, "dashboard": <de volledige JSON uit stap 1> }
```
Draai dan:
```
node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" render-dashboard /tmp/dashboard.json dashboard.html
```
Dit schrijft `dashboard.html` (KPI-tegels + tabel openstaande facturen, met licht/donker-thema).
Open het: `open dashboard.html`.

### 3. Vat de stand kort samen
Meld beknopt: omzet en kosten dit jaar, welk kwartaal nu loopt, aantal openstaande facturen (en of er
iets te laat is, met bedrag), en de eerstvolgende aangifte-deadline (welk kwartaal, over hoeveel
dagen). Loop de `warnings` na en benoem ze. Wijs de gebruiker op logische vervolgacties: `/betaald`
voor een binnengekomen betaling, `/aangifte` als de deadline nabij is en het kwartaal nog niet is
vastgelegd.

## Belangrijk
- **Read-only**: dit dashboard verandert niets. Het is een momentopname op de datum van vandaag.
- Openstaand = facturen met status `sent` (concept telt niet mee, betaald is klaar). Zet een
  binnengekomen betaling om met `/betaald` zodat de factuur van het dashboard verdwijnt.
- De headline-tegels tonen **jaartotalen** (omzet/kosten van het hele boekjaar), zodat een net
  begonnen kwartaal geen leeg beeld geeft. De **per-kwartaal-tabel** eronder laat zien welk kwartaal
  nu loopt, wat de vorige kwartalen deden, en de aangifte-status per kwartaal (vastgelegd / aangeven
  vóór … / te laat / loopt nog).
- Omzet is **ex btw** (de omzet die telt voor de zzp'er); de tegel toont het incl.-btw-bedrag erbij.
  Kosten zijn de **totaalbedragen** (incl. btw) van de bonnen — het is een liquiditeits-blik, geen
  winstberekening. Vandaar "indicatief resultaat".
- De "volgende BTW-aangifte" is het **vorige** kwartaal (dat je nu moet indienen), niet het lopende.
  Bij twijfel over de exacte cijfers: draai `/aangifte` voor de volledige rubrieken.
- `dashboard.html` schrijft de code naar de map van de gebruiker (relatief pad) — prima om te
  overschrijven; het is een wegwerpoverzicht dat je zo vaak kunt regenereren als je wilt.
