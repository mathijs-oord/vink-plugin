# Vink-plugin — broncode (maintainer)

Dit is de **bron van de `vink` Claude Code plugin** (tevens marketplace), niet een
werk-administratie. Hier ontwikkel en onderhoud ik de skills; gebruikers installeren de plugin en
draaien 'm in hun eigen map. Zie `README.md` (sectie "Voor de maintainer") voor uitbrengen/testen.

## Architectuur

**"AI bepaalt WAT, deterministische code bepaalt HOE."** Alle harde correctheid (factuurnummer,
BTW-rekenwerk, koersconversie, PDF-render, CSV-schrijven) loopt via `lib/admin.mjs`. De skills
(markdown) orkestreren alleen.

Code/data-scheiding (cruciaal voor de plugin):
- **Code/skills/regels/templates** → in de plugin, aangeroepen via `${CLAUDE_PLUGIN_ROOT}/...`.
  Worden vervangen bij elke update.
- **Data** → in de map van de gebruiker. `lib/admin.mjs` schrijft data én uitvoer (PDF's,
  dashboard) relatief aan `process.cwd()` (resp. `CLAUDE_PROJECT_DIR`, of `ADMIN_DATA_DIR` als
  override). `TEMPLATES` blijft bij de code.

## Repo-layout

```
.claude-plugin/marketplace.json   marketplace (deze repo) — plugin op source "./"
.claude-plugin/plugin.json        plugin-manifest (naam: vink, version bewust weggelaten)
skills/<naam>/SKILL.md            de skills (auto-discovered)
lib/admin.mjs                     deterministische CLI
templates/                        HTML voor PDF-render
rules/                            NL fiscale regels (kennisbron) — begin bij rules/INDEX.md
seed/                             lege templates die /setup-vink naar de gebruikersmap kopieert
```

## admin.mjs — commando's

```bash
node lib/admin.mjs next-invoice-number
node lib/admin.mjs fx USD 2026-03-15
node lib/admin.mjs compute-invoice <inv.json>          # preview (read-only)
node lib/admin.mjs render-invoice <inv.json> facturen/2026-Q2/2026-0005.pdf
node lib/admin.mjs record-invoice <inv.json> facturen/2026-Q2/2026-0005.pdf   # compute+due_date+PDF+CSV's
node lib/admin.mjs compute-receipt <bon.json>          # bon → euro + btw-kwartaal (preview, read-only)
node lib/admin.mjs record-receipt <bon.json>           # compute + duplicaat-guard + receipts.csv-rij
node lib/admin.mjs dashboard                           # stand van zaken (read-only)
node lib/admin.mjs render-dashboard <dashboard.json> dashboard.html
node lib/admin.mjs aangifte 2026-Q2
node lib/admin.mjs render-aangifte <aangifte.json> aangiftes/2026-Q2-btw-aangifte.pdf
node lib/admin.mjs record-aangifte <aangifte.json> aangiftes/2026-Q2-btw-aangifte.pdf  # PDF+CSV-rij
node lib/admin.mjs jaaropgave 2026 [opties.json]        # jaarcijfers → belastbare winst (read-only)
node lib/admin.mjs render-jaaropgave <jaaropgave.json> jaaropgaven/2026-jaaropgave.pdf
node lib/admin.mjs record-jaaropgave <jaaropgave.json> jaaropgaven/2026-jaaropgave.pdf  # PDF+CSV-rij
node lib/admin.mjs append data/invoices.csv <row.json>  # onbekende kolom = fout, niets geschreven
node lib/admin.mjs mark-paid 2026-0006 2026-06-10
```

Data- en uitvoerpaden (`data/...`, `facturen/...`, `jaaropgaven/...`) resolven relatief aan de cwd. Test dus vanuit een aparte
lege map (niet deze repo), of zet `ADMIN_DATA_DIR` (verplaatst beide). PDF-render gebruikt headless Chrome
(`ADMIN_CHROME` om het pad te overriden).

## Belangrijk bij wijzigingen

- Skills roepen `admin.mjs` aan als `node "${CLAUDE_PLUGIN_ROOT}/lib/admin.mjs" ...` en verwijzen naar
  regels als `${CLAUDE_PLUGIN_ROOT}/rules/...`. **Altijd mét accolades**: Claude Code vervangt alleen
  `${CLAUDE_PLUGIN_ROOT}` in de skill-tekst door het echte pad bij het laden; de variabele bestaat
  níet in de omgeving van de Bash-tool, dus `$CLAUDE_PLUGIN_ROOT` (zonder accolades) blijft leeg.
  `seed/CLAUDE.md` is geen plugin-component en wordt niet gesubstitueerd — gebruik de variabele daar niet.
- De skills zijn geschreven voor macOS (`open`, standaardpad van Chrome, `/tmp`).
- Data-paden in skills (`data/`, `facturen/`, `bonnen/`, `aangiftes/`, `jaaropgaven/`) blijven
  **relatief** — die horen in de map van de gebruiker.
- Geen verwijder-acties via skills (bewuste veiligheidskeuze).
- **Taal (i18n):** factuur- en dashboard-render zijn tweetalig (NL/EN) via de `STRINGS`-dictionary
  in `admin.mjs`. Taal = `business.language` (default `nl`), per factuur te overriden met
  `invoice.language`. Voeg je een zichtbare tekst toe aan `templates/factuur.html` of
  `templates/dashboard.html`, maak er dan een `{{L_...}}`-placeholder van en vul die in beide talen
  in `STRINGS`. `formatCurrency`/`formatDate` nemen een `lang`-argument. De **aangifte** en de
  **jaaropgave** blijven bewust NL (officiële Belastingdienst-rubrieken) — niet vertalen.
- **Gebruiksping:** `usagePing()` in `admin.mjs` stuurt na een geslaagd commando één anonieme POST
  per maand per administratie-map naar `vinkapp.nl/api/ping` (telpunt in de `vink-website`-repo,
  marker in `data/.vink-ping`, uit met `"telemetry": false` in `business.json`). Zet bij testen
  `VINK_TELEMETRY=0`, anders telt elke testmap als nieuwe gebruiker. Er gaat nooit een ID of
  administratiedata mee; verandert wat er meegaat, werk dan ook de privacyverklaring op de site bij.
- **Jaarbedragen IB:** de jaaropgave rekent met `IB_PARAMS` in `admin.mjs` (zelfstandigenaftrek,
  startersaftrek, MKB-winstvrijstelling, KIA-tabel, km-tarief). Voeg elk jaar het nieuwe jaar toe zodra
  de Belastingdienst de bedragen publiceert, en werk de tabel in `rules/jaaropgave.md` bij. Een jaar
  zonder parameters rekent t/m de fiscale winst en waarschuwt.
