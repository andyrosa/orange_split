# HN Split

For every claim made in a Hacker News thread, how many commenters are for it and how many against.

## Goal

Given a Hacker News comment thread id, produce a ranked list of the bipolar axes along which commenters disagree, with no human in the loop.

## Input

- Thread id.
- OpenRouter key, typed on the page or obtained by signing in with OpenRouter. It is held in memory and gone on reload unless "Remember in this browser" is ticked, which keeps it in the browser's localStorage.
- Test thread: https://news.ycombinator.com/item?id=49525378 (Claude Fable 5.1 and Claude Mythos 5.1, about 1300 comments). Thread 49537553 (Gemini 3.8 Flash release, 484-comment snapshot) served the model comparisons.

## Definition of an axis

An axis is a pair of incompatible statements about the same specific thing, such that one commenter could hold the first and another the second: "the safeguard fallback fires on ordinary coding work", "Codex subscription quota lasts longer than Claude's", "text watermarking degrades output quality". An overall verdict counts when phrased as a statement ("the release is a worthwhile upgrade" versus "the release is not a meaningful upgrade"). Not axes: topics ("pricing"), mood without a claim ("I'm disappointed"), traits of the commenter ("uses the API rather than a subscription"). The tool judges opinions, not people: commenter names never appear in the output or in any prompt.

## Output

One block per distinct disagreement, biggest first: ordered by the number of comments that took a stance, then by the number of commenters. Each block shows the two statements in fonts sized by their share of commenters, with a proportion bar between them, so a contested axis (two statements of similar size) and a settled one (a large statement over a small one) are told apart by eye. Earlier versions ordered by a polarization score; the split carries the same information and the score buried the settled axes.

## Constraints

- No human labels, no human review at any step.
- Models are called through OpenRouter. Defaults: GPT-5.6 Luna at reasoning low for the high-volume stages and Claude Sonnet 5 for consolidation, the pair with the best measured quality per dollar.
- A run stops when its spend exceeds the Max cost box, default 5 dollars.
- Two runs on the same stored copy of a thread should produce similar top-20 lists.

## Files

- `hn_polarization.html`: the deliverable, one self-contained page. `<script id="core">` holds the pipeline with no DOM access; `<script id="page">` holds the browser glue.
- `scripts/load_core.js`: evaluates the core block as a Node module for the runner and the tests, so there is no build step and no second copy of the pipeline.
- `scripts/run_node.js`: headless runner with options for models, caching, thread files, comment share, and budget.
- `scripts/csp.js`: recomputes the Content-Security-Policy hashes of the page's two script blocks and its style block; `node scripts/csp.js` reports whether the policy is current, `--write` rewrites it. Run it after editing any of the three blocks; a browser refuses an inline block whose hash the policy does not name.
- `tests/core.test.js`: unit and integration tests for the core block. `tests/csp.test.js` checks that the policy is current and that the page has LF line endings, which the hashes depend on. `.gitattributes` pins every text file to LF in the index and the working tree, whatever `core.autocrlf` says. Run all with `node --test`.

## Using the page

Open `hn_polarization.html` in a browser. Every button sits right after the thing it acts on and appears only when it can do something.

