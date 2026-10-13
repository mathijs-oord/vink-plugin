---
name: jaaropgave
description: Stel de jaaropgave (jaaroverzicht) van je onderneming samen uit de facturen en bonnen — winst-en-verliesrekening, afschrijvingen, investeringsaftrek, ondernemersaftrek en MKB-winstvrijstelling tot en met de belastbare winst, plus een BTW-jaaroverzicht en de balansposten. Genereert een PDF en schrijft een regel weg naar jaaropgaven.csv. Ter voorbereiding van de aangifte inkomstenbelasting (winst uit onderneming).
allowed-tools: Bash, Read, Write
---

# Jaaropgave samenstellen

Een zzp'er krijgt geen jaaropgaaf van een werkgever — die maakt zijn jaarcijfers zelf. Deze skill
stelt ze samen uit de verkoopfacturen en bonnen van één boekjaar: van omzet naar **belastbare winst
uit onderneming**, in de volgorde van de aangifte inkomstenbelasting. De gebruiker geeft een jaar op
(bv. "2026", "vorig jaar", "dit jaar tot nu toe").

Achtergrond en bronnen: `$CLAUDE_PLUGIN_ROOT/rules/jaaropgave.md`.

## Stappen

### 1. Bepaal het jaar
Reken om naar `YYYY`. "Vorig jaar" / "dit jaar" → leid af van vandaag. Loopt het jaar nog, dan is het
een **voorlopige** stand (handig om tussentijds de winst te peilen); de code markeert dat zelf.

### 2. Eerste berekening (deterministisch, read-only)
```
node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" jaaropgave 2026
```
Dit leest `invoices.csv`, `invoice_items.csv`, `receipts.csv`, `clients.csv`, `aangiftes.csv` en (als
het bestaat) `assets.csv`, en geeft JSON terug met:
- `omzet` — totaal excl. btw, `per_kwartaal[]`, `per_klant[]` (met `aandeel_pct`).
- `kosten` — `per_categorie[]` (met de bijbehorende `rubriek` uit de aangifte), `per_rubriek[]`, `totaal`.
- `activa[]` + `afschrijvingen` — bedrijfsmiddelen met afschrijving dit jaar en boekwaarde per 31-12.
- `fiscaal` — de stappen van `winst` naar `belastbare_winst` (niet-aftrekbaar deel, KIA,
  zelfstandigenaftrek, startersaftrek, MKB-winstvrijstelling).
- `btw` — de vier kwartalen herberekend, naast wat met `/aangifte` is vastgelegd (`verschil`).
- `balans` — vaste activa, debiteuren, btw vierde kwartaal, banksaldo.
- `provisional`, `ib_deadline`, `warnings`.

Niets zelf narekenen — gebruik deze output.

### 3. Vraag wat niet in de administratie staat
De CSV's weten dit niet. Vraag het **gegroepeerd, in één keer**:

1. **Urencriterium** — heb je in dat jaar minstens 1.225 uur aan je onderneming besteed, én meer tijd
   dan aan ander werk (bv. loondienst)? Zo ja → zelfstandigenaftrek.
2. **Startersaftrek** — was je in de 5 jaar daarvoor minstens 1 jaar géén ondernemer, en heb je de
   zelfstandigenaftrek in die periode hooguit 2 keer gehad? (Alleen relevant bij urencriterium = ja.)
3. **Zakelijke kilometers met je privéauto/-fiets** — hoeveel km? De code rekent met het vaste
   bedrag per km van dat jaar.
4. **Posten zonder bon of factuur** — werk dat in het jaar is gedaan maar pas daarna gefactureerd
   (hoort bij dit jaar), bankkosten, betaalde rente, kosten waarvan geen bon is ingevoerd.
5. **Bedrijfsmiddelen die niet als bon in de administratie staan** — gekocht vóór je Vink gebruikte
   en nog niet afgeschreven, of ingebracht vanuit privé (zie hieronder).
6. **Banksaldo van de zakelijke rekening op 31 december** (optioneel; komt op de balans).

Weet de gebruiker het urencriterium niet zeker: reken zónder zelfstandigenaftrek (de fiscaal veilige
kant) en meld dat. Vul nooit zelf "ja" in.

Loop ook de `warnings` uit stap 2 na vóór je verder gaat — met name ontbrekende BTW-aangiftes,
concept-facturen en bonnen die nog ingevoerd moeten worden. Mist er zichtbaar data (wel omzet, nauwelijks
bonnen), wijs daarop: elke vergeten bon is te veel betaalde belasting.

#### Bedrijfsmiddel toevoegen aan het register (alleen indien nodig)
Apparatuur-bonnen (categorie `equipment`) van € 450 of meer excl. btw herkent de code zelf als
investering — daar hoef je niets voor te doen. Alleen bedrijfsmiddelen zónder bon in `receipts.csv`
zet je in `data/assets.csv`:
```
node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" append data/assets.csv '{"description":"Bureau","purchase_date":"2024-03-01","cost_eur":800,"residual_value_eur":0,"years":5,"kia":"false","notes":"gekocht vóór Vink","created_at":"2026-01-15"}'
```
`cost_eur` = aanschafprijs excl. btw (of de waarde bij inbreng uit privé); `years` = gebruiksduur
(minimaal 5); `kia` = `false` bij inbreng uit privé en bij aanschaf in een eerder jaar. Toon de regel
en vraag bevestiging vóór je wegschrijft.

