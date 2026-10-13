# BTW-tarieven en -aangifte (2026)

*Laatst geverifieerd: 20 februari 2026*

## Tarieven

| Tarief | Wanneer |
|--------|---------|
| **21%** | Standaard — meeste diensten en goederen |
| **9%** | Verlaagd — voedsel, boeken, medicijnen, fietsenmaker, kapper |
| **0%** | Nultarief — specifieke export/transportdiensten (zie nultarief-verlegd-vrijgesteld.md) |

Wijziging 2026: BTW-tarief logies (hotels, B&B) van 9% naar **21%**.

Als ZZP consultant/developer/designer: vrijwel altijd **21%** BTW.

## BTW-aangifte rubrieken

### Verschuldigde BTW (wat je afdraagt)

| Rubriek | Wat | Voorbeeld |
|---------|-----|-----------|
| **1a** | Omzet + BTW tegen 21% | €10.000 gefactureerd → omzet €10.000, BTW €2.100 |
| **1b** | Omzet + BTW tegen 9% | Zelden voor consultants |
| **1e** | Omzet tegen 0% of niet bij jou belast | Nultarief (bv. internationaal vervoer), binnenlands verlegde omzet |
| **3a** | Uitvoer van **goederen** naar landen buiten de EU | Niet voor diensten |
| **3b** | Leveringen naar / diensten aan ondernemers in andere EU-landen | BTW verlegd + ICP-opgaaf |
| **4a** | Diensten afgenomen van buiten EU | bv. AWS, Notion (verleggen) |
| **4b** | Diensten/goederen afgenomen uit EU | bv. Figma, Slack (verleggen) |

Diensten aan afnemers **buiten de EU** die in het land van de afnemer belast zijn, geef je niet aan
in de btw-aangifte — ze horen in geen enkele rubriek.

### Voorbelasting (wat je terugkrijgt)

| Rubriek | Wat |
|---------|-----|
| **5a** | Totaal verschuldigde BTW (som rubriek 1+4) |
| **5b** | Voorbelasting (BTW op al je zakelijke kosten) |
| **5g** | Totaal te betalen of terug te vragen (5a − 5b; 5c is het subtotaal vóór KOR-vermindering en schattingen) |

### Kort gezegd

1a = wat je NL-klanten factureerde, 5b = BTW op je kosten, het verschil betaal je.

## Kwartaaldeadlines 2026

| Kwartaal | Periode | Deadline aangifte + betaling |
|----------|---------|------------------------------|
| Q1 | jan–mrt | **30 april 2026** |
| Q2 | apr–jun | **31 juli 2026** |
| Q3 | jul–sep | **31 oktober 2026** |
| Q4 | okt–dec | **31 januari 2027** |

- Altijd aangifte doen, ook bij €0 omzet (nul-aangifte)
- Te laat = boete van €82. Geen boete als de aangifte binnen 7 kalenderdagen na de uiterste datum binnen is

## Factuurstelsel vs. kasstelsel

- **Factuurstelsel** (standaard): BTW aangeven bij factuurdatum, niet betaaldatum
- **Kasstelsel**: BTW bij ontvangst betaling (alleen in specifieke gevallen)

## Rekenvoorbeeld

```
Factuur aan klant:    €5.000 excl. + €1.050 BTW (21%) = €6.050 incl.
Laptop gekocht:       €1.000 excl. + €210 BTW          = €1.210 incl.

BTW-aangifte:
  Verschuldigde BTW (1a):  €1.050
  Voorbelasting (5b):      €  210
  Te betalen (5g):         €  840
```

## Bronnen

- [Belastingdienst — BTW-tarieven](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_berekenen_aan_uw_klanten/btw_berekenen/btw_tarief/btw_tarief)
- [Belastingdienst — BTW-aangifte invullen](https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/ik-moet-btw-aangifte-doen-hoe-vul-ik-die-in)
- [Belastingdienst — Deadlines](https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/uiterste-aangifte-en-betaaldatums)
- [Belastingdienst — Boete bij geen of te late aangifte](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_aangifte_doen_en_betalen/boetes/u_doet_geen_of_te_laat_aangifte)
- [Belastingdienst — Aangifte bij diensten aan afnemers buiten de EU](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/zakendoen_met_het_buitenland/zakendoen_buiten_de_eu/aangifte_doen_als_u_zakendoet_buiten_de_eu/aangifte_doen_als_u_diensten_levert_aan_afnemers_in_niet_eu_landen)
- [Belastingdienst — Logies naar 21%](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/berichten/nieuws/btw-logies)
