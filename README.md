# Orange Split

For every claim made in a Hacker News thread or pasted article, how many people or attributed voices are for it, against it, in the middle, or self-contradicting.

## Original motivation

The original motivation was to assess the reaction to Fable 5.1.

## Practical utility and lessons

This tool is of very limited practical utility. Since it focuses on polarization, it's thread analysis does not surface interesting opinions or side stories, help user build an understanding of individual community members, or substitute for reading the comments or the article people are responding to. 

The main lesson from building it is that automated model selection is expensive, time-consuming, and of suspect quality. 

The model to model comparisons (shown below) that inform the model select UI are somewhat useful.

## Goal

Given a Hacker News comment thread id or pasted article, produce the bipolar axes along which commenters disagree, with no human in the loop.

## \<SLOP STARTS HERE\>

## Model comparison artifacts

These three model-selection tables are somewhat informative artifacts of the experiment, captured as they stood on September 13, 2026.

### Extraction and scoring

| Model            | Estimated cost / 1k comments | Estimated time / 1k comments | Reasoning effort | Stances found / comment | Two-sided rows / 100 comments | Stances held in blind review | Stances wrong in blind review |
| ---------------- | ---------------------------: | ---------------------------: | ---------------- | ----------------------: | ----------------------------: | ---------------------------: | ----------------------------: |
| Claude Haiku 4.5 |                        $0.94 |                   69 seconds | none             |                     0.5 |                           3.5 |                          59% |                           12% |
| Claude Opus 5    |                       $10.46 |                    4 minutes | adaptive         |                     0.7 |                            13 |                          74% |                            0% |
| Gemini 3.8 Flash |                        $1.94 |                    3 minutes | none             |                     0.3 |                             3 |                          97% |                            2% |
| GLM 5.3 Flash    |                        $0.19 |                   41 minutes | low              |                    0.55 |                          3.75 |                          64% |                           33% |
| GPT-5.6 Luna     |                        $0.26 |                    2 minutes | low              |                     0.5 |                             6 |                          80% |                            6% |

### Consolidation

| Model                      | Cost / 1k comments | Minutes / 1k comments | Two-sided comparisons / 1k comments | Axes flagged in review | Candidates fully preserved in review |
| -------------------------- | -----------------: | --------------------: | ----------------------------------: | ---------------------: | -----------------------------------: |
| Claude Fable 5.1 (low)     |              $0.88 |                   3.0 |                                64.0 |          13.0% (12/92) |                       44.3% (98/221) |
| Claude Opus 5 (adaptive)   |              $0.87 |                   6.1 |                                83.5 |           7.5% (9/120) |                      57.0% (126/221) |
| Claude Sonnet 5 (adaptive) |              $0.71 |                  10.0 |                                70.5 |         15.7% (16/102) |                      52.5% (116/221) |
| Gemini 3.8 Flash           |              $0.16 |                   1.8 |                                47.8 |            7.8% (5/64) |                       32.1% (71/221) |
| GLM 5.3 (high)             |              $0.49 |                  18.6 |                                94.8 |           4.8% (7/146) |                      76.0% (168/221) |
| GPT-5.6 Luna (max)         |              $0.26 |                  31.6 |                                90.0 |           4.3% (6/139) |                      70.1% (155/221) |
| GPT-5.6 Sol (low)          |              $0.11 |                   1.9 |                               101.3 |           0.6% (1/164) |                      81.4% (180/221) |
| GPT-6 Astra (low)          |              $0.49 |                   2.0 |                                86.7 |           4.7% (7/150) |                      71.9% (159/221) |

### Summary

| Model                      | Cost / 1k comments | Time (min) / 1k comments | Quality /100 | Failed / major error |
| -------------------------- | -----------------: | -----------------------: | -----------: | -------------------: |
| Claude Fable 5.1 (low)     |              $1.27 |                      2.1 |         87.7 |                   0% |
| Claude Opus 5 (adaptive)   |              $0.58 |                      1.9 |         83.3 |                  40% |
| Claude Sonnet 5 (adaptive) |              $0.19 |                      1.1 |         70.9 |                 100% |
| Gemini 3.8 Flash           |              $0.10 |                      0.9 |         78.4 |                  60% |
| GLM 5.3 (high)             |              $0.11 |                      0.7 |         29.1 |                 100% |
| GPT-5.6 Luna (max)         |              $0.05 |                      3.5 |         75.8 |                  80% |
| GPT-5.6 Sol (low)          |              $0.12 |                      0.9 |         85.3 |                  40% |
| GPT-6 Astra (low)          |              $0.56 |                      0.7 |         91.4 |                   0% |

## Input

- Thread id, or plain text through **Paste article**.
- OpenRouter key, pasted on the page or obtained by signing in with OpenRouter. An OAuth key is remembered in the browser automatically; a pasted key is held in memory and gone on reload unless "Remember pasted key" is ticked.
- Test thread: https://news.ycombinator.com/item?id=49525378 (Claude Fable 5.1 and Claude Mythos 5.1, about 1300 comments). Thread 49537553 (Gemini 3.8 Flash release, 484-comment snapshot) served the model comparisons.

## Pasted articles

Choose **Paste article**, paste unformatted text, optionally add a title, and press **Run**. The full article is selected automatically; the HN comment-share slider is hidden. Up to 100,000 characters are accepted. Longer input is rejected explicitly, never truncated. The estimate includes additional preparation and review allowances; these are heuristics, not measured article benchmarks or price caps. All calls share the selected models, budget, cancellation, billing safeguards and cache.

