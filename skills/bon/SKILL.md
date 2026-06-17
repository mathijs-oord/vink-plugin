---
name: bon
description: Verwerk een bon of inkoopfactuur als kostenpost — leest het document, classificeert de BTW (aftrekbaar / verlegd EU / verlegd niet-EU / niet-aftrekbaar), converteert vreemde valuta naar euro op de ECB-dagkoers, en schrijft alles weg naar receipts.csv voor de BTW-aangifte.
allowed-tools: Bash, Read, Write
---

# Bon / kosten verwerken

De gebruiker geeft een bon of inkoopfactuur op (pad naar PDF/afbeelding, of een omschrijving).
Verwerk het als kostenpost zó dat het correct meetelt in de BTW-aangifte.

## Stappen

### 1. Lees het document
Lees de PDF/afbeelding en extraheer:
- **leverancier** (naam), **leveranciers-BTW-nummer** (indien vermeld), **factuurnummer**, **datum**.
- **bedrag(en)** en **BTW-bedrag(en) + tarief(en)**, **valuta**.
- Signalen voor verlegging: staat er "BTW verlegd", "reverse charge", "VAT reverse charged",
  "Art. 44/194", of staat **jouw eigen** BTW-nummer (uit `data/business.json`) op de factuur
  terwijl er géén BTW is gerekend?

Vraag de gebruiker alleen wat je écht niet uit het document haalt (bv. categorie, of het
zakelijk percentage bij telefoon/internet).

### 2. Valuta → euro (alleen als ≠ EUR)
Niet-EUR bon? Haal de ECB-dagkoers op:
```
node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" fx USD 2026-03-15        # geeft {"rate":0.92,"rate_date":"2026-03-14"}
```
Gebruik de **bon-datum**. Weekend/feestdag → de CLI geeft automatisch de vorige beursdag terug
in `rate_date`. Bereken `amount_eur = original_amount * rate` en `vat_amount_eur = original_vat * rate`
(`round2`). Bewaar `original_currency`, `original_amount`, `original_vat_amount`, `exchange_rate`,
`exchange_rate_date`.

### 3. Categorie
Kies één: `office, travel, software, phone_internet, insurance, marketing, education,
food_drinks, equipment, other`. Bij telefoon/internet: vraag het **zakelijk percentage**
(`business_pct`, bv. 70) — dat schaalt de aftrekbare voorbelasting.

### 4. BTW-classificatie (`vat_status`) — deterministische beslisboom
Eerste match wint (port van Vink `vat-classification.ts`):

1. **Categorie `food_drinks` of `insurance`** → `non_deductible`
   (horeca-BTW uitgesloten, Art. 1 BUA; verzekering vrijgesteld, Art. 11).
2. **NL-leverancier (BTW-nr begint met NL) + BTW > 0** → `deductible` (rubriek 5b).
3. **EU-leverancier (niet-NL EU-prefix) + geen BTW óf verleggingstekst** → `reverse_charge_eu`
   (rubriek 4b + 5b, netto €0).
4. **Niet-EU leverancier + geen BTW óf verleggingstekst** → `reverse_charge_non_eu`
   (rubriek 4a + 5b, netto €0).
5. **Jouw eigen BTW-nr op de factuur + geen BTW geheven** → `reverse_charge_non_eu` (best guess;
   typisch buitenlandse SaaS zoals Anthropic/OpenAI). Bij EU-aanwijzing → `reverse_charge_eu`.
6. **Geen BTW op het document, geen andere signalen** → `non_deductible`
   (waarschijnlijk KOR-leverancier of vrijgesteld — geen aftrek).
7. **BTW wél geheven, maar geen leveranciers-BTW-nr** → `deductible`
   (vereenvoudigde factuur ≤€100, Art. 35b — aangenomen NL).

Twijfel? Lees `$CLAUDE_PLUGIN_ROOT/rules/kosten-voorbelasting.md` en `$CLAUDE_PLUGIN_ROOT/rules/nultarief-verlegd-vrijgesteld.md`.
Bij echte ambiguïteit kies de **fiscaal veilige** optie (`non_deductible`) en meld het.

