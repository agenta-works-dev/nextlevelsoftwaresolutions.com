# Intelligent Order Checker: review and deployment

Release authorization: Michael approved publication on October 27, 2026 and increased the allowance to **five attempts per browser**. `order-check.html` contains the reviewed application; the earlier spreadsheet checker is retained as `order-check-legacy.html`. OpenAI GPT-6.1 Terra passed four live sample cases and an actual browser upload during review. Public samples replay those hash-bound real AI readings without a new model call. The public API must remain disabled until its secrets and real Turnstile widget are configured and checked.

The production API is now installed and enabled at the canonical `/api/order-checker/*` route. Its managed Turnstile widget is restricted to `nextlevelsoftwaresolutions.com`, with pre-clearance off. The public status reports five attempts, and requests without verification are refused before reading document content or calling AI. Provider, signing, and verification secrets are private Worker bindings; the checked-in site key is public by design. To suspend new live requests, set `PUBLIC_ENABLED=false` and redeploy the API.

## Run the review

Use Node 22.13 or newer; Node 24 is recommended.

```sh
npm ci
npm run build
npm run dev
```

Open <http://127.0.0.1:8797/order-check-next.html>. The server binds only to loopback and rejects other Host values. A static server can run the recorded AI demonstration, but cannot provide live interpretation.

The build bundles the browser code and copies PDF.js, its worker, fonts, character maps, and codecs locally. No document parser is fetched from a public CDN. PDF assets live under a versioned directory; application/CSS URLs include content hashes. Commit generated `assets/order-checker/` together with source changes so the existing GitHub Pages root can serve the review build.

## Configure AI privately

Copy `server/private-settings.example` to `../../work/order-checker-private/settings.env`, **outside the website root**, and restrict access to the owner. The review server also stores its generated signing secret and minimal usage ledger there. The settings file is literal `KEY=value` text, not shell code.