Preparation sends the whole article with numbered words to the extraction model. It returns an exhaustive partition of word ranges, a speaker registry, and attribution kinds. Code validates complete ordered coverage and grounded speaker labels, then extracts exact source spans. The author is one voice across all their passages; repeated quoted speakers share an identity. Duplicate quotations by the same speaker count once. Direct quotations and the author's own assertions enter scoring. Reported paraphrases and unresolved attribution remain visible separately and add no votes. Neutral framing and headings remain in the original text. These are automatic model judgments, not authenticated testimony or a representative survey.

Standalone poems, monologues and soliloquies are supported. Their continuous primary voice uses the same source-local identity as an essay author, even without a name; this does not identify a historical person or attribute a character's beliefs to the literary author. Anonymous quotations embedded in reporting and unclear speaker turns remain unresolved. A passage that explicitly weighs incompatible alternatives with reasons can yield a comparison without choosing either side. Such deliberation can count as one middle voice after both scoring passes agree; merely posing a question adds no stance. If attribution excludes every passage, the result explains that comparison analysis did not run.

The prepared passages use extraction, consolidation, two scoring passes and per-person counting. Before scoring, an additional consolidation-model review rejects axes whose statements can both be true or ask different questions. The article summary receives explicit flags identifying comparisons with actual opposing votes, plus complete supporting passages stored once in its context. Another review checks it against that evidence. An unsupported summary gets at most one semantic revision, separately from the one format-repair allowance; persistent failure hides the prose and preserves usable comparisons. These checks reduce errors but do not establish the truth of quoted claims.

Clicking a count opens its attributed voices and passages below the paragraph. **Show in article** highlights the exact passage in the complete original. The author's name and speaker labels are needed during preparation; downstream identity metadata uses anonymous voice IDs. Original text and quotations retain their supplied wording. Single-author articles describe that author's claims, not paragraph counts as public opinion.

Articles and results use content-based IDs alongside HN snapshots in the browser cache. Their original text, attribution responses, reviews and results are included in cache export/import. Run URLs contain an ID and settings, not the article text. A URL can reopen the source only in a browser holding that source or after importing its cache. Editing the text or title selects a new source and removes the previous result; only fully cached work starts automatically without a paid call.

The headless runner supports the same workflow:

```
node scripts/run_node.js --article-file=article.txt --title="Optional title" --cache-dir=cache --out=result.json --budget=1
```

`--article-file` and `--thread` are mutually exclusive; articles require `--share=100`. Article JSON results include the full source, passage offsets and anonymous counted comments. The normal model and sampling flags apply to preparation and reviews through their respective roles.

## Definition of an axis

An axis is a pair of incompatible statements about the same specific thing, such that one commenter could hold the first and another the second: "the safeguard fallback fires on ordinary coding work", "Codex subscription quota lasts longer than Claude's", "text watermarking degrades output quality". An overall verdict counts when phrased as a statement ("the release is a worthwhile upgrade" versus "the release is not a meaningful upgrade"). Not axes: topics ("pricing"), mood without a claim ("I'm disappointed"), traits of the commenter ("uses the API rather than a subscription"). The tool judges opinions, not people: commenter names never appear in the output or in any prompt.

## Output

A final model synthesis leads with the main disagreements and their reasoning, including supported minority arguments where useful. It targets 200–300 words in 3–4 concise paragraphs, with one or two supporting comparisons per paragraph (less for thin evidence). Inline counts such as **(64–18–1)** appear immediately beside the exact supported claim or sentence, including midparagraph. They mean people supporting the first stance, the opposing stance, and middle/conditional views when present; self contradiction is separately labeled. Counts are recomputed from verified rows, never supplied by the model. Each number opens only that stance's people and comments immediately below its paragraph, without jumping to or expanding **Explore comparisons (N)**. Button labels and tooltips identify the stance, and evidence headings distinguish people from comments. All comparisons, scope, caveats, and warnings start collapsed. Within each comparison the better-supported view is blue and the opposing view orange.

## Constraints

- No human review.
- Models are called through OpenRouter. Defaults: GPT-5.6 Luna low for extraction and scoring, GPT-5.6 Sol low for consolidation, and GPT-6 Sol low for final synthesis.
- A run stops scheduling calls when its spend reaches the Max cost box, default 1 dollar. Already in-flight calls finish and are accounted for; their charges can exceed that budget.
- If OpenRouter omits `usage.cost`, the client reads the generation's billed `total_cost` from [generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation), with up to three reads (10-second timeout each) for delayed billing. It never substitutes zero or a price estimate. If billing remains unknown, new work stops, already in-flight calls finish and cache normally, and the raw response is saved for a same-settings retry that checks billing without repeating the paid generation. Unresolved responses are not free cache hits; recovered charges count toward the retry's budget. Reported spend excludes unresolved charges (explicitly warned). If storage fails, the error warns that reloading or starting another run can lose this protection.
- Two runs on the same stored copy of a thread should produce similar top-20 lists.

## Files

- `hn_polarization.html`: the app, in one self-contained page. `<script id="core">` holds the pipeline with no DOM access; `<script id="page">` holds the browser glue.
- `scripts/load_core.js`: evaluates the core block as a Node module for the runner and the tests, so there is no build step and no second copy of the pipeline.
- `scripts/run_node.js`: headless runner with options for models, caching, thread files, comment share, and budget.
- `scripts/csp.js`: recomputes the Content-Security-Policy hashes of the page's two script blocks and its style block; `node scripts/csp.js` reports whether the policy is current, `--write` rewrites it. A browser refuses an inline block whose hash the policy does not name. Run `node scripts/csp.js --write` after editing an inline block.
- `tests/core.test.js`: unit and integration tests for the core block. `tests/csp.test.js` checks that the policy is current and that the page has LF line endings, which the hashes depend on. `.gitattributes` pins every text file to LF in the index and the working tree, regardless of `core.autocrlf`. Run all with `node --test`.

