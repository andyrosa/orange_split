# HN Split

For every claim made in a Hacker News thread, how many commenters are for it and how many against.

## Goal

Build a tool that, given a Hacker News comment thread id, produces a ranked list of the bipolar axes along which commenters disagree, with no human in the loop.

## Input

- Thread id.
- OpenRouter key, entered on the page and stored in the browser's localStorage.
- Test thread: https://news.ycombinator.com/item?id=49525378 (Claude Fable 5.1 and Claude Mythos 5.1, about 1300 comments). A second thread, 49537553 (Gemini 3.8 Flash release, about 500 comments), was used for the model comparisons below.

## Definition of an axis

An axis is a pair of incompatible statements about the same specific thing, such that one commenter could hold the first and another the second. Examples of statements that anchor an axis: "the safeguard fallback fires on ordinary coding work", "Codex subscription quota lasts longer than Claude's", "text watermarking degrades output quality". An overall verdict on the subject counts when phrased as a statement ("the release is a worthwhile upgrade" versus "the release is not a meaningful upgrade"). What does not count: topics ("pricing"), mood statements without a claim about the subject ("I'm disappointed"), and traits of the commenter ("uses the API rather than a subscription"). The tool judges opinions, not people: commenter names never appear in the output or in any prompt.

## Output

A list with one block per distinct disagreement, biggest first: ordered by the number of comments that took a stance, then by the number of commenters. Each block shows the two statements in fonts sized by their share of commenters, with a proportion bar between them, so a contested axis (two statements of similar size) and a settled one (a large statement over a small one) are told apart by eye rather than by a score. Earlier versions computed polarization and consensus scores and ordered by polarization; those scores are gone, because the split carries the same information and a score-based order buried the settled axes.

## Constraints

- No human labels, no human review at any step.
- Models are called through OpenRouter. The page defaults to GPT-5.6 Luna at reasoning low for the high-volume stages and Claude Sonnet 5 for consolidation, the pair with the best measured quality per dollar; the other listed models were measured on the runs below.
- A run stops when its spend exceeds the Max cost box, default 5 dollars.
- Two runs on the same stored copy of a thread should produce similar top-20 lists.

## Files

- `hn_polarization.html`: the deliverable, a single self-contained page. The `<script id="core">` block holds the pipeline with no DOM access; the `<script id="page">` block holds the browser glue.
- `scripts/load_core.js`: extracts the core script block from the page and evaluates it as a Node module; the runner and the tests both use it, so there is no build step and no second copy of the pipeline.
- `scripts/run_node.js`: headless runner that executes the same core block from Node, with options for models, caching, thread files, comment share, and budget.
- `tests/core.test.js`: unit and integration tests for the core block, run with `node --test tests/core.test.js`.

## Using the page

Open `hn_polarization.html` in a browser. The page has no export and minimal formatting. Every button sits right after the thing it acts on and appears only when it can do something.

