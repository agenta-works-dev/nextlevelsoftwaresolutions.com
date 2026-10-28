# Intelligent Order Checker acceptance record

October 26, 2026. **Working locally with OpenAI; not published.** The existing production checker is preserved.

## Live model evidence

OpenAI GPT-6.1 Terra made four real requests against original PDF/XLSX/PNG/CSV pairs containing fictional business data. Successful strict evaluation records, relative to the repository root:

`../../work/order-checker-evaluation/2026-10-26T23-28-27.630Z/`

| Case                        | Original layouts                                                | Clarifications | Verified result                                                                                                         | Standard-rate estimate |
| --------------------------- | --------------------------------------------------------------- | -------------: | ----------------------------------------------------------------------------------------------------------------------- | ---------------------: |
| Packaging                   | PO PDF vs supplier Excel: different labels, parts and packaging |              3 | H-G8 maps to GSK-8; 12 EA/BOX; price per 1 BOX. Quantity 240 EA matches; $0.80 vs $0.75/EA and $12 extended difference. |              $0.021780 |
| New order and saved profile | New PDF and supplier Excel files                                |              0 | Three rules reused; fresh 180 EA / 15 BOX; $0.05/EA and $9 extended differences.                                        |              $0.022371 |
| Split deliveries            | PO PDF plus scanned PNG acknowledgement                         |              0 | Two 60 EA deliveries; total 120 matches; December 12 and 18 are 2 and 8 days late.                                      |              $0.026920 |
| Unfamiliar release          | Excel price per 100 EA vs semicolon dispatch CSV price per 1 EA |              1 | $2 vs $2.10/EA; extra BR-112; shipment and delivery remain incomparable.                                                |              $0.022685 |

Receipts include provider/model, request IDs, tokens and source hashes. Estimates use actual token counts at configured standard prices; caching, billing adjustments and hosting are separate. Earlier development evaluations exposed wrapped PDF headings and uncertainty classification issues; those were fixed and covered by regression tests. The directory above is the accepted strict evaluation, not a claim that every development attempt succeeded.

## Real browser evidence

The in-app browser uploaded `Our-current-order.pdf` and `Vendor-response-original.xlsx` through the actual file pickers. They are renamed fictional originals; no sample template processed those uploads. A fresh OpenAI request returned the expected extraction and discrepancies using the saved supplier profile with zero questions.

- Request: `req_cdf510597e734d289b6c9a2bc19be8b8`, October 26 at 23:33:42 UTC.
- 9,267 input / 2,604 output tokens; estimated inference cost **$0.022287**.
- The live button became disabled after that admitted request. Local corrections, exports and recorded examples remained available.
- Browser-generated records are outside the website root: `../order-checker-live-report.html`, `../order-checker-live-record.json`, and review screenshots. These were explicit operator downloads of fictional data; the application did not persist visitor documents on its server.

A browser correction test deliberately mapped quantity to the wrong cell, producing 1,728 EA, then restored `Vendor reply!D10` and the correct 180 EA. Both corrections were recorded. Downloading the earlier snapshot produced a **byte-identical original report**, SHA-256:

`c302e3fdf042e0c6375e11e00f6033de17938cef64eeb2670b46a3e58420ffb5`

Profile export preserved revisions 1, 2 and 3. Revision 1 held two rules; revisions 2 and 3 held three. The browser forgot and re-imported that export, restoring all versions. Conflicting rewrites of an existing revision or changes to its business identity are refused.

## Sample demonstration and privacy

Public examples now replay recordings of **actual AI extraction**, bound to the exact original hashes and labeled “Recorded AI readings · no new model call.” Visitors supply their own answers; results and learning are calculated locally. Unknown uploads always use fresh AI interpretation. A prepared ground-truth helper remains for development regression only; it is not a mock fallback for visitor uploads.

In the real recorded-browser flow, confirming the supplier part, packaging ratio and independent pricing basis reduced **3 clarifications to 0** on the next order. Fictional scenario context supplies the working knowledge omitted from the forms. The scan's December 18 source region was visually inspected and highlighted that exact printed date.

Session removal cleared rendered readings, findings, source quotations, source-selection options and file inputs. Explicitly saved profiles remained, and the used trial remained used. Hidden rendered document content was cleared along with in-memory references. Normal exports remain under the visitor's control.

## Acceptance