## User interface

The app is hosted at https://andyrosa.github.io/orange_split/.
The public source repository is https://github.com/andyrosa/orange_split.

Every push to `main` runs `node --test`, including the Content-Security-Policy checks,
and deploys through `.github/workflows/pages.yml`. The workflow publishes only
`hn_polarization.html`, copied byte-for-byte to `index.html`. Cache exports, prototypes,
documentation, scripts, and tests are not included in the website. GitHub Pages must
use **GitHub Actions** as its publishing source. Deployment can also be started manually
from the repository's **Actions** tab.

Cache exports, generated outputs, local browser diagnostics, environment files, and
private key files are ignored by Git. Keep credentials in the browser or the
`OPENROUTER_API_KEY` environment variable; never commit them.

Open `hn_polarization.html` in a browser. The tab title names Orange Split and changes to the loaded article title. Every button sits right after the thing it acts on and appears only when it can do something.

The three model selectors show only the selected names side by side, wrapping to a second line if needed. Click a name to reveal its property columns in a wide popover; on narrow screens the columns scroll inside it. Numeric property cells use a separate red–yellow–green scale for each column: green is best, yellow is the midpoint, and red is worst. Lower cost, time, wrong-stance rates, and consolidation issue rates are better; higher two-sided yield, coverage, and held-stance rates are better. Numeric ranges are displayed as their midpoint; the same midpoint drives the color scale. Text, missing measurements, summary evaluation statuses, and columns with no variation stay neutral. Accessible labels and tooltips identify each model's role. Selecting a model or pressing Escape closes the popover, as does clicking outside it.

On mobile, story-selector rows put the title above the smaller details, with both wrapping as needed so the full title and metadata remain readable. Wider screens retain the compact single-line layout.

