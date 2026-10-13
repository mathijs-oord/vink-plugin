# Jaaropgave zzp'er — van administratie naar belastbare winst

*Laatst geverifieerd: 13 oktober 2026*

Kennisbron voor de `/jaaropgave`-skill. De rekenregels hieronder zijn geïmplementeerd in
`lib/admin.mjs` (`computeJaaropgave`); de jaarbedragen staan daar in `IB_PARAMS`.

## Wat is een "jaaropgave" voor een zzp'er?

- Een **jaaropgaaf** in de strikte zin krijgt een werknemer van zijn werkgever. Een zzp'er
  (eenmanszaak) krijgt die niet — je stelt je **jaarcijfers** zelf op.
- Die jaarcijfers bestaan uit een **winst-en-verliesrekening** en een **balans**. Een eenmanszaak
  hoeft geen jaarrekening te deponeren bij de KvK, maar je hebt de cijfers wél nodig voor:
  - de **aangifte inkomstenbelasting** (onderdeel *Winst uit onderneming*) — verplicht;
  - hypotheek, huur, lening (geldverstrekkers vragen 1–3 jaar jaarcijfers);
  - toeslagen en inkomensverklaringen.
- De aangifte bestaat uit een privédeel en een zakelijk deel. `/jaaropgave` levert het zakelijke deel.

## Wat de Belastingdienst vraagt

**Winst-en-verliesrekening**

| Rubriek | Wat | In Vink |
|---|---|---|
| Opbrengsten | Totale omzet uit verkoopfacturen, **excl. btw** | `invoices.csv`, status sent/paid, op factuurdatum |
| Inkoopkosten | Grondstoffen, voorraad, uitbesteed werk | geen eigen categorie (dienstverlener) |
| Afschrijvingen | Afschrijving op bedrijfsmiddelen dit jaar | `equipment`-bonnen ≥ € 450 + `assets.csv` |
| Bedrijfskosten | Auto, telefoon, internet, adviseurs, inventaris, … | `receipts.csv` per categorie |
| Financiële baten en lasten | Rente, kosten zakelijke lening | via `extra_posten` |
| Buitengewone baten en lasten | o.a. bijtelling privégebruik auto/woning | buiten scope |

In het aangifteprogramma is *Bedrijfskosten* verder uitgesplitst. De code stelt per bon-categorie een
rubriek voor (indeling op basis van het aangifteprogramma; de namen kunnen per aangiftejaar iets
afwijken — het totaal is wat telt):

| Bon-categorie | Voorgestelde rubriek |
|---|---|
| `travel` | Auto- en transportkosten |
| `marketing`, `food_drinks` | Verkoopkosten |
| `office`, `software`, `phone_internet`, `insurance`, `education`, `equipment` (< € 450), `other` | Andere kosten |

**Balans** (per 1 januari en 31 december)

| Rubriek | Wat | In Vink |
|---|---|---|
| Vaste activa | Boekwaarde bedrijfsmiddelen (aanschaf − afgeschreven) | berekend |
| Voorraden | Goederen voor verkoop/bewerking | buiten scope |
| Vorderingen | Openstaande verkoopfacturen, btw die je terugkrijgt | berekend (debiteuren incl. btw, btw Q4) |
| Liquide middelen | Banksaldo en kas op 31 december | optie `banksaldo` |
| Ondernemingsvermogen | Eigen vermogen + reserves | zelf invullen |
| Voorzieningen | Gereserveerde bedragen | buiten scope |
| Langlopende schulden | Leningen > 1 jaar | zelf invullen |
| Kortlopende schulden | Openstaande inkoopfacturen, nog te betalen belasting | btw Q4 berekend; rest zelf |

## Van omzet naar belastbare winst

```
Omzet (excl. btw)
+ Overige opbrengsten
− Kosten (excl. aftrekbare btw)
− Afschrijvingen
= Winst volgens winst-en-verliesrekening
+ Niet-aftrekbaar deel beperkt aftrekbare kosten (20% van eten & drinken)
− Kleinschaligheidsinvesteringsaftrek (KIA)
= Winst vóór ondernemersaftrek
− Zelfstandigenaftrek (+ startersaftrek)
− MKB-winstvrijstelling (% van wat dan overblijft)
= Belastbare winst uit onderneming
```

De belastbare winst gaat naar box 1. De inkomstenbelasting zelf, de heffingskortingen en de
Zvw-bijdrage berekent de Belastingdienst uit je hele aangifte — die rekent Vink niet uit.

## Jaarbedragen

