# Mijn administratie — Vink

Dit is **mijn eigen administratie-map**: facturen, bonnen, BTW-aangifte-voorbereiding en jaarcijfers
voor freelance/ZZP-werk in Nederland. Alleen platte bestanden (CSV/JSON + PDF's). De skills die hierop
werken komen uit de **`vink`-plugin** (geïnstalleerd via Claude Code), niet uit deze map.

## Kernprincipe

**"AI bepaalt WAT, deterministische code bepaalt HOE."** Alle harde correctheid (factuurnummer,
BTW-rekenwerk, koersconversie, PDF-render, CSV-schrijven) loopt via de plugin-code
(`lib/admin.mjs` in de plugin). De skills redeneren en stellen voor; `admin.mjs` rekent en
schrijft. Nooit zelf bedragen of factuurnummers uitrekenen — altijd via `admin.mjs`.

## Code vs. data

- **Code/skills/regels/templates** → in de plugin-map. Worden door updates van de plugin ververst;
  daar verander ik niets aan.
- **Mijn data** → in déze map (`data/*.csv`, `data/business.json`, `facturen/`, `bonnen/`,
  `aangiftes/`, `jaaropgaven/`). Blijft van mij, overleeft plugin-updates, is van mij om te
  backuppen/delen.

Het pad naar de plugin-map staat uitgeschreven in elke skill: Claude Code vult het in zodra de skill
laadt. Het is géén omgevingsvariabele in de shell — neem het pad dus over uit de skill-tekst (voor
`node …/lib/admin.mjs` en voor het lezen van `…/rules/*.md`).

## Slash-command detectie

Noemt de gebruiker `/setup-vink`, `/factuur`, `/zelffactuur`, `/bon`, `/betaald`, `/aangifte`,
`/dashboard` of `/jaaropgave` (ook midden in een zin), roep direct de bijbehorende skill aan — niet om bevestiging vragen, niet
uitleggen, invoke. (In het slash-menu heten ze `vink:factuur` enz.; de korte vorm herken je
als intentie.)

- `/setup-vink` — eenmalige onboarding: bedrijfsgegevens + betaaltermijn instellen.
- `/factuur` — ik maak zelf een verkoopfactuur (omzet, genereert PDF).
- `/zelffactuur` — opdrachtgever maakt de factuur namens mij (self-billing, ook omzet, importeert).
- `/bon` — inkoopfactuur/bon als kosten verwerken.
- `/betaald` — een verkoopfactuur op betaald zetten (status=paid + paid_at).
- `/aangifte` — kwartaal-BTW-aangifte samenstellen.
- `/dashboard` — stand van zaken (openstaand, omzet/kosten, eerstvolgende deadline).
- `/jaaropgave` — jaarcijfers: van omzet naar belastbare winst, voor de aangifte inkomstenbelasting.

## Map-conventies (in déze map)

```
data/business.json        afzender (1 record) — maak je met /setup-vink
data/.vink-ping           marker van de anonieme maandping (uitzetten: "telemetry": false in business.json)
data/clients.csv          klanten
data/invoices.csv         factuur-headers (status draft|sent|paid, source created|imported)
data/invoice_items.csv    factuurregels
data/receipts.csv         bonnen/kosten
data/aangiftes.csv        kwartaal-aangiftes
data/assets.csv           bedrijfsmiddelen zonder bon (van vóór Vink / ingebracht uit privé)
data/jaaropgaven.csv      vastgelegde jaaropgaven
facturen/<YYYY-QN>/       gegenereerde + geïmporteerde factuur-PDF's, per kwartaal
bonnen/<YYYY-QN>/         kopie van bron-bonbestanden, per kwartaal (bewaarplicht Art. 52 AWR)
aangiftes/                aangifte-PDF's
jaaropgaven/              jaaropgave-PDF's
```

## Scope

Administratie (facturen, bonnen) en de voorbereiding van de BTW-aangifte en de jaarcijfers voor de
inkomstenbelasting (winst uit onderneming, incl. eenvoudige lineaire afschrijving). **Niet** in scope:
het berekenen van de inkomstenbelasting zelf (schijven, heffingskortingen, Zvw), het privédeel van de
aangifte, directe indiening bij de Belastingdienst, tijdregistratie. Alle overzichten zijn ter
voorbereiding; de daadwerkelijke aangiftes doe je zelf bij de Belastingdienst.

## Stijl

Beknopt en direct. Geef bij elke skill een compacte preview met alleen beslis-relevante data vóór
je naar CSV schrijft. Geen verwijder-acties via de skills — verwijderen/corrigeren doe je met de
hand in de CSV (bewuste veiligheidskeuze).