For Qwen, configure `AI_PROVIDER=qwen`, `AI_MODEL=qwen3-vl-plus`, a matching `QWEN_WORKSPACE_ID`, `QWEN_REGION`, and `DASHSCOPE_API_KEY`. Singapore (`ap-southeast-1`) and Virginia (`us-east-1`) workspace endpoints are supported. Confirm the key belongs to the selected workspace/region. See [Model Studio's OpenAI-compatible API documentation](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope).

For OpenAI, configure `AI_PROVIDER=openai`, `AI_MODEL=gpt-6.1-terra` (or another explicitly allowed model), and `OPENAI_API_KEY`. The adapter uses the Responses API with image input, strict structured output, and `store:false`. This needs an API project/key and API billing; the ChatGPT/Codex login does not supply them. See [OpenAI's billing explanation](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform).

Restart `npm run dev` after changing private settings. Keys are used only by the server and never returned by the status endpoint or browser bundle. Do not put keys in HTML, GitHub Pages settings exposed to a build, a URL, a public repository, or chat.

## Evaluate before approving the provider

```sh
npm test
npm run check
npm run verify:samples
```

The last command reads the real PDF/XLSX/PNG/CSV sample files against a prepared ground-truth baseline. It makes **no AI call**. The full test suite separately validates the published recordings of real AI extraction against the original files, including the complete profile-learning loop.

After configuring an API account:

```sh
npm run verify:ai
```

This operator-only command makes **four real provider calls**: packaging, a second order using its saved supplier profile, scanned split deliveries, and the unfamiliar release/dispatch pair. It supplies only known, explicitly recorded human clarification answers; it does not replace bad extraction with prepared data. Unexpected extraction questions or wrong results fail evaluation. Receipts, source hashes, clarifications, results and token-cost estimates are saved outside the website in `../../work/order-checker-evaluation/<timestamp>/`. Review those records and the actual source regions. Also run a live upload through the real browser. CLI success alone is insufficient.

The operator evaluation is separate from the public free allowance; it cannot reset a visitor's quota and accepts only the fictional sample filenames. Repeat it deliberately when changing models or prompts. The current acceptance record links the successful OpenAI evaluation and browser receipts. Qwen’s adapter has contract tests; hosted or local Qwen accuracy has not been evaluated here.

## Refresh the free recorded examples

After a reviewed successful live evaluation, run:

```sh
npm run record:samples -- ../../work/order-checker-evaluation/<successful-timestamp>
npm run build
npm test
```

This records only the exact fictional sample files, checks their SHA-256 hashes and source references, and refuses unresolved extraction runs. It does not copy visitor uploads, private keys, or saved profiles. Visitors then replay real AI readings and supply their own clarification answers; the comparison and learning are calculated locally. Original AI receipts stay visible. Replaying a recording makes no new provider call and does not consume the visitor’s live interpretation.

## Architecture and data handling

1. The browser reads original files. PDF.js extracts text and renders page images; images are resized locally; the generic XLSX/CSV reader preserves original cells, addresses and headers. Formula code and document scripts are not executed. Hidden worksheets require an explicit choice.
2. After processing consent, the browser sends bounded text anchors and rendered JPEG pages to the private API. The original binary file is not uploaded. The public API verifies origin and human verification before parsing the document body, then atomically reserves one trial before calling the provider.
3. Qwen/OpenAI proposes grounded fields and relationships. The server rejects unknown source IDs, text not present at its cited location, invalid image regions, unsupported structures, and incomplete responses. An image citation locates a model transcription; it cannot independently verify OCR accuracy or authenticity.
4. The browser asks necessary interpretation questions and calculates comparisons using exact decimal/rational arithmetic. Conversions, pricing basis, currency, part correspondence and date meaning stay explicit. User answers and recalculations do not call AI.
5. Optional profiles are saved only in this browser, or exported by the visitor. Profiles are scoped to customer and supplier, document role, format and printed labels. Confirmed changed labels prevent automatic reuse. Scanned forms require explicit profile confirmation before saved rules replace questions. Corrections create new revisions; earlier profile revisions and comparison snapshots are preserved.

The application does not write uploaded documents, interpretations or profiles to server storage. Processing uses request memory and a 150-second provider timeout; there are no background document jobs or automatic provider retries. Server logs intentionally exclude request content. The only durable server data is HMAC-protected browser/network usage identifiers, dates and counters. Network counters expire after three days, browser records after approximately one year, and month counters after approximately thirteen months, cleaned during subsequent admissions.

The browser's “Remove session information” releases document/viewer content, readings, answers, receipts and comparison history. Explicitly saved profiles have their own “Forget profile” control. This does not reset the trial allowance or erase data already processed under a provider's retention policy. Exports belong to the visitor and must be removed by them if desired.

`store:false` does not promise zero provider retention. [OpenAI's API data controls](https://developers.openai.com/api/docs/guides/your-data) and the selected Alibaba workspace's terms still apply. Public Cloudflare Turnstile processing receives browser/network metadata after the visitor chooses AI processing; it does not run in the local review or recorded-only demonstration.

## Free-use economics and abuse controls

Illustrative cost for **10,000 input tokens plus 5,000 output tokens**, standard rates checked October 26, 2026:

| Provider/model                            | Estimated inference cost per pair |
| ----------------------------------------- | --------------------------------: |
| Qwen3-VL Plus, Singapore, input up to 32K |                            $0.010 |
| OpenAI GPT-6.1 Terra                      |                            $0.035 |
| OpenAI GPT-6.1 Sol                        |                            $0.070 |

These are illustrative token scenarios. In the successful live evaluation, the four original-format pairs used 6,930–10,185 input tokens and 2,521–3,347 output tokens: **$0.021780–$0.026920 per pair** at the configured standard rates. The browser upload used 9,267 input / 2,604 output tokens, estimated **$0.022287**. These estimates use actual reported token counts; caching, billing adjustments and hosting are separate. Images count toward model input; longer documents and output cost more. Qwen has context tiers and regional differences. Hosting and account-specific charges are separate. Sources: [Alibaba Model Studio pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing), [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

Public enforcement includes a signed HttpOnly/SameSite browser cookie, five admitted AI interpretations per browser, a daily HMAC network counter, a strict global monthly count in a single transactional Durable Object, Turnstile verification, origin checks, bounded input/output and two concurrent interpretation slots. Failed admitted requests consume one attempt. Confirmations, downloads and recorded samples are free local operations. The status endpoint reports attempts used and remaining; each new paid request refreshes the single-use Turnstile token. Older one-attempt usage records count as one, without resetting identity or prior use.

This is **five per browser**, not verified five per human. Clearing cookies or using another device defeats browser identity; network and global limits bound the remaining exposure. No account or personal identity is collected for the basic demonstration. Browser allowance records expire with the signed identity after approximately one year; this is not a daily five-attempt reset.

Launch protection uses 100 interpretations/month globally and 5 per network/day. A shared network can reach its daily limit before every browser uses its allowance. The current API code caps a configured monthly allowance at 500 to keep the simple quota ledger bounded. A count limit is not a precise dollar budget. The model/output cap cannot be chosen by a visitor, and failed/incomplete calls are never automatically retried.

## Limits to communicate honestly

- 10 MB per original file, 8 pages per document, 40 total item lines per pair. The prepared request is limited to 12 MB; pages are resized to a maximum side of 1,800 pixels. Very dense, small-print or poor scans can remain uncertain.
- PDF, scanned PDF, PNG/JPEG/WebP, XLSX, CSV/TSV. Legacy XLS, macro-enabled workbooks, HEIC/TIFF and password-protected PDFs need a supported unlocked/redacted copy.
- XLSX reads saved cell/formula results. It does not recalculate formulas or inspect workbook charts, drawings, embedded images, external connections or macros. UTF-8/UTF-16 CSV/TSV and common comma/tab/semicolon separators are supported.
- Explicit acknowledgement schedules are summed without double-counting parent quantities, and every promised date is retained. A multi-date requested PO schedule or a single acknowledgement allocation across multiple identical PO lines still needs manual allocation; the checker must keep those cases unresolved.
- No currency conversion, contractual equivalence, authentication, ERP write, order approval, supplier contact or transaction transmission. Taxes/freight are separate conditions. Exact decimal differences are reported; no business rounding tolerance is silently introduced.
- Model generalization and OCR quality require live evaluation with representative redacted documents. The public sample recordings demonstrate actual model extraction of four exact fictional document pairs. Replaying them is clearly labeled and does not establish that the model has newly interpreted a visitor’s files.
- Handwritten photos/scans use the same image interpretation path. Handwriting has not yet been benchmarked with representative real forms. Cross-outs, overwriting, cramped numbers and ambiguous dates need human review; a plausible transcription can be wrong. Profiles preserve mappings and confirmed rules, not guaranteed recognition of a writer.

## Deployment after review and explicit authorization

Michael authorized the launch on October 27, 2026. The Worker config includes only the canonical `/api/order-checker/*` route; `workers_dev=false` prevents a second public API origin. Keep `PUBLIC_ENABLED=false` until the required real verification widget and private secrets are installed.

1. Complete live provider/browser evaluation. Review the receipt costs, limits, privacy wording and saved-learning behavior. Approve the provider, region, allowance and hosting account.
2. Confirm ownership/access to the Cloudflare zone already fronting `nextlevelsoftwaresolutions.com`. Create a Turnstile widget for the intended hostname. Set `TURNSTILE_SITE_KEY` and any Qwen workspace/region values as non-secret Worker variables. Keep `ALLOWED_ORIGIN` on the exact canonical origin. Use a staging hostname/its own config if staging is approved.
3. Set private Worker secrets interactively with the pinned Wrangler version, using `--config wrangler.order-checker.toml`: `TRIAL_SIGNING_SECRET` (at least 32 random bytes), the selected provider API key, and `TURNSTILE_SECRET_KEY`. Never put secret values in the TOML file or a command captured in source history.
4. Bundle locally first: `WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --config wrangler.order-checker.toml`. A dry run is **not** a deployment or proof of Cloudflare account access.
5. Add only the route `nextlevelsoftwaresolutions.com/api/order-checker/*` in the authorized Cloudflare zone. Keep the static website on its current GitHub Pages origin. Deploy with public processing initially disabled. A route/zone ID is intentionally absent from the checked-in config to prevent accidental publication.
6. The existing checker is preserved as `order-check-legacy.html`; the reviewed HTML is promoted to `order-check.html` with a canonical link and without review-only labels/noindex. The homepage explains original-format uploads and OpenAI processing. `npm run build` updates hashed assets in both document-checker pages. Leave the planning questionnaire separate.
7. Configure the five-per-browser allowance and enable `PUBLIC_ENABLED=true` only for the authorized launch. Deploy the reviewed static commit through the existing main/GitHub Pages process. Test the canonical public URL, human verification and first/second interpretation behavior with fictional samples. Automated tests verify that only five of eight concurrent requests are admitted and failed admitted calls also consume attempts. Verify the Worker route and cache behavior without exposing keys.
8. If the static cache serves mismatched versions, purge the affected Cloudflare HTML/asset URLs. Hashed scripts/styles and the versioned PDF assets reduce this risk. Keep the source commit and provider evaluation receipts together for release review.

Rollback: disable `PUBLIC_ENABLED` at the API, restore the previous static commit/checker link, and leave saved browser profiles/export files intact. Existing users can still use local recorded examples and review already-interpreted results. Do not rotate the signing secret merely to reset an individual's allowance; that invalidates every visitor's browser identity.

## Important files

- `scripts/documents/`: readers, schema/source validation, deterministic comparison, versioned profiles, reports, recorded samples and UI.
- `server/order-interpretation.js`, `server/ai-provider.js`: model prompt, grounded adapter and provider calls.
- `server/order-api.js`, `server/trial-ledger.js`: admission, bounded input, consent, human verification and five-attempt enforcement.
- `server/local-order-checker.mjs`: local preview and private file-backed quota ledger.
- `server/cloudflare-worker.js`, `wrangler.order-checker.toml`: production API adapter and strict transactional quota storage.
- `server/evaluate-samples.mjs`: operator-only real/prepared sample evaluation and receipts.
- `tests/document-*.test.mjs`: behavior, security, extraction grounding, comparison, profiles and report tests.
