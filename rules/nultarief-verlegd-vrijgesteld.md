# BTW: Nultarief, Verlegd & Vrijgesteld

*Laatst geverifieerd: 20 februari 2026*

Drie situaties die er hetzelfde uitzien ("geen BTW") maar juridisch anders werken.

## Overzicht

| Situatie | BTW op factuur | Voorbelasting aftrekbaar? | BTW-aangifte |
|----------|---------------|--------------------------|--------------|
| **Nultarief (0%)** | 0% vermeld | Ja | Rubriek 1e |
| **BTW verlegd** | Geen BTW, "BTW verlegd" | Ja | Rubriek 3a/3b |
| **Vrijgesteld** | Geen BTW | **Nee** | Niet aangeven |

## Nultarief (0%)

Geldt voor beperkt aantal situaties:

**Diensten**: internationaal personenvervoer (schepen/vliegtuigen), diensten bij in-/uitvoer goederen buiten EU, werk aan goederen bestemd voor buiten EU, bemiddeling bij vervoer/opslag/invoer.

**Goederen**: export naar buiten EU, intracommunautaire levering goederen naar andere EU-lidstaat.

**Bewijslast**: transportdocumenten, orderbons etc. bewaren. Geen bewijs = naheffing + boete.

## BTW verlegd (verleggingsregeling)

Dit is wat de meeste ZZP consultants/developers/designers gebruiken bij buitenlandse klanten.

**Diensten aan EU-ondernemer:**
- Factuur zonder BTW + vermelding "BTW verlegd"
- BTW-nummer klant op factuur (verplicht)
- BTW-aangifte: rubriek **3a**
- **ICP-opgaaf verplicht** (zie zzp-icp-opgaaf.md)
- Klant draagt zelf BTW af in zijn land

**Diensten aan ondernemer buiten EU:**
- Factuur zonder BTW
- BTW-aangifte: rubriek **3b**
- Geen ICP-opgaaf

**Diensten aan EU-particulier (zonder BTW-nummer):**
- Gewoon 21% Nederlandse BTW
- Rubriek 1a

## Verleggingsregeling bij inkoop (omgekeerd)

Buitenlandse SaaS/diensten die jij als ZZP'er afneemt:

| Leverancier | Behandeling | BTW-aangifte |
|-------------|-------------|--------------|
| NL (bv. TransIP) | BTW op factuur → aftrekken | 5b |
| EU (bv. Figma, Slack) | Verleggen | 4b (afdragen) + 5b (aftrekken) = netto 0 |
| Buiten EU (bv. AWS) | Verleggen | 4a (afdragen) + 5b (aftrekken) = netto 0 |

## Vrijgesteld

Geldt voor specifieke sectoren: medische diensten, onderwijs, verzekeringen, financiële diensten, sportorganisaties (niet-winstgevend), kinderopvang.

Gevolgen: geen BTW rekenen, **geen voorbelasting aftrekken**. Niet relevant voor consultants/developers/designers.

## Veelgemaakte fouten

1. "Buitenlandse klant = 0% BTW" → Nee, het is BTW verlegd (geen 0%)
2. ICP-opgaaf vergeten bij EU-klanten
3. BTW-nummer niet checken via VIES
4. Nultarief toepassen zonder bewijs

## Bronnen

- [Belastingdienst — Diensten 0% BTW](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/tarieven_en_vrijstellingen/diensten_met_0_btw/diensten_met_0_btw)
- [Belastingdienst — Goederen 0% BTW](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/tarieven_en_vrijstellingen/goederen_0_btw/goederen_met_0_btw)
- [Belastingdienst — Vrijstellingen](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/tarieven_en_vrijstellingen/vrijstellingen/vrijstellingen)
- [Belastingdienst — Diensten aan EU-afnemers](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/zakendoen_met_het_buitenland/goederen_en_diensten_naar_andere_eu_landen/btw_berekenen_bij_diensten/btw_berekenen_bij_diensten_aan_afnemers_in_andere_eu_landen)
- [Belastingdienst — Aantonen 0%-tarief](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/tarieven_en_vrijstellingen/goederen_0_btw/aantonen_van_terechte_toepassing_0_tarief)