### 4. Herbereken met de opties
Schrijf `/tmp/jaaropgave-opties.json` (laat weg wat niet van toepassing is):
```json
{
  "urencriterium": true,
  "startersaftrek": false,
  "zakelijke_km": 1200,
  "extra_posten": [
    { "omschrijving": "Nog te factureren werk december", "soort": "opbrengst", "bedrag": 1500 },
    { "omschrijving": "Bankkosten zakelijke rekening", "soort": "kosten", "bedrag": 118.80 }
  ],
  "banksaldo": 18250.40
}
```
`soort` is `kosten` of `opbrengst`; `bedrag` is altijd positief en excl. btw. Draai dan:
```
node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" jaaropgave 2026 /tmp/jaaropgave-opties.json > /tmp/jaaropgave-calc.json
```

### 5. Toon het overzicht → bevestiging
Presenteer beknopt, in deze volgorde:
- omzet, kosten (per categorie), afschrijvingen → **winst**;
- de stappen naar de **belastbare winst** (alleen de regels die niet nul zijn);
- BTW-jaartotaal en of de kwartalen aansluiten op de vastgelegde aangiftes;
- de `warnings`, elk in één regel.

Vraag bevestiging voordat je de PDF maakt. Pas aan op feedback (stap 3/4) en toon opnieuw.

### 6. Genereer PDF + leg vast (één deterministische stap)
Bouw `/tmp/jaaropgave.json`:
```json
{ "business": { …uit data/business.json… }, "jaaropgave": <de volledige JSON uit stap 4> }
```
Draai dan:
```
node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" record-jaaropgave /tmp/jaaropgave.json jaaropgaven/2026-jaaropgave.pdf
```
Dit rendert de PDF **en** schrijft de `jaaropgaven.csv`-rij weg, rechtstreeks uit de berekende JSON —
je tikt geen bedrag over. Open de PDF: `open jaaropgaven/2026-jaaropgave.pdf`.

### 7. Meld kort
Jaar, winst, belastbare winst, deadline van de aangifte (`ib_deadline`), pad naar de PDF. Zeg erbij
waar de cijfers heen gaan: Mijn Belastingdienst → aangifte inkomstenbelasting → *Winst uit
onderneming* (winst-en-verliesrekening, balans, ondernemersaftrek). Bij een afwijking in het
BTW-jaaroverzicht: noem de vervolgstap uit de waarschuwing (verwerken in de volgende aangifte of
suppletie).

## Hoe de code rekent (zodat je het kunt uitleggen)
- **Omzet** = facturen met status sent/paid op **factuurdatum**, excl. btw (ook als ze nog niet
  betaald zijn). Concepten tellen niet mee.
- **Kosten** = bonnen op **bondatum** (niet op `vat_period`), **excl. aftrekbare btw**. Niet-aftrekbare
  btw (horeca, geen leveranciers-btw-nummer) is zelf kosten. `business_pct` beperkt de kosten tot het
  zakelijke deel.
- **Eten & drinken** (`food_drinks`): 80% aftrekbaar — de code telt 20% weer bij de winst op.
- **Investeringen**: `equipment`-bon ≥ € 450 excl. btw → geen kosten in één keer, maar lineair
  afgeschreven over 5 jaar (restwaarde € 0), tijdsevenredig vanaf de aanschafmaand. Het
  investeringsbedrag van het jaar telt voor de **KIA**.
- **Volgorde**: winst → + niet-aftrekbaar deel → − KIA → winst vóór ondernemersaftrek →
  − zelfstandigenaftrek/startersaftrek → − MKB-winstvrijstelling → belastbare winst.

## Belangrijk
- Dit is een **voorbereidend overzicht**, geen ingediende aangifte en geen fiscaal advies. De
  gebruiker neemt de cijfers over in de aangifte; de Belastingdienst berekent daarna de belasting,
  heffingskortingen en de Zvw-bijdrage. Die rekent deze skill **niet** uit.
- **Buiten scope** (meld het als het speelt, en verwijs naar een boekhouder): auto van de zaak en
  bijtelling, werkruimte thuis, voorraad en onderhanden werk, willekeurige afschrijving, afwijkende
  restwaarde of gebruiksduur bij bonnen, de drempelregeling i.p.v. 80%, AOW-leeftijd (halve
  aftrekbedragen), meewerkaftrek, privé-opnamen en -stortingen.
- **AOV-premie en lijfrente** zijn geen bedrijfskosten maar persoonlijke aftrekposten in het privédeel
  van de aangifte. Staat er zo'n bon onder `insurance`, wijs de gebruiker daarop.
- Een investering die géén bedrijfsmiddel is (bv. één factuur met meerdere losse spullen onder € 450
  per stuk) hoort niet in categorie `equipment` — de gebruiker past de categorie met de hand aan in
  `receipts.csv`.
- Fiscale bedragen zitten per jaar in de code. Voor een jaar dat (nog) niet ondersteund wordt rekent
  de code tot en met de fiscale winst en meldt dat.
- Opnieuw draaien geeft een nieuwe PDF + extra CSV-regel; dat overschrijft niets. Geen
  verwijder-acties via de skill.
