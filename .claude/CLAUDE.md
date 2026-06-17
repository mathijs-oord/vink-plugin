# Boekhoud-plugin — broncode (maintainer)

Dit is de **bron van de `boekhoud` Claude Code plugin** (tevens marketplace), niet een
werk-administratie. Hier ontwikkel en onderhoud ik de skills; gebruikers installeren de plugin en
draaien 'm in hun eigen map. Zie `README.md` (sectie "Voor de maintainer") voor uitbrengen/testen.

## Architectuur

**"AI bepaalt WAT, deterministische code bepaalt HOE."** Alle harde correctheid (factuurnummer,
BTW-rekenwerk, koersconversie, PDF-render, CSV-schrijven) loopt via `lib/admin.mjs`. De skills
(markdown) orkestreren alleen.

Code/data-scheiding (cruciaal voor de plugin):
- **Code/skills/regels/templates** → in de plugin, aangeroepen via `$CLAUDE_PLUGIN_ROOT/...`.
  Worden vervangen bij elke update.
- **Data** → in de map van de gebruiker. `lib/admin.mjs` schrijft relatief aan `process.cwd()`
  (resp. `CLAUDE_PROJECT_DIR`, of `ADMIN_DATA_DIR` als override). `TEMPLATES` blijft bij de code.

## Repo-layout

```
.claude-plugin/marketplace.json   marketplace (deze repo) — plugin op source "./"
.claude-plugin/plugin.json        plugin-manifest (naam: boekhoud, version bewust weggelaten)
skills/<naam>/SKILL.md            de skills (auto-discovered)
lib/admin.mjs                     deterministische CLI
templates/                        HTML voor PDF-render
rules/                            NL fiscale regels (kennisbron) — begin bij rules/INDEX.md
seed/                             lege templates die /setup-zzp-admin naar de gebruikersmap kopieert
```

## admin.mjs — commando's

```bash
node lib/admin.mjs next-invoice-number
node lib/admin.mjs fx USD 2026-03-15
node lib/admin.mjs compute-invoice <inv.json>          # preview (read-only)
node lib/admin.mjs render-invoice <inv.json> facturen/2026-Q2/2026-0005.pdf
node lib/admin.mjs record-invoice <inv.json> facturen/2026-Q2/2026-0005.pdf   # compute+due_date+PDF+CSV's
node lib/admin.mjs aangifte 2026-Q2
node lib/admin.mjs render-aangifte <aangifte.json> aangiftes/2026-Q2-btw-aangifte.pdf
node lib/admin.mjs record-aangifte <aangifte.json> aangiftes/2026-Q2-btw-aangifte.pdf  # PDF+CSV-rij
node lib/admin.mjs append data/receipts.csv <row.json>
node lib/admin.mjs mark-paid 2026-0006 2026-06-10
```

Data-paden (`data/...`, `facturen/...`) resolven relatief aan de cwd. Test dus vanuit een aparte
lege map (niet deze repo), of zet `ADMIN_DATA_DIR`. PDF-render gebruikt headless Chrome
(`ADMIN_CHROME` om het pad te overriden).

## Belangrijk bij wijzigingen

- Skills roepen `admin.mjs` aan als `node "$CLAUDE_PLUGIN_ROOT/lib/admin.mjs" ...` en verwijzen naar
  regels als `$CLAUDE_PLUGIN_ROOT/rules/...`. Houd dat zo bij nieuwe skill-edits.
- Data-paden in skills (`data/`, `facturen/`, `bonnen/`, `aangiftes/`) blijven **relatief** — die
  horen in de map van de gebruiker.
- Geen verwijder-acties via skills (bewuste veiligheidskeuze).