| Requirement                                     | Verified evidence                                                                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Original uploads without manual reformatting | Actual PDF/XLSX file pickers; original PDF/image/XLSX/CSV readers and live cases.                                                                         |
| 2. Extraction with source references            | Live provider outputs, validated quotations/IDs, cell highlights and inspected image regions.                                                             |
| 3. Questions instead of guesses                 | Packaging/part/price-basis and extra-item questions; explicit currency and date semantics.                                                                |
| 4. Accurate confirmed comparison                | Exact deterministic expected results on all cases and real browser upload; every split date retained.                                                     |
| 5. Preserve learning                            | Optional scoped browser profiles, separate discovered mappings and confirmed rules, three exported/imported revisions.                                    |
| 6. Reuse learning successfully                  | Live second-order extraction and recorded-browser repeat both reused three rules without repeated questions.                                              |
| 7. Correct without corrupting prior results     | Browser source correction, byte-identical prior report, preserved profile revisions.                                                                      |
| 8. Real browser experience                      | Upload/live AI, all recorded cases, questions, source viewer, corrections, downloads/copy, profile import/removal, session removal, and phone-width flow. |

Phone-width QA used **390 × 844**: document width stayed 390 pixels without page-level horizontal overflow, and questions/comparison/profile reuse worked. The temporary viewport was reset. Correction source selection has an explicit accessible label; copy summary succeeded.

## Automated and deployment evidence

**99 tests pass**, source/server syntax checks pass, and dependency audit reports **0 vulnerabilities** at the final development check. Tests cover real file readers and AI recordings, exact fractions, packaging labels, independent pricing basis, currency/date ambiguity, split schedules, source grounding/wrapped labels, targeted uncertainty resolution, profile isolation/history/import, safe reports, API admission and concurrent one-attempt enforcement. Existing site/checker tests remain intact.

The Cloudflare Worker bundles in a dry run with public processing disabled, no public route, and workers.dev disabled. This proves packaging, not a live Cloudflare deployment or Turnstile setup.

This is bounded acceptance of the local review application and these cases. General model accuracy is not guaranteed. Poor scans, unsupported workbook objects, complex allocations, rounding policies and contractual conditions retain the limitations described in the deployment guide. Qwen's hosted adapter has contract tests; local/hosted Qwen accuracy was not evaluated here.

At the October 26 review checkpoint, no production publication, merge, Cloudflare route, Turnstile setup, account creation or billing change had been performed. The following launch update supersedes that publication checkpoint.

## October 27 authorized launch update

Michael approved publication and five attempts per browser. The launch branch passes **100 tests**, including eight concurrent submissions admitting exactly five AI requests, failed requests consuming attempts, and migration of existing one-attempt records without resetting usage. Syntax/build checks, prepared original-format sample cases and the production dependency audit also pass (0 vulnerabilities). Browser review shows the five-attempt counter and handwriting guidance. No new handwriting accuracy benchmark is claimed.

The API is deployed with server-only OpenAI, signing and Turnstile secrets. Its real managed widget is restricted to the company hostname with pre-clearance off. Public readiness returns configured/enabled, five remaining attempts for a fresh visitor and a real widget key. A public interpretation without verification returns HTTP 403 before any document processing. The original spreadsheet checker is preserved at `order-check-legacy.html`. See `ORDER-CHECKER-DEPLOYMENT.md` for promotion, public verification and rollback.

The public GitHub Pages release merged as `8a03737a35a96efcf6ab9d7b833f0786577ebaba` and its deployment succeeded. The real public-browser check exposed that Workers rejects Fetch's `redirect: "error"` option. The provider adapter now uses `manual` and explicitly refuses 3xx responses, preserving the boundary that credentials and document content are never forwarded to a redirected endpoint. A regression test covers that refusal; **101 tests pass**. Temporary transport diagnostics were removed after investigation.

Two subsequent public-browser uploads used the original fictional PDF/XLSX files through file pickers, processing consent, real Turnstile and the live OpenAI endpoint. They were not recorded replays:

| Public live case | Provider request | Input / output tokens | Estimated inference cost | Result |
| --- | --- | --- | ---: | --- |
| First order | `req_0974ac4e1a3a4de69c91afde4f83514d` | 8,951 / 2,678 | $0.022341 | Three business clarifications; 240 EA matches 20 BOX; price difference $0.05/EA and extended difference $12.00 |
| New order with saved revision 1 | `req_0b81a11540ed45c4a8595da87111bf9f` | 9,322 / 2,778 | $0.023212 | Three confirmed rules reused; zero clarifications; new quantity 180 EA matches 15 BOX; extended difference $9.00 retained |

Receipts, actual interpretation JSON, downloaded HTML reports, the exported supplier profile and the published-asset checks are retained locally under `work/order-checker-launch-verification/` outside the website root. All eight published original-format samples match their reviewed SHA-256 hashes. The legacy spreadsheet page returns successfully. A scan of tracked files found no provider, signing or Turnstile secret. Two initial failed launch attempts counted against the QA browser's allowance; four total admissions leave one available in that browser. Other new browsers receive five, subject to the network and monthly limits. Costs above are configured token-price estimates, not invoices. Handwriting remains unbenchmarked.