1. Pick the thread in the Thread box: a numeric id, or search words. A list drawn by the page opens under the box on focus, click, or typing: a header row saying what the list holds, then one row per story reading "title (comment count, posting date, id)", newest first. While the box holds fewer than three characters the list is the current home page (from the Algolia HN API), filtered by those characters; from three characters on it is Algolia story search, with the header going "Searching sorted by date", then "Matches sorted by date" or "No matches". The Min comments box to the left of the Thread box hides stories with fewer comments from both lists; it defaults to 100, and an empty box hides nothing. Arrow keys move the highlight, Enter or a click picks a row, Escape or leaving the box closes the list. Rows whose run would come entirely from the cache at the current share and models are in bold, since picking them gives the result at once. Picking a row loads that thread; a typed id loads with "Load thread", Enter, or on leaving the box. After a load the box is emptied, the thread's title follows it, and the line below reads, for example, "32 comments, posted 2026-09-02, id 49543530, fetched 9/2/2026, 9:24:51 PM".
2. Choose the models: one select for extraction and scoring (Claude Haiku 4.5, GLM 5.3 Flash, Gemini 3.8 Flash, Claude Opus 5, GPT-5.6 Luna at reasoning low) and one for consolidation (Claude Sonnet 5, GLM 5.3, Gemini 3.8 Flash, Claude Opus 5, GPT-5.6 Sol at reasoning low, GPT-5.6 Luna at reasoning max). Each option is labeled the same way: measured cost and time per 1000 comments, then quality from the measured runs: for extraction and scoring, stances per comment and the share of stances that held under blind review; for consolidation, the share of axes that came out two-sided.
3. Set the Max cost box, default $5. It is the budget the run stops at, and whenever it, a model, or the thread changes, the page sets the slider to the largest share of top comments whose forecast fits it; with Claude Opus 5 on a large thread that is well under 100%. The slider can then be moved by hand; the budget still applies. The slider keeps the first N% of the comments in thread order, which is Hacker News's own ranking with the best-rated top-level threads first, so the same thread and percentage always give the same comments and reruns hit the cache; the order is depth-first, so every reply in the share has its parent in the share. The text beside the slider shows the comments that leaves and, as "Next run:", the approximate cost and time for the selected models, computed from per-token rates and stage times measured on earlier runs, with a floor on the time because the three stages run in sequence and each is at least one model call long. The page also counts how many of the run's model calls are already cached for the current thread, share, and models, by building every request and looking it up without calling a model; the count stops at the first stage with a miss, since each stage's requests depend on the previous stage's results. When some calls are cached, a sentence lists them per stage; when all are, the line reads "Next run: $0 and 0 seconds" and a just-loaded thread runs by itself, with or without a key. The line is always a forecast for the next run; after a run it changes to the cached forecast while the status line keeps the actual cost and time.
4. Provide an OpenRouter key if none is stored, then press Run, which is enabled once a thread is loaded, the share is above 0, and a key is stored or typed. Either type a key, or press "Sign in with OpenRouter instead", which sends the browser to openrouter.ai with a PKCE code challenge and, on return, exchanges the code for a key bound to that account, with no secret and no server; the sign-in button appears only when the page is served over http(s) from a stable URL, because OpenRouter needs a callback URL and the browser needs a secure context for SHA-256. The key is stored in the browser and never displayed again; while one is stored the entry field disappears and "OpenRouter key" with its own Delete button appears on the storage line. During a run the status line shows the stage with its units done, the calls in flight (a wave of up to 30 parallel calls returns together, so the done count moves in bursts), the call count, how many calls came from cache, the running cost, and the elapsed time. Afterwards it reads, for example, "Done in 33 seconds, $0.04, 7 model calls (0 cached). 4 rows from 32 comments by 20 commenters. 10 of 17 classifications matched between the two scoring passes; only matching ones count." A classification is one comment placed on one row; the second number counts the comment-row pairs that either pass classified. Cancel aborts the in-flight requests.

Everything the page stores lives in the browser's localStorage, which belongs to the origin (scheme, host, and port), not to the file name. Besides the key, two kinds of cached data are kept, and a line under the buttons shows how many of each; a Delete button after that count removes both and never touches the key.

- A copy of each fetched thread, keyed by thread id, so that reruns score the same comments; a live thread gains comments over time, which changes every prompt and defeats the result cache. The fetch time says "not stored" when the browser refused the write. "Refetch", after Run, appears while the loaded thread has a stored copy and replaces it with a fresh fetch.
- The result of every finished model call, keyed by the request content, so that a rerun of the same thread with the same settings costs nothing and a failed run resumes where it stopped.

## Pipeline

