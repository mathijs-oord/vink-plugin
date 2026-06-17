# Mijn administratie — ZZP-boekhouding

Dit is **mijn eigen administratie-map**: facturen, bonnen en BTW-aangifte-voorbereiding voor
freelance/ZZP-werk in Nederland. Alleen platte bestanden (CSV/JSON + PDF's). De skills die hierop
werken komen uit de **`boekhoud`-plugin** (geïnstalleerd via Claude Code), niet uit deze map.

## Kernprincipe

**"AI bepaalt WAT, deterministische code bepaalt HOE."** Alle harde correctheid (factuurnummer,
BTW-rekenwerk, koersconversie, PDF-render, CSV-schrijven) loopt via de plugin-code
(`$CLAUDE_PLUGIN_ROOT/lib/admin.mjs`). De skills redeneren en stellen voor; `admin.mjs` rekent en
schrijft. Nooit zelf bedragen of factuurnummers uitrekenen — altijd via `admin.mjs`.

## Code vs. data

- **Code/skills/regels/templates** → in de plugin (`$CLAUDE_PLUGIN_ROOT/...`). Worden door updates
  van de plugin ververst; daar verander ik niets aan.
- **Mijn data** → in déze map (`data/*.csv`, `data/business.json`, `facturen/`, `bonnen/`,
  `aangiftes/`). Blijft van mij, overleeft plugin-updates, is van mij om te backuppen/delen.

`$CLAUDE_PLUGIN_ROOT` is een omgevingsvariabele die Claude Code zet als een plugin-skill draait.
Voor de Read-tool heb je het letterlijke pad nodig — draai dan eerst `echo "$CLAUDE_PLUGIN_ROOT"`.

## Slash-command detectie

Noemt de gebruiker `/setup-zzp-admin`, `/factuur`, `/zelffactuur`, `/bon`, `/betaald` of `/aangifte` (ook
midden in een zin), roep direct de bijbehorende skill aan — niet om bevestiging vragen, niet
uitleggen, invoke. (In het slash-menu heten ze `boekhoud:factuur` enz.; de korte vorm herken je
als intentie.)

- `/setup-zzp-admin` — eenmalige onboarding: bedrijfsgegevens + betaaltermijn instellen.
- `/factuur` — ik maak zelf een verkoopfactuur (omzet, genereert PDF).
- `/zelffactuur` — opdrachtgever maakt de factuur namens mij (self-billing, ook omzet, importeert).
- `/bon` — inkoopfactuur/bon als kosten verwerken.
- `/betaald` — een verkoopfactuur op betaald zetten (status=paid + paid_at).
- `/aangifte` — kwartaal-BTW-aangifte samenstellen.

## Map-conventies (in déze map)

```
data/business.json        afzender (1 record) — maak je met /setup-zzp-admin
data/clients.csv          klanten
data/invoices.csv         factuur-headers (status draft|sent|paid, source created|imported)
data/invoice_items.csv    factuurregels
data/receipts.csv         bonnen/kosten
data/aangiftes.csv        kwartaal-aangiftes
facturen/<YYYY-QN>/       gegenereerde + geïmporteerde factuur-PDF's, per kwartaal
bonnen/<YYYY-QN>/         kopie van bron-bonbestanden, per kwartaal (bewaarplicht Art. 52 AWR)
aangiftes/                aangifte-PDF's
```

## Scope

Boekhouding (facturen, bonnen, BTW-aangifte-voorbereiding). **Niet** in scope: inkomstenbelasting,
directe indiening bij de Belastingdienst, afschrijvingen, tijdregistratie. Het BTW-overzicht is ter
voorbereiding; de daadwerkelijke aangifte doe je zelf op Mijn Belastingdienst Zakelijk.

## Stijl

Beknopt en direct. Geef bij elke skill een compacte preview met alleen beslis-relevante data vóór
je naar CSV schrijft. Geen verwijder-acties via de skills — verwijderen/corrigeren doe je met de
hand in de CSV (bewuste veiligheidskeuze).
