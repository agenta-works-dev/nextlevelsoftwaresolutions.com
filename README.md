# Next Level Software Solutions

The company website, the free **Intelligent Order Checker**, the original **Supplier Acknowledgement Check**, and the separate **Find Your First Useful Automation** planning questionnaire. Static pages retain the repository’s root GitHub Pages deployment and `CNAME`; a narrowly routed Cloudflare Worker supplies private AI processing.

The **Intelligent Order Checker** is at `order-check.html`, with a retained review copy at `order-check-next.html`. It reads original PDF/image/XLSX/CSV documents, displays source references, asks clarification questions, compares normalized values deterministically, and saves optional versioned profiles in the browser. Live interpretation uses the included private server/API. Recorded readings from actual AI extraction are labeled separately and replay without a new AI call. The public allowance is **five admitted interpretations per browser**, including failed admitted calls; local clarifications and sample replays do not use attempts.

## Revised checker review

Use Node 22.13 or later (Node 24 recommended):

```sh
npm ci
npm run build
npm run dev
```

Open `http://127.0.0.1:8797/order-check-next.html`. Copy `server/private-settings.example` to `../../work/order-checker-private/settings.env` for private API configuration; never put credentials inside the website directory. Restart the review server after changing private settings.

`npm run verify:samples` verifies the actual sample formats and prepared interpretation workflow without a paid call. `npm run verify:ai` makes four real provider calls against the fictional samples, records receipts and token costs, and checks extraction/comparison/profile reuse. OpenAI GPT-6.1 Terra has passed those four live sample cases and a real browser upload. This is bounded evidence, not a general accuracy guarantee.

See [the architecture, limits and deployment instructions](docs/ORDER-CHECKER-DEPLOYMENT.md) and [the acceptance record](docs/ORDER-CHECKER-ACCEPTANCE.md). Michael authorized publication and the five-attempt allowance on October 27, 2026. The original spreadsheet checker is preserved at `order-check-legacy.html`.

## Preview

From this directory:

```sh
python3 -m http.server 8796 --bind 127.0.0.1
```

Open `http://127.0.0.1:8796/`. The document checker is at `/order-check.html`; this static server supports recorded samples but requires the separate API for live AI. The spreadsheet checker is at `/order-check-legacy.html`. The planning questionnaire is at `/automation-checkup.html`; the completed planning example is at `/automation-checkup.html?example=order-acknowledgement`. Use an HTTP server rather than opening source HTML with a `file:` URL, because the site uses JavaScript modules.

## Original spreadsheet comparison

- Opens with editable, illustrative sample rows and actual comparison results. Visitors can enter their own purchase order and acknowledgement lines, add/remove lines, or import CSV/tab-separated spreadsheet rows. The downloadable sample provides the required five-column format; no document parsing or AI inference is claimed.
- Matches exact, unique line IDs and checks part number, quantity, unit price, and delivery date. Flags missing and extra lines. Case and leading zeros are significant. For split deliveries, use distinct scheduled-line IDs on both sides.
- Rejects malformed spreadsheets, duplicate IDs, blank fields, invalid dates, negative values, excessive precision, and more than 100 lines per source. Quantities use up to three decimal places; prices use up to four. Comparisons use scaled integers to avoid floating-point price differences. Both sources must use the same currency and units; there are no unit conversions, taxes, freight, or order approvals.
- Entries stay in the page's memory. Edits clear previous findings and disable export until a successful comparison. Nothing is submitted or retained by the application; refresh resets the sample. Hosting may add ordinary traffic analytics. No supplier communication, ERP connection, or order modification occurs.
- Visitors can download a self-contained HTML report containing findings and both source snapshots, copy a text summary (with a manual-copy fallback), or print/save the current findings as PDF. HTML exports escape visitor input and contain no scripts or remote resources.

## Checkup behavior

- Four steps collect the workflow, effort, systems, pattern, and review boundaries.
- A structured, deterministic checklist recommends an integration, rules, AI-assisted intake, reporting, workflow coordination, an internal application, or human-led decision support. The checkup itself does not call an AI model or imply that a service has analyzed real records.
- Current effort is calculated in the period the visitor enters. It is never presented as predicted savings.
- Answers remain in the current browser tab’s `sessionStorage`. The application has no submission endpoint, application analytics, remote storage, or external JavaScript/font dependency. The hosting layer may add traffic analytics and email-obfuscation scripts. A visitor explicitly chooses whether to download, copy, print, or open an email draft containing a short summary.
- The download is a self-contained HTML brief with print styles and company contact details. It can be reopened independently and printed to PDF. The summary can be copied, with a selectable-text fallback if clipboard access is unavailable.
- The completed example is labeled illustrative. It does not overwrite a visitor’s own saved draft. Editing the sample turns it into a normal draft; starting a personal checkup returns to any previous personal draft.
- The homepage example compares three fixed sample fields using explicit rules. It does not parse uploaded documents, contact suppliers, integrate with an ERP, or modify orders.

## Validation

Node 22.13 or later is needed for development checks and the revised checker:

```sh
npm test
npm run check
git diff --check
```

The tests cover recommendation choices, human decision ownership, sensitive-data preparation, baseline calculations, validation bounds, inert HTML exports, strict spreadsheet parsing, missing/extra/mismatched lines, and decimal/date comparison. Browser QA should include edited inputs invalidating results, valid/invalid imports, matching data, missing rows, report download/copy/print, keyboard navigation, phone layouts, and navigation to the planning questionnaire.

## Source map

- `index.html`, `styles.css`: company positioning, services, sample comparison, Andonity, contact.
- `order-check.html`, `order-documents.css`: the intelligent document checker and responsive/print presentation.
- `order-check-legacy.html`, `order-check.css`: the original spreadsheet comparison.
- `scripts/order-check-model.js`: bounded spreadsheet parsing, validation, comparison, and portable reports.
- `scripts/order-check.js`: editable rows, import, result invalidation, and user-triggered exports.
- `automation-checkup.html`, `checkup.css`: the planning questionnaire and its responsive/print presentation.
- `scripts/checkup-model.js`: validation, recommendations, rendering, and portable exports.
- `scripts/checkup.js`: form navigation, tab draft storage, and user-triggered exports.
- `scripts/order-example.js`, `scripts/site.js`: the fixed sample comparison and navigation.
- `assets/logo-mark.svg`: editable vector reconstruction of the supplied Next Level logo, with the left stem restored to the baseline. It uses vector paths, gradients, and a transparency mask; it has no embedded raster image or external resources. The PNG, favicon, and touch-icon assets are exports of this SVG.
- `assets/andonity.svg`: supplied Andonity mark, retained unchanged from the existing Andonity website source.
- `assets/social-preview.svg`: editable source for the PNG used in shared links. Rasterize at 1200 × 630 after changing it.

Andonity is identified as in development. This site does not claim general availability, customer deployments, certifications, or measured outcomes.

## Publication

The existing static production site is published from `main` through GitHub Pages and the Cloudflare custom domain. The revised checker also needs its private API deployed and configured; follow the separate deployment instructions after review and authorization.

The stylesheet links use a `v` query parameter containing the first 12 characters of the file’s SHA-256. The order comparison's script and its model import use the same convention. Update those values when changing the corresponding files (model first, then UI script, then HTML). This prevents the hosting cache from pairing new HTML with previously cached assets.