### 5. Meerdere BTW-tarieven op één bon (bv. horeca 9% + 21%)
Zet `vat_breakdown` als JSON-string: `[{"percentage":9,"amount":2.10},{"percentage":21,"amount":4.20}]`.
`vat_amount_eur` = som van alle entries; `vat_percentage` = het dominante (hoogste-bedrag) tarief.

### 6. BTW-periode
`vat_period` = kwartaal van de bon-datum in formaat `YYYY-QN` (Q1=jan–mrt, Q2=apr–jun,
Q3=jul–sep, Q4=okt–dec). Bv. datum 2026-03-15 → `2026-Q1`.

### 7. Preview (compact) → bevestiging
Toon beknopt: leverancier, datum, bedrag (en originele valuta indien geconverteerd), BTW-bedrag,
`vat_status` + één regel waarom, categorie, kwartaal. Vraag bevestiging.

### 8. Na bevestiging: schrijf weg + bewaar origineel
1. **Kopieer het bronbestand** naar het kwartaalmapje `bonnen/<vat_period>/` (bewaarplicht
   Art. 52 AWR — origineel is het wettelijke bewijs). Maak het mapje eerst aan en kopieer dan:
   `mkdir -p bonnen/<vat_period>`. Gebruik `vat_period` uit stap 6 als mapnaam en een nette
   bestandsnaam: `bonnen/<vat_period>/YYYY-MM-DD-leverancier.pdf` (bv.
   `bonnen/2026-Q2/2026-04-15-apple.pdf`). Zet `file_path` op dat volledige pad.
2. **receipts.csv:** `node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" append data/receipts.csv '<row>'` met kolommen:
   `date, supplier_name, supplier_vat_number, supplier_invoice_number, description, category,
   amount_eur, vat_amount_eur, vat_percentage, vat_status, vat_breakdown, business_pct,
   vat_period, original_currency, original_amount, original_vat_amount, exchange_rate,
   exchange_rate_date, file_path, notes, created_at` (vandaag).
   Laat valuta-velden leeg voor EUR-bonnen; laat `vat_breakdown` leeg bij één tarief.

Meld kort: leverancier, bedrag, classificatie, kwartaal.

## Let hier op (wat vaak misgaat)
- **Bewaarplicht:** altijd het originele bestand kopiëren naar het kwartaalmapje
  `bonnen/<vat_period>/` — de gestructureerde velden zijn gemak, het origineel is het bewijs.
- **Horeca:** BTW niet aftrekbaar (BUA), maar het **bedrag incl. BTW** is wél een zakelijke kost
  voor de IB. We boeken 'm als `non_deductible` (telt niet mee in BTW-aangifte).
- **Gemengd gebruik** (telefoon/internet, soms reiskosten): `business_pct` bepaalt het aftrekbare
  deel van de voorbelasting.
- **Valuta:** converteer op de **bon-datum**, niet op vandaag.
- **Self-billing** (een opdrachtgever maakt een factuur namens jou): dat is **omzet**, geen kost —
  hoort als verkoopfactuur in `invoices.csv`, niet hier. Zie `$CLAUDE_PLUGIN_ROOT/rules/self-billing.md`.
- **Investering > €450 excl. BTW** (laptop, dure apparatuur): BTW is dit kwartaal volledig
  aftrekbaar (gewoon `deductible`), maar voor de **IB** moet je afschrijven — flag dit even naar
  de gebruiker. Zie `$CLAUDE_PLUGIN_ROOT/rules/afschrijving-investeringen.md`. (Afschrijving zelf is buiten scope.)
- **KOR-leverancier:** geen BTW op de factuur → niets af te trekken (`non_deductible`).

## Belangrijk
Geen verwijder-actie via de skill — een bon corrigeren/verwijderen doet de gebruiker met de hand
in `receipts.csv` (en het bestand in `bonnen/`).
