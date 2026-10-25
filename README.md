# Next Level Software Solutions

The company website, the free **Supplier Acknowledgement Check**, and the separate **Find Your First Useful Automation** planning questionnaire. It uses static HTML, CSS, and browser JavaScript, retaining the repository’s existing root deployment and `CNAME`. No build, application server, account system, or API key is needed.

## Preview

From this directory:

```sh
python3 -m http.server 8796 --bind 127.0.0.1
```

Open `http://127.0.0.1:8796/`. The working comparison is at `/order-check.html`. The planning questionnaire is at `/automation-checkup.html`; the completed planning example is at `/automation-checkup.html?example=order-acknowledgement`. Use an HTTP server rather than opening the source HTML with a `file:` URL, because the site uses JavaScript modules.

## Working comparison

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

Node 20 or later is needed only for development checks:

```sh
npm test
npm run check
git diff --check
```

The tests cover recommendation choices, human decision ownership, sensitive-data preparation, baseline calculations, validation bounds, inert HTML exports, strict spreadsheet parsing, missing/extra/mismatched lines, and decimal/date comparison. Browser QA should include edited inputs invalidating results, valid/invalid imports, matching data, missing rows, report download/copy/print, keyboard navigation, phone layouts, and navigation to the planning questionnaire.

## Source map

- `index.html`, `styles.css`: company positioning, services, sample comparison, Andonity, contact.
- `order-check.html`, `order-check.css`: the working free comparison and responsive/print presentation.
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

Production is published from `main` through the repository’s existing GitHub Pages workflow and Cloudflare custom domain. Review and merge changes through the repository’s normal process; no DNS change or new hosting infrastructure is needed.

The stylesheet links use a `v` query parameter containing the first 12 characters of the file’s SHA-256. The order comparison's script and its model import use the same convention. Update those values when changing the corresponding files (model first, then UI script, then HTML). This prevents the hosting cache from pairing new HTML with previously cached assets.