1. Pick **Front page** or **Search all**, then use the leftmost Thread box. Front page lists the first 30 stories in Hacker News's ranking. Click the selected **Front page** button to switch to **Front page +1**, covering the first 60 stories; click again to return to 30. Typing filters the selected list locally, and **Min comments** applies to both sizes. Returning from **Search all** or **Paste article** starts at 30. Search all waits for three characters, then shows at most 30 Algolia story matches. A numeric thread id loads directly in either mode. The full-width list opens under the box on focus, click, or typing. Each row shows the linked title, current comment count, posting time, id, fetched snapshot count, new-comment difference, and preprocessing status. Clicking the title opens the Hacker News post in a new tab; clicking elsewhere loads it for analysis. A bold title means at least one model call or a completed result for the selected run is already cached; a snapshot alone does not bold it. Status distinguishes a saved result, fully cached calls, partial calls, snapshot only, or not stored. The Min comments box to its right hides stories with fewer comments from both lists; default 100, empty hides nothing. Arrow keys move the highlight, Enter or a row click picks, and Escape or leaving the box closes. A picked row or a typed id ("Load thread", Enter, or leaving the box) loads the thread; the box empties and the loaded title follows it as another new-tab link to the Hacker News post. The line below compares HN's current comment count with the stored snapshot. When they match it reads, for example, "32 comments, posted 2026-09-02 09:24 PM, id 49543530, fetched comments on 2026-09-02 09:25 PM". When new comments exist, the older snapshot count is repeated in bold after "fetched" (for example, "35 comments ... fetched **32** comments on ..."). Import changes its button to **Importing…**, reports the file being processed, and disables conflicting cache controls until storage and cache checks finish.
2. Choose extraction/scoring, consolidation, and summary models independently from three keyboard-accessible grid dropdowns. Extraction and scoring has explicit columns for model, reasoning effort, estimated cost and time per 1000 comments, stances found per comment, two-sided rows per 100 comments, stances held in blind review, and stances judged wrong in blind review. Its choices are Claude Haiku 4.5, GLM 5.3 Flash, Gemini 3.8 Flash, Claude Opus 5, GPT-5.6 Luna at reasoning low, and GPT-6 Luna at reasoning low. GPT-6 Luna was measured beside a GPT-5.6 Luna reference run on the same thread; its cost, time and call latency are the GPT-5.6 Luna constants scaled by the measured ratios. See [GPT-6 Luna method and results](docs/volume-addition.md) and [retained measurements](data/volume-addition.json). Consolidation has six columns: model (including reasoning effort), cost per 1000 comments, time per 1000 comments, two-sided comparisons per 1000 comments, axes flagged in review, and candidates fully preserved in review. All eight consolidation choices use one matched experiment: the same five frozen HN sources (1,234 comments), 233 Luna-low extracted candidates, one accepted consolidation output per model per thread, the same two-pass Luna-low scoring, and a common anonymous Sonnet 5 medium-effort review. A single legitimate-exclusion list per thread gives all eight models exactly the same candidate-preservation denominator; partial and missing candidates remain. Consolidation cost and time are measured separately from extraction, scoring, summaries and review, pooled over the same source-comment count and expressed per 1000 comments. Token costs use one dated uncached price catalog. Review flags are model judgments; Sonnet reviews its own model and shares a model family with Opus and Fable. See the [matched results and method](docs/consolidation-matched.md) and [retained measurements and review evidence](data/consolidation-matched.json). GPT-6 Sol at reasoning low and Claude Opus 5.5 were added later on the same inputs, scoring and exclusion lists, but graded in a separate Sonnet 5 review of the two added models only; see [consolidation additions](docs/consolidation-additions.md) and [retained evidence](data/consolidation-additions.json). Summary has five columns: model (including reasoning effort), quality /100, failed or major-support-error percentage, cost per 1,000 comments, and time in minutes per 1,000 comments. All eight rows use the same five frozen Sol-low consolidation and Luna-low scoring inputs, one summary attempt per model per thread, and one shared anonymous Astra-high review per thread. Quality weights faithfulness 60%, coverage 30%, clarity 10%; summaries unavailable after their one production format repair score zero. The error column counts each failed or materially unsupported summary once. Summary cost/time include generation and repairs only, with uncached token prices; reviews are excluded. The selector is alphabetized. See [matched summary method](docs/summary-matched.md) and [retained grades and measurements](data/summary-matched.json). GPT-6 Sol and Claude Opus 5.5 summaries use the same inputs and rubric, graded in a separate Astra-high review of the two added models only; Opus 5.5 receives the lookaround-free paragraph pattern that OpenAI models receive, because it rejects regex lookaround. See [summary additions](docs/summary-additions.md) and [retained grades](data/summary-additions.json). These fixed-input benchmarks compare summary choices; they do not claim to measure every upstream combination. Its choices are Claude Sonnet 5, GPT-6 Astra at reasoning low, GLM 5.3, Gemini 3.8 Flash, Claude Opus 5, GPT-5.6 Sol at reasoning low, GPT-5.6 Luna at reasoning max, Claude Fable 5.1 at reasoning low, GPT-6 Sol at reasoning low, and Claude Opus 5.5. Matched consolidation and summary rows use their experiments' actual pooled per-1000-comment values; other cost/time estimates convert per-character forecast constants at 317.6 characters per comment.
3. Set the Max cost box, default $1. It is the budget the run stops at; whenever it, a model, or the thread changes, the page sets the slider to the largest share of top comments whose forecast fits (well under 100% for Opus 5 on a large thread). The slider can then be moved by hand. It keeps the first N% of comments in thread order, Hacker News's own ranking, depth-first, so every reply in the share has its parent in it and the same percentage always gives the same comments. The text beside it shows the comments that leaves, their text size in characters, and, as "Next run:", the forecast cost and time: measured per-character rates, the consolidation share scaled by candidate volume, an additional synthesis allowance, and a latency floor for four sequential model stages. The page also counts the run's model calls already in the cache, by building every request and looking it up; the count stops at the first stage with a miss. With some calls cached a sentence lists them per stage; with all cached the line reads "Next run: $0 and 0 seconds" and a just-loaded thread runs by itself, with or without a key. A result describes one selection, so changing the share, a model, or the budget removes the result on the page and the line reporting it, and the status line says so. When the new selection turns out fully cached the run starts by itself there too, replacing the run URL instead of adding a history entry, so dragging the slider does not fill the browser history. Returning the slider to the selection whose result is on the page changes nothing.
4. Provide a key if none is held, then press Run (enabled once a thread is loaded, the share is above 0, and a key is held or typed, or the run is fully cached). While Run is disabled the text beside it names what is still missing: "Load a thread to run.", "Move the slider above 0% to run.", or "Enter an OpenRouter key to run." Either paste a key, or press "Sign in with OpenRouter instead": a PKCE code challenge to openrouter.ai, exchanged on return for a key bound to that account, with no secret and no server; the button appears only when the page is served over http(s) from a stable URL, since OpenRouter needs a callback URL and the browser a secure context. OAuth keys are remembered in the browser automatically. A pasted key stays only until reload unless "Remember pasted key" is ticked. The key is never displayed again. While one is held the entry field disappears and "OpenRouter key" and a Delete button appear on the storage line; the key label's tooltip indicates "held until reload" or "remembered in this browser". Run adds the article, snapshot capture time, comment share, all three model choices, and budget to the page URL. The snapshot time uses ISO UTC in the URL as the nonce tying that URL to the cached result; visible snapshot, posted, and fetched times use local `YYYY-MM-DD hh:mm AM/PM`, except for the compact cache range described below. Reopening the URL restores its controls and completed result. During a run the status line shows the stage, units done, calls in flight, call count, cached calls, running cost, and elapsed time. The completion line shows actual time and cost followed by their pre-run estimates in parentheses. A classification is one comment placed on one row. Cancel aborts the in-flight requests.