| | 2025 | 2026 | 2027 (voorstel) |
|---|---|---|---|
| Zelfstandigenaftrek | € 2.470 | € 1.200 | € 900 |
| Startersaftrek | € 2.123 | € 2.123 | € 10, afgeschaft per 2028 |
| MKB-winstvrijstelling | 12,7% | 12,7% | 12,7% |
| Urencriterium | 1.225 uur | 1.225 uur | — |
| KIA: geen aftrek t/m | € 2.900 | € 2.900 | — |
| KIA: 28% van het bedrag | € 2.901 – € 70.602 | € 2.901 – € 71.683 | — |
| KIA: vast bedrag | € 19.769 (t/m € 130.744) | € 20.072 (t/m € 132.746) | — |
| KIA: afbouw 7,56% boven | € 130.744 (tot € 392.230) | € 132.746 (tot € 398.236) | — |
| Drempel beperkt aftrekbare kosten | € 5.700 (of 80%) | € 5.700 (of 80%) | — |
| Zakelijke km privévervoermiddel | € 0,23 | € 0,25 | — |
| Zvw-bijdrage zelfstandigen | 5,26% | 4,85% (max. bijdrage-inkomen € 79.409) | — |

- **2027** komt uit het Belastingplan 2027 (Prinsjesdag, 15 september 2026) en is bij het schrijven
  nog niet door het parlement aangenomen. Staat daarom **niet** in `IB_PARAMS`. Toevoegen zodra de
  Belastingdienst de bedragen publiceert.
- De € 0,25 per km over 2026 volgt uit het beleidsbesluit van 17 mei 2026 (Stcrt. 2026, 18302), met
  terugwerkende kracht tot 1 januari 2026. Het besluit vervalt per 1 januari 2027.
- Bij AOW-leeftijd aan het begin van het jaar gelden halve bedragen voor zelfstandigen- en
  startersaftrek (2026: € 600 / € 1.062). Niet geïmplementeerd.

## Rekenregels

**Omzet**
- Facturen met status `sent` of `paid`, op **factuurdatum**, excl. btw. Betaald of niet doet er niet
  toe: de omzet valt in het jaar waarin je het werk leverde en factureerde.
- Werk dat in december is gedaan maar in januari gefactureerd hoort bij het oude jaar → opgeven als
  extra opbrengst ("nog te factureren").

**Kosten**
- Bonnen op **bondatum**, niet op `vat_period`. Een bon uit december die in Q1 van het volgende jaar
  in de btw-aangifte is meegenomen, is voor de IB een kost van het oude jaar.
- **Excl. aftrekbare btw**: bij `deductible` en `reverse_charge_*` telt het bedrag zonder btw. Bij
  `non_deductible` (en bij `food_drinks`/`insurance`) is de btw niet terug te vragen en dus kosten.
- `business_pct` beperkt de kosten tot het zakelijke deel (bv. 70% van het telefoonabonnement).
- **Beperkt aftrekbaar**: eten, drinken, representatie, congressen en studiereizen zijn voor de IB 80%
  aftrekbaar. Alternatief is de drempelregeling (eerste € 5.700 niet aftrekbaar, de rest volledig) —
  die is pas gunstiger boven € 28.500 aan zulke kosten en is niet geïmplementeerd. De code telt 20% van
  categorie `food_drinks` bij de winst op.

**Investeringen en afschrijving**
- Bedrijfsmiddel van **€ 450 of meer** (excl. btw als je btw aftrekt): niet in één keer aftrekken maar
  activeren en afschrijven. Onder € 450: direct kosten.
- Afschrijving per jaar = (aanschafkosten − restwaarde) : gebruiksduur; maximaal **20% van de
  aanschafkosten** per jaar (goodwill 10%). Gebruik je het maar een deel van het jaar, dan schrijf je
  alleen over dat deel af (aanschaf 1 oktober → 3/12).
- De code: `equipment`-bon ≥ € 450 → lineair over 5 jaar, restwaarde € 0, per maand vanaf de
  aanschafmaand. Bedrijfsmiddelen zonder bon (van vóór Vink, of ingebracht uit privé) staan in
  `data/assets.csv` met eigen restwaarde en gebruiksduur.
- **KIA**: over het totaal van de investeringen in het jaar (elk ≥ € 450), volgens de tabel hierboven.
  Geen KIA op bedrijfsmiddelen uit je eigen privévermogen (`kia` = `false` in `assets.csv`).
- Verkoop je een bedrijfsmiddel binnen 5 jaar, dan kan een desinvesteringsbijtelling gelden (niet
  geïmplementeerd).

**Ondernemersaftrek**
- **Urencriterium**: minimaal 1.225 uur per kalenderjaar aan het feitelijk drijven van je
  onderneming, én meer tijd aan de onderneming dan aan ander werk. De 1.225 uur wordt niet naar rato
  verlaagd als je halverwege het jaar start. Alle uren voor de onderneming tellen, ook
  niet-declarabele (acquisitie, administratie, reistijd, scholing).
- De code telt de **gefactureerde uren** uit de factuurregels (eenheid uren; een dag = 8 uur). Dat is
  een ondergrens: halen die alleen al de 1.225, dan geldt het criterium als gehaald en vraagt de skill
  er niet naar. Zit je eronder, dan vraagt de skill één keer of je er met niet-declarabele uren wél
  komt. De tweede voorwaarde (meer tijd dan aan ander werk) is niet uit de administratie af te leiden.
- **Zelfstandigenaftrek** kan niet hoger zijn dan de winst vóór ondernemersaftrek, tenzij je ook
  startersaftrek krijgt. Het niet-gerealiseerde deel schuift door naar de volgende 9 jaar.
