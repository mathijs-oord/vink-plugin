# ZZP Boekhouding — Kennisbank

Kennisbank van de Vink-skills: de skills lezen deze bestanden als ze twijfelen over een fiscale regel.
De bestanden horen bij de plugin — gebruikers krijgen nieuwe versies via een plugin-update.

## Bestanden

| Bestand | Onderwerp |
|---------|-----------|
| `btw-tarieven.md` | BTW-tarieven 2026, aangifte rubrieken, deadlines, factuurstelsel |
| `nultarief-verlegd-vrijgesteld.md` | Verschil 0% / verlegd / vrijgesteld, wanneer wat |
| `icp-opgaaf.md` | ICP: wanneer, hoe, deadlines, boetes |
| `factuureisen.md` | Art. 35a Wet OB, verplichte velden, nummering, e-facturatie |
| `inkomstenbelasting.md` | Schijven 2026, aftrekposten, rekenvoorbeeld |
| `jaaropgave.md` | Jaarcijfers zzp'er: W&V + balans, van omzet naar belastbare winst, jaarbedragen 2025/2026, BTW-jaarcontrole |
| `kor.md` | Kleineondernemersregeling, drempel, voor/nadelen |
| `kosten-voorbelasting.md` | Aftrekbare kosten, bon vs inkoopfactuur, buitenlandse inkoop |
| `self-billing.md` | Self-billing facturen, verschil met inkoopfactuur |
| `bewaarplicht.md` | Art. 52 AWR, termijnen, digitaal bewaren |
| `afschrijving-investeringen.md` | €450 drempel, afschrijving, KIA 2026, herzieningsregel |
| `aanloopkosten.md` | Kosten voor bedrijfsstart, BTW terugvragen, Art. 15 Wet OB |

## Onderhoud (maintainer)

- Is een bestand ouder dan 6 maanden, of begint er een nieuw belastingjaar: opnieuw verifiëren tegen
  de bronnen onderaan het bestand en de datum bijwerken.
- Raakt een wijziging het rekenwerk (tarieven, rubrieken, jaarbedragen), pas dan ook `lib/admin.mjs` aan.
- Skills schrijven hier niet naar: een plugin-update vervangt deze map.

## Naamconventie

`[onderwerp-slug].md` — geen datum-prefix (dit is een levend document, geen snapshot).
Elk bestand heeft een "Laatst geverifieerd" datum bovenin.