OpenRouter sign-in pre-fills the new key's label with the app name and the browser and OS when detectable, for example `Orange Split - Edge on Windows` or `Orange Split - Safari on macOS`. Browser detection is a best-effort reminder, without version numbers. Webpages cannot read browser profile names; add a nickname such as "Work profile" in OpenRouter's editable key-label field if needed. This uses the [OAuth `key_label` parameter](https://openrouter.ai/docs/guides/overview/auth/oauth). For localhost callbacks, OpenRouter's authorization heading uses the host and port; the custom label identifies the saved key.

Caches use the browser's IndexedDB. Storage belongs to the origin (scheme, host, port), not the file name. The remembered OpenRouter key is stored in localStorage. Besides the remembered key, three caches are kept, counted as threads, AI calls, then summaries: fetched thread snapshots keyed by article id; finished model calls keyed by request content, so failed runs resume where they stopped; and saved results keyed by all run URL parameters, so reopening one of those exact finished run configurations restores its page directly. The thread count is a disclosure: click it to list stored threads newest-first with title, comment count, fetched time, and id, then click a thread to load that snapshot without refetching it. Model calls can be reusable pieces from partial runs or different settings, so their count does not imply the same number of saved results. When every call for a selected configuration is cached, loading its thread reconstructs the result for free and saves that result under the current settings. Export downloads all three caches as JSON without the OpenRouter key. Import merges such a file into the browser in one transaction while leaving the OpenRouter key untouched. Import compares content before dates, ignoring save and fetch metadata when checking equality. Identical content is not reported as an update; its stored dates silently advance to the newest valid date from either copy. A differing entry replaces the browser copy only when both have valid dates and the imported copy is strictly newer: thread snapshots use their fetch dates; newly saved AI calls and summaries carry save dates. For differing content, older imports, equal-date conflicts, and conflicts with missing or invalid dates keep the browser copy. Older summary formats cannot replace newer formats. The export file date is never used to infer an entry's age. Import reports new entries, actual updates, and differing entries it kept; it checks the current stored values inside the transaction to protect newer writes from other tabs. If storage refuses an import, the previous cache remains intact. Delete removes all three caches and never the key.

The **Min comments** arrow buttons and Up/Down keys double/halve the threshold (100 → 200 → 400; 100 → 50 → 25), rounding down to whole numbers. Up from empty or zero starts at 1; Down stops at 0. Arrow adjustments cap at JavaScript's maximum safe integer. Direct typing is unrestricted and refreshes the filter immediately. This setting resets to 100 on reload.

The cache line reads `Cached locally: N threads, N AI calls, N summaries YYYY/MM/DD HH:mm to YYYY/MM/DD HH:mm`. Its range uses the earliest and latest cached thread snapshot fetch times, in local time with a 24-hour clock. No range is shown when there are no cached snapshots. The held-key label reads `OpenRouter key`; its tooltip indicates whether it is remembered or held until reload.

## Key handling

The page is one HTML file with no dependencies and no third-party script. The OpenRouter key is sent only to openrouter.ai; view-source shows every fetch, and a Content-Security-Policy on the page limits connections to openrouter.ai and hn.algolia.com. OAuth keys are kept in localStorage automatically. Pasted keys are held in memory and gone on reload unless Remember pasted key is ticked. Use the Delete button to remove either kind. Create the key with a credit limit, or use Sign in with OpenRouter and set a limit on the resulting key in the dashboard, where it can also be revoked.

## Pipeline

1. Extract. Comments are batched in thread order at about 12,000 characters, keeping top-level subtrees together when they fit. For each batch the model lists candidate axes: two incompatible statements plus the ids of comments in the batch holding each; ids from outside the batch are dropped with a warning.
2. Consolidate. One call merges all candidates into canonical axes: two candidates are the same disagreement when a commenter on side 1 of one would almost certainly be on side 1 of the other, merged into one axis worded after the largest; candidates stay apart only when commenters could plausibly split differently. No target count. This call is not split; malformed or truncated output can receive one format repair, described below. Its output ceiling is 128k tokens for every consolidator but Gemini 3.8 Flash, whose ceiling is 65,536.
3. Score. Every comment, with an excerpt of its parent (the parent's own words, skipping quoted lines), is classified against every axis in batches of 20: statement 1, statement 2, middle, or not addressed. Two passes, the second with the axes shuffled and the statements swapped; only stances both passes agree on count. The completion report separates true conflicts (both passes classify the pair differently) from single-pass classifications (one pass classifies it and the other omits it). Five leave-out rules: the parent excerpt only resolves what the comment refers to and its position is never the comment's; words that only agree or disagree with the parent carry no position; a line starting with > is not the commenter's claim; a position attributed to someone else is not the commenter's; holding one statement while granting a point to the other is that side, not middle. Extraction applies the second and third of these as well.
4. Compute. Count each person once per axis. Repeating the same stance does not add votes. A person with verified comments on both opposing sides counts in a separate **self contradiction** class, never on either side or in the middle, regardless of how often either stance occurs. Otherwise use the majority verified stance, with ties counting as middle. The side with more people becomes statement 1. Rank axes by polarized people (side 1 plus side 2), excluding middle, self contradiction, and unverified comments, with statement text breaking ties. Saved results recompute these counts from their evidence without new model calls.
5. Synthesize. One final call uses the selected summary model, its sampling/reasoning settings, and a 16,000-token output ceiling. Both the prompt and the API request explicitly require the JSON schema, with narrative prose inside `sections[].text`, not a standalone Markdown answer. Each section uses 1–2 explicit `[[axis:ID]]` markers immediately after their supported claims, with the same verified integer IDs listed once in `axisIds`, in marker order. For example: `{"text":"Cost divides opinion[[axis:1]], while reliability raises a separate concern[[axis:2]]. The distinction matters.","axisIds":[1,2]}`. Square brackets are reserved for markers. Missing, malformed, unknown, duplicated, mismatched, leading, or adjacent markers fail shared validation and use the same bounded repair path as other format errors. Word limits use whitespace splitting, including standalone marker tokens; markers should attach directly to preceding prose. The renderer replaces markers in place with verified numeric buttons and inserts all surrounding prose as text nodes, never HTML. Context includes up to forty ranked axes with deterministic people counts and up to two distinct-author excerpts per class, capped at 700 characters each. Author names are not included. The prompt forbids invented facts or cross-axis author camps, distinguishes one-sided evidence from consensus, and permits supported minority arguments. This is model interpretation, not fact checking; bounded excerpts can miss nuance. No verified axes means no synthesis call.

Synthesis participates in progress, cancellation, budget accounting, cache probing, and exported caches in both page and runner. Forecasts add the selected summary model's matched per-character rate and measured call latency floor. These estimates include the observed repair costs but are not hard price caps. The summary picker reports matched quality measurements for all eight choices. A synthesis call can exceed the budget before its billed usage is known. A failed, cancelled, malformed, or over-budget synthesis leaves comparisons usable and explicitly reports the missing summary. Format failures report the original validation error and any repair failure or budget/cancellation block. Rejected output is preserved in the saved result's `synthesisFailure.response`, plus `repairResponse` when available, for diagnosis only, never as a displayed summary.

All stages share the same validation path for fresh output and cache replay. Accepted formats include JSON fences, bare statement/stance arrays, and scoring's per-comment axis-to-stance maps. Arbitrary Markdown is **not** treated as valid structured output. Extraction/scoring responses that are malformed or truncated split into smaller batches down to one comment. Consolidation and synthesis cannot split: each gets **at most one automatic format-repair call per run**, using the same model/settings, original context, rejected output, validation error, and schema. Repair does not repeat extraction, consolidation, or scoring work already completed.

Original calls and repairs are both counted and billed, even when invalid. Exhausted budget, unknown billing, or cancellation prevents repair from starting. Terminal errors stop queued work without aborting other in-flight calls, which finish and cache normally; explicit Cancel still aborts requests. Paid malformed output is saved in the model cache as JSON or a raw-response diagnostic, not as a successful summary. A same-settings rerun reuses that original to attempt only the missing/failed repair; successful repairs replay for free. A failed one-comment batch can be retried on an explicit rerun. Probing follows the same recovery path without model calls: reusable originals count as hits, but a missing/invalid repair is a miss, so incomplete summaries cannot trigger a paid automatic run. Storage failure is warned because a new run or reload may lose retained output and repeat a paid call.

Saved summaries reopen without API calls when their format is supported. Regenerating an incompatible summary may require paid model calls. The runner includes the narrative (with explicit citation markers) in JSON/text output and returns a failure exit code after saving partial results if synthesis failed.

## Result blocks

Per verified axis: statement 1 is blue at 18px and statement 2 is orange at 14px. These sizes are fixed for every axis. Between them is a fixed-width proportion bar showing people: blue for statement 1, grey for middle, orange for statement 2, and purple for self contradiction. The clickable side counts flank the bar, followed by middle, self contradiction, and unverified counts when present. Each person belongs to exactly one verified class; clicking a class shows that group's verified comment evidence. Unverified counts refer to comments; clicking one opens both scoring-pass outcomes. Clicking the active count again closes it. Each comment includes its author, text, and Hacker News permalink. Consolidated axes for which no comment stance matched between both scoring passes appear separately in a collapsed "Unverified axes" diagnostic section with links to their unverified comments and do not count as result rows. The runner prints the counts in words.

## Configuration

`DEFAULT_CONFIG` in the core block holds the model, sampling (temperature, seed), reasoning, and output ceiling per stage, batch sizes, concurrency, and the budget; the selects, the Max cost box, and the runner's flags override it per run. Sampling and reasoning are per stage because providers differ: Claude Haiku 4.5 takes temperature but not seed; Claude Sonnet 5 and Opus 5 take neither and think adaptively; Claude Fable 5.1 takes a reasoning effort only; GLM 5.3 Flash cannot run without reasoning and needs large ceilings; Gemini 3.8 Flash takes temperature and seed; the GPT-5.6 models take seed and a reasoning effort but not temperature.

## Headless runner

```
node scripts/run_node.js --thread=49525378 [--key=sk-or-...] [--out=result.json] [--concurrency=30] [--cache-dir=path] [--thread-file=path] [--config-file=path] [--volume=<key>] [--consolidation=<key>] [--summary=<key>] [--model=id] [--temperature=0] [--seed=12345] [--share=<percent>] [--budget=<usd>]
```

The key comes from `--key` or `OPENROUTER_API_KEY`. `--cache-dir` stores each finished call as a file and reuses it. `--thread-file` reads the thread from that file when it exists, else fetches and saves it, which keeps reruns comparable. `--config-file` is a JSON object of `DEFAULT_CONFIG` overrides; `--volume`, `--consolidation`, and `--summary` pick option entries by key, each setting only its own role's stages; `--model`, `--temperature`, and `--seed` apply to every stage; `--share` keeps the top N percent of comments; `--budget` sets the stop.

## Astra low replay evaluation

`scripts/eval_astra.js` compares three fresh Astra-low consolidations and summaries with an exact cached Sonnet baseline, without repeating extraction or scoring. It selects a current-format saved result only when both reconstructed requests match their original cached responses. A dry run prepares the frozen inputs and makes no API calls:

```
node scripts/eval_astra.js --cache=export.json --thread=22866284 --out-dir=outputs/astra-low
node scripts/eval_astra.js --cache=export.json --thread=22866284 --out-dir=outputs/astra-low --run
node scripts/eval_astra.js --cache=export.json --thread=22866284 --out-dir=outputs/astra-low --judge
```

Use the same cache, thread and output-directory flags on each command when overriding the defaults. Paid commands use `OPENROUTER_API_KEY` and only `openai/gpt-6-astra` with reasoning `low`. `--repeats=3` and `--budget=5` are the defaults; the budget stops new calls, but an in-flight call can exceed it. Separate sample files prevent repeats from hitting each other's response cache; rerunning in the same directory resumes completed attempts. Unknown billing or interrupted requests stop further spending. Input fixtures, responses, costs, elapsed times, validator results, anonymous judge mappings, and a Markdown report are saved under the ignored output directory.

The optional judge uses Astra low, so its semantic grades are uncalibrated same-model assessments. This is a single-thread stage evaluation, not a measurement of new two-sided counts, full-pipeline accuracy, or independent human preference. Cached Sonnet timing is unavailable; historical costs and repeated-input Astra costs are not controlled cold-cache price measurements.

## Astra low: five-thread measurement

This benchmark compares Astra low and Sonnet 5 pipelines. The selectors use separate matched experiments for [consolidation](docs/consolidation-matched.md) and [summary](docs/summary-matched.md).

The benchmark uses five frozen HN snapshots with Luna-low extraction and two-pass scoring: Wolfram Physics, Nitter, Woxi, AI incident response, and formalizing Fermat's Last Theorem. The 1,234 comments span threads of 137–337 comments. Each model has one pipeline run per thread.

| Measurement                                                   | Sonnet 5 | Astra low |
| ------------------------------------------------------------- | -------: | --------: |
| Consolidated axes                                             |      110 |       151 |
| Axes with verified opposing people                            |       90 |       110 |
| Pooled two-sided share of consolidated axes                   |    81.8% |     72.8% |
| Two-pass agreement over all classified comment-axis pairs     |    64.5% |     57.1% |
| Reconstructed pipeline cost, including extraction and repairs |   $1.428 |    $1.625 |
| Summary format repairs                                        |        3 |         0 |

Astra's per-thread two-sided share is 65–85% rounded. More two-sided comparisons coexist with lower overall scoring agreement. Costs include the cached baseline's original billed work; this is not a controlled cold-cache comparison. Astra's consolidation/scoring/summary path took 48–103 seconds per thread at concurrency 10, with extraction replayed. Cached Sonnet timings are unavailable. Opus 5 independently reviewed anonymized consolidation and summary outputs against their supplied evidence. It favored Astra consolidation on all five threads; summaries split two wins each and one tie. These are model judgments, not human labels. The benchmark, independent reviews, and article smoke test cost $4.566884. These results do not establish an overall summary winner.

Reproduction requires a cache export containing the five frozen snapshots and their cached Luna-low extraction responses, plus an OpenRouter key. Pass the export file with `--cache`, as shown here:

```
node scripts/benchmark_astra.js --cache=export.json --run
node scripts/benchmark_astra.js --cache=export.json --judge
node scripts/benchmark_astra.js --cache=export.json --article
node scripts/report_astra_benchmark.js
```

The benchmark saves frozen sources, raw paid-call records and provider cache accounting, pipeline results, anonymous-review mappings, metrics, and a report under `outputs/astra-benchmark/`. `--thread=<id>` selects one of the five frozen threads; `--out-dir`, `--cache`, and `--page` override the defaults. The $15 default spending stop applies to new calls across the benchmark; calls already in flight can exceed it. Missing HN extraction is rejected instead of silently changing the input. Completed calls resume from cache. The synthetic article smoke exercises preparation, consolidation, axis review, scoring, summary and evidence review; it is excluded from HN metrics and is a functional check, not an article-quality benchmark.

## Matched summary quality in the selector

All eight summary rows use one five-thread benchmark, with identical Sol-low consolidation and two-pass Luna-low scoring evidence. Quality /100, failed-or-major-error percentage, uncached cost per 1,000 comments, and service time per 1,000 comments appear directly in the alphabetized selector. Quality is weighted 60% faithfulness, 30% coverage and 10% clarity. An unavailable summary scores zero; the error percentage counts either a production failure after one repair or a reviewed major support error. Failures are not silently excluded or regenerated until successful.

Each thread receives one Astra-high review of all eight anonymous attempts, against complete source comments and shared citation evidence. The report retains component grades, separate failure and major-error counts, per-thread evidence, request hashes and the frozen protocol. Five outputs per model and one model judge provide preliminary comparison, without a statistical rank. Astra also grades its own family. The benchmark uses fixed inputs and does not evaluate every runtime model combination.

```powershell
node scripts/eval_summary_matched.js --run
node scripts/report_summary_matched.js --write-data
```

The runner freezes production code and inputs under `outputs/summary-matched`, reserves request cost ceilings within a $15 budget, and checkpoints paid responses to prevent duplicate billing on resume. Summary generation and reviews use five independent thread workers. Requests rejected before generation are resumable; unknown billing stops resumption. [Matched results](docs/summary-matched.md) and [retained evidence](data/summary-matched.json) are embedded in the page, so opening the selector makes no API calls.

## Astra/Sonnet pipeline summary evaluation

The evaluation gives Astra low a weighted score of 90.1/100 and rank #1. Sonnet 5 adaptive scores 76.2/100; its numeric rank is withheld because 5 of 10 reviews flag major support errors. Astra has no major support errors flagged in these reviews. Evaluation spending was $8.170675. See the [full score and evidence report](docs/summary-quality.md).

This experiment covers Astra low and Sonnet 5 adaptive, each with its own consolidation output. The summary selector uses the [matched summary experiment](docs/summary-matched.md).

Astra high grades ten summaries from the five frozen HN threads, using the same complete discussion as the reference for both outputs. Each thread is graded twice with anonymous output order reversed. Each summary retains its own consolidation and Luna-low scoring evidence, so these are end-to-end summary measurements, not a comparison of isolated writers with identical axes. No humans participate. The evaluator also belongs to Astra's model family, so these are model assessments rather than independent confirmation.

The policy is fixed before grading: faithfulness 60%, coverage 30%, clarity 10%, equally averaged across threads and order passes. Gaps under five points share a rank. A major support error in either order withholds a numeric rank, even if the average is high; if both models have major support errors, neither receives a numeric rank. Scores are reported even when ranks are withheld. This is a conservative practical rule, not a statistical significance claim. HN rankings do not establish article quality.

Reproduce the evaluation from the cached five-thread benchmark artifacts:

```powershell
node scripts/eval_summary_quality.js --run
node scripts/report_summary_quality.js
```

The evaluator uses `OPENROUTER_API_KEY`, caches exact requests and raw responses in `outputs/summary-quality`, and defaults to a $15 spending stop. One in-flight call can exceed the stop. Run without `--run` to rebuild from cached grades without new calls; unresolved requests stop resumption to avoid accidental duplicate billing. `--input`, `--out`, and `--budget` override the defaults. The report script retains compact results and evidence in [data/summary-quality.json](data/summary-quality.json) and [docs/summary-quality.md](docs/summary-quality.md). Numeric rubric grading uses the model-grader approach described in the [OpenAI grader documentation](https://developers.openai.com/api/reference/resources/graders); the rubric and ranking policy here are specific to this project.

## Gemini 3.8 Flash standalone evaluation

Standalone results: faithfulness 74.5/100, coverage 68.5/100, clarity 89.7/100; weighted score 74.22/100. Astra high flagged major support errors in 8/10 reviews. The five runs produced 60 axes, 55 two-sided, and all five summaries passed format validation without repair. Pipeline spending was $0.491328; standalone grading was $3.808380.

Gemini consolidation and summary can be evaluated alone on the five frozen snapshots listed in **Astra low: five-thread measurement**. Luna-low extraction is replayed; Gemini axes receive fresh two-pass Luna-low scoring. Each generated summary receives two separate Astra-high reviews against its complete source discussion, with no competing output or reference summary. Scores weight faithfulness 60%, coverage 30% and clarity 10%. No comparative rank is assigned.

```powershell
node scripts/benchmark_astra.js --candidate=geminiFlash --cache=export.json --run
node scripts/eval_gemini_standalone.js --run
node scripts/report_gemini_standalone.js
```

Generation defaults to `outputs/gemini-standalone`; grading defaults to `outputs/gemini-summary-quality`. Both scripts default to a $15 spending stop. Grading runs at most two calls concurrently, and in-flight calls can exceed the stop. Completed calls are cached; unfinished requests block resumption to avoid duplicate billing. Omitting `--run` on the grading script permits only cached replay. Five threads produce five summaries and ten reviews, not ten independently generated summaries. Compact measurements and cited issues are saved to [data/gemini-summary-quality.json](data/gemini-summary-quality.json) and the [standalone report](docs/gemini-summary-quality.md).

## Controlled model comparison on thread 49537553

These measurements use one 484-comment snapshot, at concurrency 30, to compare models under the same conditions. Sonnet 5 and GLM 5.3 are not offered as extraction and scoring models because they produced fewer stances than Haiku 4.5 at three to four times the cost, taking 3 and 18 minutes on 38 comments. "Top 50%" is the slider at 50. One-arm rows have supporters on one statement only.

The `Pareto role` column evaluates full-thread and top-50% runs separately on three objectives: maximize two-sided axes (using agreed stances per comment as a quality tie-break), minimize cost, and minimize wall time. Top-50% roles are marked `reduced coverage` because those runs omit half the thread. `Dominated` means another run at the same share is at least as good on all three objectives and better on at least one.

| Extract and score / consolidate             | Comments | Candidates | Axes | Two-sided | One-arm | Agreed stances (per comment) | Pass agreement | Cost  | Wall time | Pareto role                       |
| ------------------------------------------- | -------- | ---------- | ---- | --------- | ------- | ---------------------------- | -------------- | ----- | --------- | --------------------------------- |
| GPT-5.6 Luna, reasoning low / Sonnet 5      | 484      | 62         | 36   | 29        | 6       | 246 (0.51)                   | 0.62           | $0.34 | 245 s     | lowest cost                       |
| Haiku 4.5 / Claude Fable 5.1, reasoning low | 484      | 64         | 29   | 17        | 11      | 186 (0.38)                   | 0.45           | $0.61 | 64 s      | dominated                         |
| Haiku 4.5 / GLM 5.3 Flash                   | 484      | 64         | 42   | 22        | 19      | 238 (0.49)                   | 0.50           | $0.43 | 1017 s    | dominated                         |
| Haiku 4.5 / GLM 5.3 Flash, top 50%          | 242      | 29         | 23   | 10        | 12      | 96 (0.40)                    | 0.64           | $0.16 | 61 s      | lowest cost, reduced coverage     |
| Haiku 4.5 / GPT-5.6 Luna, reasoning max     | 484      | 64         | 36   | 20        | 13      | 236 (0.49)                   | 0.48           | $0.48 | 718 s     | dominated                         |
| Haiku 4.5 / GPT-5.6 Sol, reasoning low      | 484      | 64         | 42   | 16        | 23      | 206 (0.43)                   | 0.45           | $0.43 | 54 s      | fast at low cost                  |
| Haiku 4.5 / Haiku 4.5                       | 484      | 64         | 63   | 25        | 33      | 205 (0.42)                   | 0.43           | $0.48 | 48 s      | fastest                           |
| Haiku 4.5 / Haiku 4.5, top 50%              | 242      | 29         | 28   | 12        | 11      | 83 (0.34)                    | 0.50           | $0.18 | 24 s      | fastest, reduced coverage         |
| Haiku 4.5 / Sonnet 5                        | 484      | 64         | 28   | 19        | 9       | 225 (0.46)                   | 0.49           | $0.61 | 212 s     | dominated                         |
| Haiku 4.5 / Sonnet 5, top 50%               | 242      | 29         | 16   | 11        | 5       | 83 (0.34)                    | 0.54           | $0.29 | 126 s     | dominated, reduced coverage       |
| Opus 5 / Sonnet 5                           | 484      | 134        | 85   | 63        | 22      | 354 (0.73)                   | 0.72           | $4.86 | 607 s     | highest quality                   |
| Opus 5 / Sonnet 5, top 50%                  | 242      | 65         | 41   | 36        | 5       | 173 (0.71)                   | 0.81           | $2.75 | 316 s     | highest quality, reduced coverage |

Run links include a `summary` model parameter. If it is omitted, the consolidation model is also used for summary. Each combination has a distinct result key.