- **Startersaftrek**: in de 5 voorgaande jaren minstens 1 jaar geen ondernemer, en in die periode
  hooguit 2 keer zelfstandigenaftrek. Samen met de zelfstandigenaftrek mag dit een verlies opleveren.
- **MKB-winstvrijstelling**: 12,7% van de winst ná ondernemersaftrek; geen urencriterium nodig. Bij
  verlies verkleint de vrijstelling het verlies.

## BTW-jaarcontrole

De jaaropgave herberekent de vier kwartalen en legt ze naast wat met `/aangifte` is vastgelegd.
Wijkt het af (bv. een factuur of bon later toegevoegd of gecorrigeerd):

- **Verschil € 1.000 of minder** → verwerken in de eerstvolgende btw-aangifte, in de rubriek waar het
  bedrag hoort.
- **Meer dan € 1.000** → formulier *Suppletie btw* in Mijn Belastingdienst Zakelijk, zo snel mogelijk
  en uiterlijk binnen 8 weken na ontdekking.
- Corrigeren kan tot 5 jaar na het jaar waarop de correctie betrekking heeft.

De omzet in je IB-aangifte hoort aan te sluiten op de omzet in je btw-aangiftes van hetzelfde jaar;
de code controleert dat en waarschuwt bij een verschil.

## Deadlines

- Aangifte inkomstenbelasting: tussen 1 maart en **1 mei** van het jaar erna (uitstel aanvragen kan).
- Btw vierde kwartaal: aangifte en betaling vóór **31 januari**.

## Niet in de jaaropgave

Auto van de zaak en bijtelling, werkruimte thuis, voorraad en onderhanden werk, willekeurige
afschrijving (starters; vervalt volgens het voorstel per 2028), desinvesteringsbijtelling,
energie-/milieu-investeringsaftrek, meewerkaftrek, stakingsaftrek, privé-opnamen en -stortingen, het
privédeel van de aangifte (o.a. AOV-premie en lijfrente — dat zijn persoonlijke aftrekposten, geen
bedrijfskosten).

## Bronnen

- [Belastingdienst — Ondernemer? Welke cijfers u nodig hebt voor uw aangifte inkomstenbelasting](https://www.belastingdienst.nl/wps/wcm/connect/nl/belastingaangifte/content/ondernemer-bekijk-welke-cijfers-u-nodig-hebt-voor-uw-aangifte-inkomstenbelasting)
- [Belastingdienst — Winst-en-verliesrekening en balans (2025)](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2025/winst_en_verliesrekening_en_balans)
- [Belastingdienst — Ondernemersaftrek en investeringsaftrek (2025)](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2025/ondernemersaftrek_en_investeringsaftrek)
- [Belastingdienst — Ondernemersaftrek en investeringsaftrek (2026)](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/ondernemersaftrek_en_investeringsaftrek)
- [Belastingdienst — KIA 2025](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/verandering_inkomstenbelasting_vorige_jaren/veranderingen-inkomstenbelasting-2025/investeringsaftrek-2025/kleinschaligheidsinvesteringsaftrek-2025)
- [Belastingdienst — KIA 2026](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/veranderingen-inkomstenbelasting-2026/investeringsaftrek-2026/kleinschaligheidsinvesteringsaftrek-2026)
- [Belastingdienst — Drempel beperkt aftrekbare kosten 2025](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/verandering_inkomstenbelasting_vorige_jaren/veranderingen-inkomstenbelasting-2025/drempel-beperkt-aftrekbare-kosten-2025)
- [Belastingdienst — Drempel beperkt aftrekbare kosten 2026](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/veranderingen-inkomstenbelasting-2026/drempel-beperkt-aftrekbare-kosten-2026)
- [Belastingdienst — Hoe berekent u de afschrijving](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/afschrijving/hoe_berekent_u_het_bedrag_van_de_afschrijving)
- [Belastingdienst — Zakelijk gebruik privévervoermiddel 2026](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/veranderingen-inkomstenbelasting-2026/zakelijk-gebruik-privevervoermiddel-2026)
- [Staatscourant 2026, 18302 — Beleidsbesluit fiscale maatregelen n.a.v. de energieschok (€ 0,25/km)](https://zoek.officielebekendmakingen.nl/stcrt-2026-18302.html)
- [Belastingdienst — Btw-aangifte corrigeren (suppletie)](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_aangifte_doen_en_betalen/aangifte_corrigeren/)
- [Moore DRV — Prinsjesdag 2026: fiscale wijzigingen voor ondernemers (Belastingplan 2027)](https://www.moore-drv.nl/belastingplan-2027-top-10-mkb/)
- [Taxence — Maximum bijdrage-inkomen Zvw 2026](https://www.taxence.nl/nieuws/maximum-bijdrageloon-zvw-2026-vastgesteld/)
- [Knab — Jaarafsluiting maken als zzp'er](https://bieb.knab.nl/ondernemen/wat-is-een-jaarafsluiting-en-waarom-maak-je-die-als-zzper)