1. Extract. Comments are grouped in thread order into batches of about 3000 tokens, keeping top-level subtrees together when they fit. For each batch the model lists candidate axes: two incompatible statements plus the ids of comments in the batch holding each; ids from outside the batch are dropped with a warning.
2. Consolidate. One call merges all candidates into canonical axes, each a pair of full-sentence rival statements, applying the definition above. There is no target count: two candidates are the same disagreement when a commenter on side 1 of one would almost certainly be on side 1 of the other, and such candidates merge into one axis worded after the largest of them; candidates stay apart only when commenters could plausibly split differently on them. This call is not split on truncation, so its output ceiling is 128k tokens for the Claude and GLM consolidators.
3. Score. Every comment, with an excerpt of its parent for context (the parent's own words, skipping any line it quotes), is classified against every axis in batches of 20: statement 1, statement 2, middle, or not addressed. This runs twice; the second pass shuffles the axis order and swaps the two statements, and only stances on which both passes agree count. Five leave-out rules apply, added in run 9 below: the parent excerpt only resolves what the comment refers to, and the parent's position is never the comment's; words that only agree or disagree with the parent carry no position; a quoted line (one starting with >) is not the commenter's claim; a position attributed to someone else is not the commenter's; a comment that holds one statement while granting a point to the other is that side, not middle. The first three also apply to extraction.
4. Compute. Stances are aggregated per commenter (majority of that commenter's comments on the axis, ties count as middle), the side with more commenters becomes statement 1, and the list is ordered by agreed comments, then commenters.

The pipeline tolerates two classes of provider misbehavior, each recorded in the warnings list rather than hidden: an extraction or scoring response truncated at the output ceiling or returned in an unrecognized shape causes the batch to be split in half and retried down to a single comment; a response with the right content in a nonstandard wrapper (a bare array, or per-comment objects holding an axis-to-stance map) is accepted as is.

## Result blocks

One block per axis, top to bottom:

- Statement 1, in blue, then statement 2, in orange, with the statement that has more commenters always as statement 1. Each statement is preceded by its commenter count and set in a font sized by its share of the two sides, so a settled axis has a large statement over a small one and a contested axis has two of similar size.
- Between the statements, a proportion bar of fixed width: blue for commenters on statement 1, grey for commenters who addressed the axis but took a middle or mixed position, orange for commenters on statement 2. The bar shows the split within the axis, not its size against other axes; the order of the list carries size.
- A line of small text: the agreed stances on the axis, counting comments rather than commenters (the list is ordered by this number), then the commenters on statement 1 plus statement 2 plus middle, then the middle count when it is above zero.

The headless runner prints the split as text: `9 <<<<<<<<->>>>>>>>>>> 14`, 20 cells of `<` for statement 1, `-` for middle, `>` for statement 2.

## Configuration

All settings live in `DEFAULT_CONFIG` in the core block: the model for each stage, per-stage sampling (temperature, seed) and reasoning settings, per-stage output ceilings, batch sizes, concurrency, and the budget. The model selects, the Max cost box, and the runner's flags override it per run. Sampling and reasoning are per stage because providers differ: Claude Haiku 4.5 accepts temperature but not seed; Claude Sonnet 5 and Claude Opus 5 accept neither and think adaptively; GLM 5.3 Flash cannot run without reasoning and needs large output ceilings; Gemini 3.8 Flash accepts temperature and seed; the GPT-5.6 models accept seed and a reasoning effort but not temperature.

## Headless runner

```
node scripts/run_node.js --thread=49525378 [--key=sk-or-...] [--out=result.json] [--concurrency=30] [--cache-dir=path] [--thread-file=path] [--config-file=path] [--volume=<key>] [--consolidation=<key>] [--model=id] [--temperature=0] [--seed=12345] [--share=<percent>] [--budget=<usd>]
```

The key comes from `--key` or the `OPENROUTER_API_KEY` environment variable. `--cache-dir` stores each finished call as a file and reuses it on later runs. `--thread-file` reads the thread from that file when it exists and otherwise fetches and saves it, which is what keeps reruns comparable. `--config-file` points at a JSON object of `DEFAULT_CONFIG` overrides; `--volume` and `--consolidation` pick the page's option entries by key; `--model`, `--temperature`, and `--seed` apply one model or one sampling setting to every stage; `--share` keeps the top N percent of comments, as the page's slider does; `--budget` sets the spend at which the run stops.

## Measured runs on the test thread

All completed full runs on thread 49525378, in the order they were made: runs 1 to 7 on 2026-09-02, runs 8 and 9 on 2026-09-03. The thread grew from 1294 to 1297 comments during the first day; runs 6 and later used a saved thread file. Columns: two-sided axes are rows where both statements have supporters; agreed stances are comment-axis pairs both scoring passes agreed on; pass agreement is agreed stances divided by all stances either pass produced; `±` is the mean polarization spread of the top 20 rows, a measure no longer computed. Wall time is quoted with the concurrency used.

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

Per-stage costs from the call records, for the three providers on the same design: extraction $0.21 (Haiku), $0.37 (Gemini), $0.03 to $0.04 (GLM Flash) for 38 batches; consolidation $0.28 to $0.35 (Sonnet 5, 25k to 32k completion tokens), $0.34 (Opus 5, 9.8k), $0.03 (Gemini, 7k), $0.12 to $0.24 (GLM 5.3, 30k to 50k reasoning tokens, about 9 minutes); scoring $1.03 (Haiku, 17.7 stances per call), $2.17 (Gemini, 7.1 per call), $0.15 to $0.30 (GLM Flash, 14 to 16 per call, including split retries). The 130 Haiku scoring calls were billed at list price despite the cache-control marker on the system message, so scoring cost grows with prompt length.

Failures that changed the pipeline: reasoning cannot be disabled on GLM 5.3 Flash (reasoning kept on); GLM extraction and scoring calls truncated at 16k and 32k output tokens (ceilings raised, then split-on-truncation added); responses came back as bare arrays, as per-comment objects, and with the stance map under "axes" (shape tolerance added); a GLM 5.3 consolidation call and later a Sonnet 5 one truncated at 32k (consolidation ceiling raised to 128k for both, since that call is not split); and every failure was a restart until the result cache was added.

Runs 8 and 9 measure the scoring-prompt change on identical axes: only the 130 scoring calls differ. Agreed stances fell from 701 to 664, two-sided axes and pass agreement did not move. The runs differ on 278 comment-axis pairs; 148 of them were judged by two independent readers against the comment's own text. Of the 31 stances the new rules removed from both passes, 20 did not hold, 4 held, 7 were borderline; the dominant misread in both runs is a comment that discusses the axis's subject but answers a different question than the axis asks, which no rule yet addresses. Two code changes went in with run 8: the parent excerpt skips the parent's quoted lines, and extraction ids are validated against the batch (run 8's one warning is such an id).

What the runs show: the GLM pair is the cheapest and most thorough configuration but slow and unpredictable, since GLM 5.3 Flash cannot skip reasoning and its serving speed varied by the hour; the Haiku plus Sonnet 5 pair is the fast, warning-free option at about three times the cost; Opus 5 as consolidator produced finer axes that spread the same stances over more rows; Gemini 3.8 Flash scored a third as many stances as the others at the highest cost, with the most stable ranking. Two GLM runs on the same snapshot shared 12 of their top 20 axes within the top 20 and 17 anywhere in the other list, by a conservative word-overlap match; GLM versus Claude shared 8 and 12.

On the 38-comment thread 3393477, used as a smoke test, all three providers completed: Claude $0.045 in 28 s, Gemini $0.058 in 26 s, GLM $0.022 in 326 s.

## Model comparison on thread 49537553

Run on 2026-09-03 with the run-9 prompts on a 484-comment snapshot, to test models in roles the runs above never gave them. Sonnet 5 and GLM 5.3 as extraction and scoring models were excluded after smoke-thread runs: Sonnet 5 produced fewer stances than Haiku 4.5 at three to four times the cost, and GLM 5.3 took 3 and 18 minutes on 38 comments. The "top 50%" rows are the page's slider at 50. One-arm rows have supporters on one statement only.

| Extract and score / consolidate | Comments | Candidates | Axes | Two-sided | One-arm | Agreed stances (per comment) | Pass agreement | Cost | Wall time (30) |
|---|---|---|---|---|---|---|---|---|---|
| Haiku 4.5 / Sonnet 5 | 484 | 64 | 28 | 19 | 9 | 225 (0.46) | 0.49 | $0.61 | 212 s |
| Opus 5 / Sonnet 5 | 484 | 134 | 85 | 63 | 22 | 354 (0.73) | 0.72 | $4.86 | 607 s |
| Haiku 4.5 / Haiku 4.5 | 484 | 64 | 63 | 25 | 33 | 205 (0.42) | 0.43 | $0.48 | 48 s |
| Haiku 4.5 / GLM 5.3 Flash | 484 | 64 | - | - | - | - | - | - | consolidation call not back after 15 minutes; stopped |
| GPT-5.6 Luna, reasoning low / Sonnet 5 | 484 | 62 | 36 | 29 | 6 | 246 (0.51) | 0.62 | $0.34 | 245 s |
| Haiku 4.5 / GPT-5.6 Sol, reasoning low | 484 | 64 | 42 | 16 | 23 | 206 (0.43) | 0.45 | $0.43 | 54 s |
| Haiku 4.5 / GPT-5.6 Luna, reasoning max | 484 | 64 | 36 | 20 | 13 | 236 (0.49) | 0.48 | $0.48 | 718 s |
| Haiku 4.5 / Sonnet 5, top 50% | 242 | 29 | 16 | 11 | 5 | 83 (0.34) | 0.54 | $0.29 | 126 s |
| Opus 5 / Sonnet 5, top 50% | 242 | 65 | 41 | 36 | 5 | 173 (0.71) | 0.81 | $2.75 | 316 s |
| Haiku 4.5 / Haiku 4.5, top 50% | 242 | 29 | 28 | 12 | 11 | 83 (0.34) | 0.50 | $0.18 | 24 s |
| Haiku 4.5 / GLM 5.3 Flash, top 50% | 242 | 29 | 23 | 10 | 12 | 96 (0.40) | 0.64 | $0.16 | 61 s |

Opus 5 as the extraction and scoring model produced 3.3 times the two-sided rows and 1.6 times the agreed stances of Haiku 4.5, with higher pass agreement, at 8 times the cost and 3 times the wall time. The extra stances are real: of the top-50% runs' agreed stances, all 83 of Haiku's and 90 of Opus's 173 were judged blind by two independent readers, and Opus had 66 holding, 1 not holding, 23 borderline, against Haiku's 49, 10, 24. Haiku 4.5 as consolidator barely merges (64 candidates became 63 axes, 33 of them one-arm), so its lower cost buys a worse table; GLM 5.3 Flash as consolidator gave fewer two-sided rows than Sonnet 5 on the same candidates and did not finish at 100%. The top half of the comments carried about half the stances and 57% of the two-sided rows for about half the cost under both scoring models, so disagreement is not concentrated in the top comments. GPT-5.6 Luna at reasoning low as the extraction and scoring model beat Haiku 4.5 on every quality number (29 two-sided rows against 19, 0.51 stances per comment against 0.46, pass agreement 0.62 against 0.49) at $0.11 for the two stages against $0.37; of 90 of its agreed stances judged blind, 72 held, 5 did not, and 13 were borderline, against Haiku's 59%, 12% and 29%. GPT-5.6 Sol at reasoning low as consolidator cost $0.03 and 38 s for the call but merged less than Sonnet 5: 16 two-sided rows of 42 with 23 one-arm. GPT-5.6 Luna at reasoning max as consolidator matched Sonnet 5 (20 two-sided rows of 36, 236 stances) at $0.08 against $0.24, but its call took 703 s and 67k completion tokens against Sonnet's 195 s and 23k.

Per-stage figures: Luna extraction and scoring cost $0.0033 per 1000 comment tokens at 1.2 seconds per 1000, Sol consolidation $0.0010 at 1.2 seconds, Luna at reasoning max $0.0025 at 21.6 seconds; Opus 5 extraction and scoring cost $0.132 per 1000 comment tokens against Haiku's $0.011 (which matches the $0.0119 measured on the test thread, the check on the method) and ran at 3.2 seconds per 1000 comment tokens at concurrency 30 against Haiku's 0.5. Sonnet 5 consolidation took 497 s and 54.7k completion tokens on Opus's 134 candidates against 195 s and 22.8k on Haiku's 64, so its cost grows with candidate volume, which the page's forecast does not model. Projected to the 1297-comment thread: about $13.60 for the Opus stages plus about $1.50 for consolidation, around $15 and 30 minutes per run; the Opus option is labeled with the per-1000-comment figures, $10.50 and 4 minutes.

## Pareto frontier

Three objectives: quality, cost per run, and wall time. Quality is two-sided axes, which is what the table exists to show, with agreed stances per comment as the tie-break. One representative run per configuration on the statement-pair design; where two GLM runs exist, both values are given.

| Configuration | Two-sided axes | Agreed stances per comment | Cost | Wall time | On the frontier |
|---|---|---|---|---|---|
| GLM 5.3 Flash + GLM 5.3 | 53 and 46 | 0.59 and 0.51 | $0.40 to $0.45 | 22 to 51 min | yes: lowest cost, most thorough of the cheap options |
| Haiku 4.5 + Sonnet 5 | 43 | 0.54 | $1.36 | 274 s at concurrency 10, about 140 s at 30 | yes: fastest without losing quality |
| Opus 5 + Sonnet 5 (projected from thread 49537553) | about 3 times Haiku + Sonnet 5's | about 0.73 | about $15 | about 30 min | yes: best quality by a wide margin, at the highest cost |
| GPT-5.6 Luna low + Sonnet 5 (projected from thread 49537553) | about 1.5 times Haiku + Sonnet 5's | about 0.51 | about $0.80 | about 8 min | yes: better and cheaper than Haiku + Sonnet 5, slower |
| Haiku 4.5 + Opus 5 | 35 | 0.52 | $1.57 | 139 s | no: dominated by Haiku + Sonnet 5 on quality and cost at equal speed |
| Gemini 3.8 Flash alone | 42 | 0.30 | $2.61 | 221 s at concurrency 10 | no: dominated by Haiku + Sonnet 5 on quality and cost, and not faster at equal concurrency |

The frontier has four points, one of them measured only on thread 49537553: the GLM pair at the cheap end, with wall time that ranged over a factor of two between runs; the Haiku plus Sonnet 5 pair at the fast end, three times the cost and a tenth of the time, with no warnings; and Opus 5 with Sonnet 5 at the quality end, ten times the cost of the Haiku pair and three times its time. Wall times were measured at different concurrencies; the frontier assumes concurrency 30 for all, which the Claude runs supported without rate-limit retries. Gemini rejoins the frontier under a different quality measure: its ± of 0.10 on the top 20 was the most stable ranking, so it is the choice only if run-to-run stability of the order outweighs coverage.

Untested: GLM 5.3 Flash for extraction and scoring with Sonnet 5 for consolidation, projected from per-stage costs at about $0.55 and 13 minutes.
