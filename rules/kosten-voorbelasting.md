# Zakelijke kosten & voorbelasting

*Laatst geverifieerd: 20 februari 2026*

## Kostencategorieën — BTW-behandeling

### Volledig BTW-aftrekbaar

| Categorie                | BTW                              | Toelichting                                                   |
| ------------------------ | -------------------------------- | ------------------------------------------------------------- |
| Kantoorkosten            | 21%, volledig                    | Standaard zakelijke kosten                                    |
| Reiskosten               | 9% (OV) / 21% (overig), volledig | Woon-werkverkeer niet aftrekbaar (IB), maar BTW wel           |
| Software/SaaS            | 21%, volledig                    | Buitenlandse SaaS: zie "Buitenlandse inkoop" hieronder         |
| Marketing                | 21%, volledig                    | Reclame, advertenties, website, drukwerk                      |
| Boekhouder/administratie | 21%, volledig                    | Boekhoudkosten, fiscaal advies, KVK-kosten                    |
| Vakliteratuur/cursussen  | 21% (als niet vrijgesteld)       | CRKBO-opleidingen zijn BTW-vrijgesteld (0% op factuur)        |

### NIET BTW-aftrekbaar

| Categorie             | Waarom          | Details                                                                                                               |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Eten & drinken**    | Art. 1 BUA      | Horeca-BTW uitgesloten van aftrek. Kosten zelf wel 80% aftrekbaar voor IB                                             |
| **Verzekeringen**     | BTW-vrijgesteld | Er wordt geen BTW maar assurantiebelasting (21%) gerekend — niet aftrekbaar als voorbelasting                         |
| **Relatiegeschenken** | BUA-drempel     | >€227 per relatie per jaar (excl. BTW): BTW niet aftrekbaar op totaal voor die relatie. Onder drempel: wél aftrekbaar |
| Boetes                | Niet aftrekbaar | Nooit                                                                                                                 |
| Privé-uitgaven        | Niet zakelijk   | Nooit                                                                                                                 |

### Deels BTW-aftrekbaar (gemengd gebruik)

| Categorie                | Behandeling                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Telefoon/internet        | Alleen zakelijk % van BTW aftrekbaar (bv. 70% zakelijk = 70% van BTW)                                                                      |
| Apparatuur (laptop etc.) | Bij >10% privégebruik: BTW naar rato. Bij ≥€450 excl. BTW: afschrijven + 5-jaars herzieningsregel BTW. Zie `afschrijving-investeringen.md` |
| Thuiskantoor             | Inrichtingskosten: BTW aftrekbaar. Huur/hypotheek: meestal niet aftrekbaar voor IB tenzij zelfstandige werkruimte met eigen opgang/toilet  |
| Auto                     | Complex. Alleen zakelijk deel BTW aftrekbaar. Verplichte Q4-correctie. Kilometeradministratie vereist                                      |
| Representatie            | Max 80% aftrekbaar voor IB. BTW: eten & drinken niet aftrekbaar (BUA)                                                                      |

## Bon vs. inkoopfactuur

| Type                      | Wat             | Voorbeeld        | BTW-aftrek vereisten                                    |
| ------------------------- | --------------- | ---------------- | ------------------------------------------------------- |
| **Bon** (≤€100)           | Kassabon        | AH, Mediamarkt   | Vereenvoudigd: datum, naam, omschrijving, bedrag+tarief |
| **Inkoopfactuur** (>€100) | Formele factuur | Accountant, SaaS | Volledig Art. 35a: incl. BTW-nr leverancier, factuurnr  |

Beide → voorbelasting (rubriek 5b).

**Uitzonderingen op de inkoopfactuur-eis boven €100:**

* **Personenvervoer** (NS, GVB, taxi, etc.) — vervoersbewijs of transactieoverzicht geldt als factuur (Art. 34g Uitv.besch. OB). BTW-nummer leverancier niet vereist.
* **Parkeerautomaten en tolheffing** — idem Art. 34g.
* **Self-billing** — factuur komt van de opdrachtgever, zie `self-billing.md`.
* **Formeel gebrek vs. materieel recht** — ontbrekend BTW-nummer van leverancier blokkeert aftrek niet zolang materiële voorwaarden vervuld zijn en de uitgave aantoonbaar zakelijk is (HvJ EU Barlis 06 C-516/14, Senatex C-518/14). In de praktijk: vraag bij reguliere leveranciers alsnog een correcte factuur op; bij OV/parkeren hoeft dat dus niet.

## Voorbelasting bij buitenlandse inkoop

| Leverancier           | Behandeling                | BTW-aangifte      |
| --------------------- | -------------------------- | ----------------- |
| NL (bv. TransIP)      | BTW op factuur → aftrekken | 5b                |
| EU (bv. Figma, Slack) | Verleggen                  | 4b + 5b = netto 0 |
| Buiten EU (bv. AWS)   | Verleggen                  | 4a + 5b = netto 0 |

**Let op: B2C-facturen van buitenlandse SaaS (OSS/MOSS)**

Veel niet-EU SaaS-leveranciers (Anthropic, OpenAI, GitHub) zijn via OSS/MOSS geregistreerd voor EU-BTW. Als je géén BTW-nummer hebt opgegeven, behandelen ze je als particulier (B2C) en rekenen 21% Nederlandse BTW. Dit is géén verlegde BTW — het is gewone BTW die de leverancier afdraagt.

Gevolgen:
- De BTW op zo'n factuur is alleen aftrekbaar als voorbelasting als de factuur voldoet aan Art. 35a Wet OB — inclusief het BTW-nummer van de leverancier
- Ontbreekt het BTW-nummer van de leverancier op de factuur → BTW niet aftrekbaar als voorbelasting
- De kosten (incl. BTW) zijn wél aftrekbaar voor inkomstenbelasting

Oplossing: voeg je BTW-nummer toe aan je account bij de leverancier. De leverancier schakelt over op B2B-facturering → geen BTW op factuur → jij verrekent via verlegde BTW (4a + 5b = netto 0). Dit is ook financieel voordeliger.

## Self-billing = INKOMEN, niet kosten

Factuur van intermediair (Babbage, Yacht, Hays) namens jou = **verschuldigde BTW** (rubriek 1a), niet voorbelasting. Zie `self-billing.md`.

## Bronnen

* [Belastingdienst — Administratie bijhouden](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/)

* [Belastingdienst — Overzicht aftrekbare zakelijke kosten](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/zakelijke_kosten/overzicht-mogelijk-aftrekbare-zakelijke-kosten)

* [Belastingdienst — Vrijstelling BTW verzekeringen](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/tarieven_en_vrijstellingen/vrijstellingen/financiele_diensten_en_verzekeringen/)

* [Belastingdienst — BTW relatiegeschenken](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_aftrekken/personeelsvoorzieningen_en_relatiegeschenken/)

* [Belastingdienst — Gemengd gebruik BTW](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_aftrekken/privegebruik/gemengd_gebruik/gemengd_gebruik)

* [Belastingdienst — Werkruimte in de woning](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/werkruimte_in_de_woning)

* [ZZP Nederland — Aftrekposten 2026](https://www.zzp-nederland.nl/kennisbank/aftrekposten-2026-dit-mag-jij-als-zzper-aftrekken)