1. Pick the thread in the Thread box: an id, or search words. A list opens under the box on focus, click, or typing: a header row, then one row per story as "title (comment count, posting date, id)", newest first. Under three characters the list is the current home page (Algolia HN API) filtered by them; from three on it is Algolia story search ("Searching sorted by date", then "Matches sorted by date" or "No matches"). The Min comments box to the left hides stories with fewer comments from both lists; default 100, empty hides nothing. Arrow keys move the highlight, Enter or a click picks, Escape or leaving the box closes. Rows whose run is fully cached at the current share and models are bold. A picked row or a typed id ("Load thread", Enter, or leaving the box) loads the thread; the box empties, the title follows it, and the line below reads, for example, "32 comments, posted 2026-09-02, id 49543530, fetched 9/2/2026, 9:24:51 PM".
2. Choose the models: one select for extraction and scoring (Claude Haiku 4.5, GLM 5.3 Flash, Gemini 3.8 Flash, Claude Opus 5, GPT-5.6 Luna at reasoning low) and one for consolidation (Claude Sonnet 5, GLM 5.3, Gemini 3.8 Flash, Claude Opus 5, GPT-5.6 Sol at reasoning low, GPT-5.6 Luna at reasoning max, Claude Fable 5.1 at reasoning low). Every label is built at load from its entry: the per-token constants the forecast uses, converted to cost and time per 1000 comments at 79.4 comment tokens per comment (the test thread's ratio), then the entry's measured quality record: stances per comment, two-sided rows per 100 comments, and the share of stances that held under blind review for extraction and scoring; the share of axes two-sided for consolidation. No label refers to another model, and none can disagree with the forecast.
3. Set the Max cost box, default $5. It is the budget the run stops at; whenever it, a model, or the thread changes, the page sets the slider to the largest share of top comments whose forecast fits (well under 100% for Opus 5 on a large thread). The slider can then be moved by hand. It keeps the first N% of comments in thread order, Hacker News's own ranking, depth-first, so every reply in the share has its parent in it and the same percentage always gives the same comments. The text beside it shows the comments that leaves and, as "Next run:", the forecast cost and time: per-token rates and stage times from the measured runs, the consolidation share scaled by the candidate volume the chosen extraction model produces relative to Haiku 4.5, and a floor because the three stages run in sequence. The page also counts the run's model calls already in the cache, by building every request and looking it up; the count stops at the first stage with a miss. With some calls cached a sentence lists them per stage; with all cached the line reads "Next run: $0 and 0 seconds" and a just-loaded thread runs by itself, with or without a key.
4. Provide a key if none is held, then press Run (enabled once a thread is loaded, the share is above 0, and a key is held or typed). Either type a key, or press "Sign in with OpenRouter instead": a PKCE code challenge to openrouter.ai, exchanged on return for a key bound to that account, with no secret and no server; the button appears only when the page is served over http(s) from a stable URL, since OpenRouter needs a callback URL and the browser a secure context. The key is never displayed again; it is held in memory unless "Remember in this browser" was ticked before Run or the sign-in. While one is held the entry field disappears and "OpenRouter key", "held until reload" or "remembered in this browser", and a Delete button appear on the storage line. During a run the status line shows the stage, units done, calls in flight (waves of up to 30 return together), call count, cached calls, running cost, and elapsed time; afterwards, for example, "Done in 33 seconds, $0.04, 7 model calls (0 cached). 4 rows from 32 comments by 20 commenters. 10 of 17 classifications matched between the two scoring passes; only matching ones count." A classification is one comment placed on one row. Cancel aborts the in-flight requests.

Storage is the browser's localStorage, which belongs to the origin (scheme, host, port), not the file name. Besides the remembered key, two caches are kept, counted on a line under the buttons with a Delete button that removes both and never the key: a copy of each fetched thread, keyed by id, so reruns score the same comments ("Refetch", after Run, replaces it; "not stored" appears when the browser refused the write); and the result of every finished model call, keyed by request content, so a rerun with the same settings costs nothing and a failed run resumes where it stopped.

## HN post

Key handling: the page is one HTML file with no dependencies and no third-party script. The OpenRouter key is sent only to openrouter.ai; view-source shows every fetch, and a Content-Security-Policy on the page limits connections to openrouter.ai and hn.algolia.com. By default the key is held in memory and gone on reload; tick Remember in this browser to keep it in localStorage, and use the Delete button to remove it. Create the key with a credit limit, or use Sign in with OpenRouter and set a limit on the resulting key in the dashboard, where it can also be revoked.

## Pipeline

1. Extract. Comments are batched in thread order at about 3000 tokens, keeping top-level subtrees together when they fit. For each batch the model lists candidate axes: two incompatible statements plus the ids of comments in the batch holding each; ids from outside the batch are dropped with a warning.
2. Consolidate. One call merges all candidates into canonical axes: two candidates are the same disagreement when a commenter on side 1 of one would almost certainly be on side 1 of the other, merged into one axis worded after the largest; candidates stay apart only when commenters could plausibly split differently. No target count. This call is not split on truncation; its output ceiling is 128k tokens for the Claude and GPT consolidators, 65,536 for Gemini.
3. Score. Every comment, with an excerpt of its parent (the parent's own words, skipping quoted lines), is classified against every axis in batches of 20: statement 1, statement 2, middle, or not addressed. Two passes, the second with the axes shuffled and the statements swapped; only stances both passes agree on count. Five leave-out rules, added in run 9: the parent excerpt only resolves what the comment refers to and its position is never the comment's; words that only agree or disagree with the parent carry no position; a line starting with > is not the commenter's claim; a position attributed to someone else is not the commenter's; holding one statement while granting a point to the other is that side, not middle. The first three also apply to extraction.
4. Compute. Stances are aggregated per commenter (majority of that commenter's comments on the axis, ties count as middle), the side with more commenters becomes statement 1, and rows are ordered by agreed comments, then commenters, then statement text, so the consolidator's output order decides nothing.

Provider misbehavior is tolerated and recorded in the warnings list: an extraction or scoring response truncated at the ceiling or of unknown shape splits the batch in half and retries down to one comment; a response with the right content in a nonstandard wrapper (a bare array, or per-comment objects holding an axis-to-stance map) is accepted.

## Result blocks

Per axis: statement 1 in blue, then statement 2 in orange, each preceded by its commenter count and set in a font sized by its share of the two sides; between them a fixed-width proportion bar, blue for statement 1, grey for middle, orange for statement 2, showing the split within the axis, not its size; then a line with the agreed stances (comments, the ordering number), the commenters on 1 plus 2 plus middle, and the middle count when above zero. The runner prints the split as text: `9 <<<<<<<<->>>>>>>>>>> 14`, 20 cells.

## Configuration

`DEFAULT_CONFIG` in the core block holds the model, sampling (temperature, seed), reasoning, and output ceiling per stage, batch sizes, concurrency, and the budget; the selects, the Max cost box, and the runner's flags override it per run. Sampling and reasoning are per stage because providers differ: Claude Haiku 4.5 takes temperature but not seed; Claude Sonnet 5 and Opus 5 take neither and think adaptively; Claude Fable 5.1 takes a reasoning effort only; GLM 5.3 Flash cannot run without reasoning and needs large ceilings; Gemini 3.8 Flash takes temperature and seed; the GPT-5.6 models take seed and a reasoning effort but not temperature.

## Headless runner

```
node scripts/run_node.js --thread=49525378 [--key=sk-or-...] [--out=result.json] [--concurrency=30] [--cache-dir=path] [--thread-file=path] [--config-file=path] [--volume=<key>] [--consolidation=<key>] [--model=id] [--temperature=0] [--seed=12345] [--share=<percent>] [--budget=<usd>]
```

The key comes from `--key` or `OPENROUTER_API_KEY`. `--cache-dir` stores each finished call as a file and reuses it. `--thread-file` reads the thread from that file when it exists, else fetches and saves it, which keeps reruns comparable. `--config-file` is a JSON object of `DEFAULT_CONFIG` overrides; `--volume` and `--consolidation` pick option entries by key, each setting only its own role's stages; `--model`, `--temperature`, and `--seed` apply to every stage; `--share` keeps the top N percent of comments; `--budget` sets the stop.

## Measured runs on the test thread

Thread 49525378, runs 1 to 7 on 2026-09-02, 8 and 9 on 2026-09-03; the thread grew from 1294 to 1297 comments on the first day, and runs 6 and later used a saved snapshot. Two-sided axes are rows where both statements have supporters; agreed stances are comment-axis pairs both passes agreed on; pass agreement is agreed stances over all stances either pass produced; `±` is a polarization spread no longer computed. Wall time is quoted with the concurrency used.

| # | Extract / consolidate / score | Design | Axes | Two-sided | Agreed stances (per comment) | Pass agreement | ± top 20 | Warnings | Cost | Wall time |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Haiku 4.5 / Sonnet 5 / Haiku 4.5 | proposition plus pole labels | 50 | 34 | 654 (0.51) | 0.46 | - | 0 | $1.26 | 172 s (10) |
| 2 | Haiku 4.5 / Sonnet 5 / Haiku 4.5 | statement pairs | 53 | 40 | 650 (0.50) | 0.39 | - | 0 | $1.58 | 330 s (10) |
| 3 | Haiku 4.5 / Sonnet 5 / Haiku 4.5 | statement pairs, 36 calls from cache | 58 | 43 | 696 (0.54) | 0.42 | 0.24 | 0 | $1.36 | 274 s (10) |
| 4 | Haiku 4.5 / Opus 5 / Haiku 4.5 | statement pairs, run in a separate session | 60 | 35 | 671 (0.52) | - | 0.25 | 0 | $1.57 | 139 s (30) |
| 5 | Gemini 3.8 Flash for all three | statement pairs | 45 | 42 | 386 (0.30) | 0.71 | 0.10 | 1 | $2.61 | 221 s (10) |
| 6 | GLM 5.3 Flash / GLM 5.3 / GLM 5.3 Flash | statement pairs, first success after four failed attempts | 60 | 53 | 767 (0.59) | 0.59 | 0.15 | 28 | about $0.45 clean, $0.64 including the failed attempts | about 22 min (30) |
| 7 | GLM 5.3 Flash / GLM 5.3 / GLM 5.3 Flash | statement pairs, fresh run into an empty cache | 58 | 46 | 666 (0.51) | 0.53 | 0.19 | 8 | $0.40 | 51 min (30) |
| 8 | Haiku 4.5 / Sonnet 5 / Haiku 4.5 | statement pairs, saved 1297-comment snapshot, prompts as in runs 2 to 7, extraction replayed from cache | 64 | 39 | 701 (0.54) | 0.46 | - | 1 | $1.55 | 409 s (30) |
| 9 | Haiku 4.5 / Sonnet 5 / Haiku 4.5 | scoring prompt with the leave-out rules; extraction and consolidation replayed from run 8, so the same 64 axes | 64 | 39 | 664 (0.51) | 0.45 | - | 1 | $0.80 | 16 s (30) |

Per-stage costs on the same design: extraction $0.21 (Haiku), $0.37 (Gemini), $0.03 to $0.04 (GLM Flash) for 38 batches; consolidation $0.28 to $0.35 (Sonnet 5, 25k to 32k completion tokens), $0.34 (Opus 5, 9.8k), $0.03 (Gemini, 7k), $0.12 to $0.24 (GLM 5.3, 30k to 50k reasoning tokens, about 9 minutes); scoring $1.03 (Haiku, 17.7 stances per call), $2.17 (Gemini, 7.1), $0.15 to $0.30 (GLM Flash, 14 to 16, including split retries). The Haiku scoring calls were billed at list price despite the cache-control marker, so scoring cost grows with prompt length.

Failures that changed the pipeline: reasoning cannot be disabled on GLM 5.3 Flash; GLM extraction and scoring calls truncated at 16k and 32k output tokens (ceilings raised, then split-on-truncation added); responses came back as bare arrays, as per-comment objects, and with the stance map under "axes" (shape tolerance added); a GLM 5.3 consolidation and later a Sonnet 5 one truncated at 32k (ceiling raised to 128k, since that call is not split); every failure was a restart until the result cache was added.

Runs 8 and 9 measure the leave-out rules on identical axes: agreed stances fell from 701 to 664, two-sided axes and pass agreement did not move. Of the 31 stances the rules removed from both passes, two blind readers found 20 not holding, 4 holding, 7 borderline. The dominant remaining misread under Haiku is a comment about the axis's subject that answers a different question; a rule against it was measured on thread 49537553 under the Luna default and reverted, since it removed 45 stances of which 23 held and 3 did not, while two-sided rows did not change. The two added extraction rules (quoted lines, bare agreements) were measured in isolation there too, two replicates each: no effect beyond replicate noise (axes 31 and 36 against 28 and 38, two-sided 21 and 23 against 19 and 21).

What the runs show: the GLM pair is the cheapest and most thorough but slow and unpredictable, since GLM 5.3 Flash cannot skip reasoning and its serving speed varied by the hour; Haiku plus Sonnet 5 is the fast, warning-free option at three times the cost; Opus 5 as consolidator spreads the same stances over more rows; Gemini 3.8 Flash scores a third as many stances at the highest cost, with the most stable ranking. Two GLM runs on the same snapshot shared 12 of their top 20 axes within the top 20 and 17 anywhere; GLM versus Claude shared 8 and 12. On the 38-comment smoke thread 3393477 all three providers completed: Claude $0.045 in 28 s, Gemini $0.058 in 26 s, GLM $0.022 in 326 s.

## Model comparison on thread 49537553

Run on 2026-09-03 with the run-9 prompts on a 484-comment snapshot, to test models in roles the runs above never gave them. Sonnet 5 and GLM 5.3 as extraction and scoring models were excluded after smoke runs: fewer stances than Haiku 4.5 at three to four times the cost, and 3 and 18 minutes on 38 comments. "Top 50%" is the slider at 50. One-arm rows have supporters on one statement only.

| Extract and score / consolidate | Comments | Candidates | Axes | Two-sided | One-arm | Agreed stances (per comment) | Pass agreement | Cost | Wall time (30) |
|---|---|---|---|---|---|---|---|---|---|
| Haiku 4.5 / Sonnet 5 | 484 | 64 | 28 | 19 | 9 | 225 (0.46) | 0.49 | $0.61 | 212 s |
| Opus 5 / Sonnet 5 | 484 | 134 | 85 | 63 | 22 | 354 (0.73) | 0.72 | $4.86 | 607 s |
| Haiku 4.5 / Haiku 4.5 | 484 | 64 | 63 | 25 | 33 | 205 (0.42) | 0.43 | $0.48 | 48 s |
| Haiku 4.5 / GLM 5.3 Flash | 484 | 64 | - | - | - | - | - | - | consolidation call not back after 15 minutes; stopped |
| GPT-5.6 Luna, reasoning low / Sonnet 5 | 484 | 62 | 36 | 29 | 6 | 246 (0.51) | 0.62 | $0.34 | 245 s |
| Haiku 4.5 / GPT-5.6 Sol, reasoning low | 484 | 64 | 42 | 16 | 23 | 206 (0.43) | 0.45 | $0.43 | 54 s |
| Haiku 4.5 / GPT-5.6 Luna, reasoning max | 484 | 64 | 36 | 20 | 13 | 236 (0.49) | 0.48 | $0.48 | 718 s |
| Haiku 4.5 / Claude Fable 5.1, reasoning low | 484 | 64 | 29 | 17 | 11 | 186 (0.38) | 0.45 | $0.61 | 64 s |
| Haiku 4.5 / Sonnet 5, top 50% | 242 | 29 | 16 | 11 | 5 | 83 (0.34) | 0.54 | $0.29 | 126 s |
| Opus 5 / Sonnet 5, top 50% | 242 | 65 | 41 | 36 | 5 | 173 (0.71) | 0.81 | $2.75 | 316 s |
| Haiku 4.5 / Haiku 4.5, top 50% | 242 | 29 | 28 | 12 | 11 | 83 (0.34) | 0.50 | $0.18 | 24 s |
| Haiku 4.5 / GLM 5.3 Flash, top 50% | 242 | 29 | 23 | 10 | 12 | 96 (0.40) | 0.64 | $0.16 | 61 s |

- Opus 5 for extraction and scoring: 3.3 times the two-sided rows and 1.6 times the stances of Haiku 4.5, higher pass agreement, 8 times the cost, 3 times the time. Blind review of the top-50% runs (all 83 of Haiku's stances, 90 of Opus's 173): Opus 66 held, 1 did not, 23 borderline; Haiku 49, 10, 24.
- GPT-5.6 Luna at reasoning low for extraction and scoring: above Haiku on every number (29 two-sided against 19, 0.51 per comment against 0.46, agreement 0.62 against 0.49) at $0.11 for the two stages against $0.37; of 90 stances reviewed blind, 72 held, 5 did not, 13 borderline. Hence the default.
- Consolidators on the same 64 Haiku candidates: Haiku 4.5 barely merges (63 axes, 33 one-arm); GLM 5.3 Flash gave fewer two-sided rows than Sonnet at 50% and did not finish at 100%; Sol low cost $0.03 and 38 s but 16 two-sided of 42 with 23 one-arm; Luna max matched Sonnet (20 two-sided of 36) at $0.08 but took 703 s and 67k completion tokens; Fable 5.1 low took 56 s and 4.9k tokens for $0.31, below Sonnet on every quality number.
- The top half of the comments carried about half the stances and 57% of the two-sided rows for about half the cost under both scoring models; disagreement is not concentrated at the top.

Per-stage figures per 1000 comment tokens: Haiku extraction and scoring $0.011 (matching the $0.0119 measured on the test thread), Luna $0.0033 at 1.2 s, Opus $0.132 at 3.2 s (Haiku 0.5 s); consolidation Sol low $0.0010 at 1.2 s, Luna max $0.0025 at 21.6 s, Fable low $0.0096 at 1.7 s. Sonnet 5 consolidation took 497 s and 54.7k completion tokens on Opus's 134 candidates against 195 s and 22.8k on Haiku's 64, so the forecast scales the consolidation share by a per-model candidate factor (Opus 5 2.1, GLM 5.3 Flash 1.3, others 1). Projected to the test thread, Opus 5 with Sonnet 5 costs about $15 and 30 minutes per run.

## Pareto frontier

Objectives: quality (two-sided axes, tie-break agreed stances per comment), cost per run, wall time. One representative run per configuration; both GLM values where two runs exist.

| Configuration | Two-sided axes | Agreed stances per comment | Cost | Wall time | On the frontier |
|---|---|---|---|---|---|
| GLM 5.3 Flash + GLM 5.3 | 53 and 46 | 0.59 and 0.51 | $0.40 to $0.45 | 22 to 51 min | yes: lowest cost, most thorough of the cheap options |
| Haiku 4.5 + Sonnet 5 | 43 | 0.54 | $1.36 | 274 s at concurrency 10, about 140 s at 30 | yes: fastest without losing quality |
| Opus 5 + Sonnet 5 (projected from thread 49537553) | about 3 times Haiku + Sonnet 5's | about 0.73 | about $15 | about 30 min | yes: best quality by a wide margin, at the highest cost |
| GPT-5.6 Luna low + Sonnet 5 (projected from thread 49537553) | about 1.5 times Haiku + Sonnet 5's | about 0.51 | about $0.80 | about 8 min | yes: better and cheaper than Haiku + Sonnet 5, slower |
| Haiku 4.5 + Opus 5 | 35 | 0.52 | $1.57 | 139 s | no: dominated by Haiku + Sonnet 5 |
| Gemini 3.8 Flash alone | 42 | 0.30 | $2.61 | 221 s at concurrency 10 | no: dominated by Haiku + Sonnet 5 |

Wall times were measured at different concurrencies; the frontier assumes 30 for all. Gemini rejoins under a different measure: its ± of 0.10 on the top 20 was the most stable ranking, so it is the choice only if order stability outweighs coverage. Untested: GLM 5.3 Flash for extraction and scoring with Sonnet 5 for consolidation, projected at about $0.55 and 13 minutes.
