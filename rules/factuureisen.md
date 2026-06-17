# Factuureisen Nederland

*Laatst geverifieerd: 20 februari 2026*

## Wettelijke basis

Art. 35a Wet op de Omzetbelasting 1968 (implementatie van Art. 226 EU BTW-richtlijn 2006/112/EG).

## Harde vereisten (factuur fiscaal ongeldig zonder)

### Van jezelf (leverancier)
- Naam en adres (Art. 35a lid 1 sub d)
- BTW-identificatienummer (Art. 35a lid 1 sub c)
- KVK-nummer (Handelsregisterwet Art. 25 — apart wetsartikel, verplicht op "uitgaande stukken")

### Van de klant (afnemer)
- Naam en adres (Art. 35a lid 1 sub e)
- BTW-nummer: alleen verplicht bij intracommunautaire levering / verleggingsregeling

### Op de factuur
- Factuurdatum (Art. 35a lid 1 sub a)
- Uniek, opeenvolgend factuurnummer (Art. 35a lid 1 sub b)
- Omschrijving goederen/diensten (Art. 35a lid 1 sub f)
- Hoeveelheid en aard (Art. 35a lid 1 sub f)
- Eenheidsprijs excl. BTW (Art. 35a lid 1 sub h)
- Bedrag excl. BTW per tarief (Art. 35a lid 1 sub h)
- BTW-tarief (Art. 35a lid 1 sub i)
- BTW-bedrag (Art. 35a lid 1 sub j)
- Leveringsdatum als afwijkend van factuurdatum (Art. 35a lid 1 sub g)

## Factuurnummering

- **Doorlopend** over alle klanten heen (niet per klant)
- **Opeenvolgend** — duplicaten niet toegestaan
- **Gaten toegestaan** — factuur maken en niet versturen mag
- **Format**: `YYYY-NNN` (bv. 2026-001, 2026-002)
- **Geen klant-prefix** — klantinfo hoort niet in het factuurnummer

## Bijzondere vermeldingen

| Situatie | Vermelding | Wettelijke basis |
|----------|-----------|------------------|
| EU-klant (BTW verlegd) | "BTW verlegd naar de ontvanger op grond van artikel 44 Btw-richtlijn" | Art. 35a lid 1 sub k-l, Art. 37c |
| KOR | "Vrijgesteld van omzetbelasting op grond van artikel 25 Wet OB" | Art. 25 Wet OB |
| Creditfactuur | Verwijzing naar originele factuur | Art. 35a |
| Self-billing | "Factuur uitgereikt door de afnemer" | Art. 35a |

## Niet wettelijk verplicht maar praktisch essentieel

| Veld | Reden |
|------|-------|
| IBAN + banknaam | Niet verplicht op factuur, maar nodig voor betaling |
| Betalingstermijn | Handelsgebruik (standaard 30 dagen) |
| E-mail / telefoon | Contactgegevens |
| Betaalreferentie | Administratief gemak |

## EU intracommunautaire leveringen (extra vereisten)

Bij BTW-verlegd (reverse charge) naar EU-afnemers:
1. BTW-identificatienummer afnemer (verplicht)
2. Vermelding "BTW verlegd" op factuur
3. Referentie Art. 44 Btw-richtlijn

## Vereenvoudigde factuur (Art. 35b)

Voor bedragen ≤ €100 incl. BTW gelden vereenvoudigde regels: alleen datum, naam leverancier, omschrijving, bedrag incl. BTW en BTW-tarief vereist. Veel kassabonnen vallen hieronder. Niet relevant voor dienstverlenende ZZP'ers (facturen typisch > €1.000).

## Inkoopfactuur — vereisten voor BTW-aftrek

Voor het aftrekken van voorbelasting (rubriek 5b) moet je een inkoopfactuur hebben die voldoet aan Art. 35a:
- Naam, adres, BTW-nummer leverancier
- Factuurdatum en factuurnummer
- Omschrijving goederen/diensten
- Bedrag excl. BTW, BTW-tarief, BTW-bedrag, totaal incl. BTW
- Jouw naam en adres als afnemer

## E-facturatie (Peppol)

- **B2G**: Al verplicht sinds 2017 (leveranciers aan Rijksoverheid)
- **B2B NL**: Nog niet verplicht (2026), maar waarschijnlijk **verplicht per 1 juli 2030** (EU ViDA-initiatief)
- **België B2B**: Verplicht per 1 jan 2026 via Peppol — relevant voor NL ZZP'ers met Belgische klanten
- **Formaat**: Peppol BIS Billing 3.0 (UBL 2.1 XML), NL-specifiek: SI-UBL 2.0 met NLCIUS

## Bronnen

- [Belastingdienst — Factuureisen BTW](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/)
- Art. 35a Wet op de Omzetbelasting 1968
- Art. 35b Wet OB (vereenvoudigde factuur)
- Art. 37c Wet OB (vermelding BTW-verlegd)
- Art. 25 Handelsregisterwet (KVK op uitgaande stukken)
- Art. 52 AWR (administratie- en bewaarplicht)
- EU BTW-richtlijn 2006/112/EG, Art. 226
