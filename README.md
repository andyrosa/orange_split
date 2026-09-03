# HN For and Against

For every claim made in a Hacker News thread, how many commenters are for it and how many against.

## Goal

Build a tool that, given a Hacker News comment thread id, produces a ranked list of the bipolar axes along which commenters disagree, with no human in the loop.

## Input

- Thread id.
- OpenRouter key, entered on the page and stored in the browser's localStorage.
- Test thread: https://news.ycombinator.com/item?id=49525378 (Claude Fable 5.1 and Claude Mythos 5.1, about 1300 comments).

## Definition of an axis

An axis is a pair of incompatible statements about the same specific thing, such that one commenter could hold the first and another the second. Examples of statements that anchor an axis: "the safeguard fallback fires on ordinary coding work", "Codex subscription quota lasts longer than Claude's", "text watermarking degrades output quality". An overall verdict on the subject counts when phrased as a statement ("the release is a worthwhile upgrade" versus "the release is not a meaningful upgrade"). What does not count: topics ("pricing"), mood statements without a claim about the subject ("I'm disappointed"), and traits of the commenter ("uses the API rather than a subscription"). The tool judges opinions, not people: commenter names never appear in the output or in any prompt.

## Output

A table with one row per axis, many rows (target 30 or more), sorted so the most polarizing axes are at the top. "Polarizing" means commenters land on both statements with little middle. Each row also carries a consensus score, so that near-unanimous axes with enough signal can be surfaced by re-sorting, plus coverage, the split between the two statements, and an error bar from the two scoring passes. Axes on which nearly everyone agrees sort low under polarization even if many comments touch them.

## Constraints

- No human labels, no human review at any step.
- Models are called through OpenRouter. The page defaults to Claude Haiku 4.5 for the high-volume stages and Claude Sonnet 5 for consolidation; GLM and Gemini configurations were measured and are listed below.
- A run stops when its spend exceeds 5 dollars.
- Two runs on the same thread snapshot should produce similar top-20 lists.

## Deliverable

A single runnable HTML page with minimal formatting and no export. The thread box takes an id or search words, with suggestions from the current front page and from Algolia story search; two selects choose the model for the high-volume stages (extraction and scoring) and the model for consolidation, each labeled with its measured cost and time normalized per 1000 comments, defaulting to Claude Haiku 4.5 and Claude Sonnet 5; the thread is loaded first so a 0 to 100% slider can show how many comments will be analyzed and roughly what it will cost and how long it will take before anything is spent. Buttons to wipe the OpenRouter key, delete the cached data, and refresh a stored thread snapshot appear only when there is something to act on.

## Files

- `hn_polarization.html`: the deliverable, a single self-contained page. The `<script id="core">` block holds the pipeline with no DOM access; the `<script id="page">` block holds the browser glue.
- `scripts/load_core.js`: extracts the core script block from the page and evaluates it as a Node module; the runner and the tests both use it, so there is no build step and no second copy of the pipeline.
- `scripts/run_node.js`: headless runner that executes the same core block from Node, with options for models, caching, and thread snapshots.
- `tests/core.test.js`: unit and integration tests for the core block, run with `node --test tests/core.test.js`.

## Using the page

Open `hn_polarization.html` in a browser. The steps:

1. Pick the thread in the Thread box. Its suggestions read "title (posting date, id)", newest first: the current home page (from the Algolia HN API) and, once three or more characters are typed, Algolia story search results for that text. A caption after the box says what the suggestions hold: "Home page" at rest, "Searching sorted by date" while a search is in flight, then "Matches sorted by date" or "No matches". Picking a title loads that thread; a typed numeric id loads with "Load thread", Enter, or on leaving the box. Once loaded, the box shows the thread's title and the line below shows its comment count and the time of the snapshot it will use. "Load thread" disappears while the box denotes the loaded thread and returns when it changes.
2. Move the "Comments to analyze" slider. It keeps a random N% of the comments, drawn with a fixed seed so the same thread and percentage always give the same sample (reruns hit the cache and runs stay comparable), kept in thread order. Sampled replies still get their parent's text as context even when the parent was not sampled; only sampled comments are extracted and scored. The text beside the slider shows how many comments that leaves, and the estimate line shows the approximate cost and time for the selected models, computed from per-token rates and stage times fitted to the measured runs.
3. Choose the models: one select for extraction and scoring (Claude Haiku 4.5, GLM 5.3 Flash, Gemini 3.8 Flash) and one for consolidation (Claude Sonnet 5, GLM 5.3, Gemini 3.8 Flash, Claude Opus 5). Each option is labeled with its measured cost and time normalized per 1000 comments. Defaults are Haiku 4.5 and Sonnet 5.
4. Provide an OpenRouter key if none is stored, then press Run, which is enabled only once a thread is loaded, the share is above 0, and a key is stored or typed. Either type a key, or press "Sign in with OpenRouter instead": that sends the browser to openrouter.ai with a PKCE code challenge, and on return the page exchanges the code for a key bound to that account, with no secret and no server. The sign-in button appears only when the page is served over http(s) from a stable URL (localhost or a static host both work), because OpenRouter needs a callback URL and the browser needs a secure context for SHA-256; a page opened from a file falls back to typing the key. Either way the key is stored in the browser and never displayed again; while one is stored the entry field disappears and a line under the storage line says the key is stored, with its own Delete button. A key obtained by sign-in can also be revoked from the OpenRouter dashboard. Progress shows the stage, the call count, how many calls came from cache, the running cost, and the elapsed time. Cancel aborts the in-flight requests.

Everything the page stores lives in the browser's localStorage, never in files. Besides the key, two kinds of cached data are kept, and a line under the buttons shows how much: the number and approximate size of cached model calls and of thread snapshots. A Delete button after that line appears whenever either exists and removes both; it never touches the key, which only the Delete button on the key line removes.

- A snapshot of each fetched thread, keyed by thread id, so that reruns score the same comments. A live thread gains comments over time, which changes every prompt and defeats the result cache. "Refresh thread" appears when the entered id has a snapshot and replaces it with a fresh fetch.
- The result of every finished model call, keyed by the request content, so that a rerun of the same thread with the same settings costs nothing and a failed run resumes where it stopped.

Every button sits right after the thing it acts on and appears only when it can do something: "Load thread" after the Thread box while the box does not denote the loaded thread, "Refresh thread" after the snapshot timestamp while that thread has a snapshot, "Run" after the key field while idle and "Cancel" in its place while a run is in progress, Delete after the storage line while cached data exists, and Delete after the key line while a key is stored.

## Pipeline

1. Extract. Comments are grouped in thread order into batches of about 3000 tokens, keeping top-level subtrees together when they fit. For each batch the model lists candidate axes: two incompatible statements plus the ids of comments holding each.
2. Consolidate. One call merges all candidates into 40 to 60 canonical axes, each a pair of full-sentence rival statements, applying the definition above.
3. Score. Every comment, with a snippet of its parent for context, is classified against every axis in batches of 20: statement 1, statement 2, middle, or not addressed. This runs twice; the second pass shuffles the axis order and swaps the two statements. Only stances on which both passes agree are counted.
4. Compute. Stances are aggregated per commenter (majority of that commenter's comments on the axis, ties count as middle), then the metrics below are computed and the table is sorted by polarization.

## Table columns

- Statement 1 and Statement 2: the two rival statements.
- Split: the count of commenters on each statement with a 20-cell bar, `<` per share on statement 1, `-` for middle, `>` for statement 2.
- Mid: commenters who addressed the axis but took a middle or mixed position.
- Authors: statement 1 plus statement 2 plus Mid.
- Comments: agreed stances on the axis, counting comments rather than commenters.
- Polarization: `2 * min(side1, side2) / Authors * ln(1 + Authors)`. It is 0 when one side is empty and highest for an even split with no middle and many commenters. The `±` is half the gap between the scores computed from each scoring pass alone, so a wide `±` means the two passes disagreed about that axis.
- Consensus: `|side1 - side2| / Authors * ln(1 + Authors)`, forced to 0 under 5 commenters. It surfaces near-unanimous axes with enough signal. Same `±` treatment.
Clicking a header sorts by that column; the Split header sorts by balance. Rank is the polarization order and is not sortable.

## Configuration

All settings live in `DEFAULT_CONFIG` in the core block: the model for each stage, per-stage sampling (temperature, seed) and reasoning settings, per-stage output ceilings, batch sizes, concurrency, the axis count range, and the budget. Sampling and reasoning are per stage because providers differ: Claude Haiku 4.5 accepts temperature but not seed, Claude Sonnet 5 accepts neither and thinks adaptively, GLM 5.3 Flash cannot run without reasoning and needs large output ceilings, Gemini 3.8 Flash accepts temperature and seed.

The pipeline tolerates two classes of provider misbehavior, each recorded in the warnings list rather than hidden: a response truncated at the output ceiling or returned in an unrecognized shape causes the batch to be split in half and retried down to a single comment; a response with the right content in a nonstandard wrapper (a bare array, or per-comment objects holding an axis-to-stance map) is accepted as is.

## Headless runner

```
node scripts/run_node.js --thread=49525378 [--key=sk-or-...] [--out=result.json] [--concurrency=30] [--cache-dir=path] [--thread-file=path] [--config-file=path] [--model=id] [--temperature=0] [--seed=12345]
```

The key comes from `--key` or the `OPENROUTER_API_KEY` environment variable. `--cache-dir` stores each finished call as a file and reuses it on later runs. `--thread-file` reads the thread from that file when it exists and otherwise fetches and saves it, which is what keeps reruns comparable. `--config-file` points at a JSON object of `DEFAULT_CONFIG` overrides, for example a two-model GLM configuration; `--model`, `--temperature`, and `--seed` apply one model or one sampling setting to every stage.

## Measured runs

All completed full runs on the test thread on 2026-09-02, in the order they were made. The thread grew from 1294 to 1297 comments during the day; runs 6 and later used a saved snapshot. Columns: two-sided axes are rows where both statements have supporters; agreed stances are comment-axis pairs both scoring passes agreed on; pass agreement is agreed stances divided by all stances either pass produced; `±` is the mean polarization spread of the top 20 rows (not computed before run 3). Wall time is quoted with the concurrency used.

| # | Extract / consolidate / score | Design | Axes | Two-sided | Agreed stances (per comment) | Pass agreement | ± top 20 | Warnings | Cost | Wall time |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Haiku 4.5 / Sonnet 5 / Haiku 4.5 | proposition plus pole labels | 50 | 34 | 654 (0.51) | 0.46 | - | 0 | $1.26 | 172 s (10) |
| 2 | Haiku 4.5 / Sonnet 5 / Haiku 4.5 | statement pairs | 53 | 40 | 650 (0.50) | 0.39 | - | 0 | $1.58 | 330 s (10) |
| 3 | Haiku 4.5 / Sonnet 5 / Haiku 4.5 | statement pairs, 36 calls from cache | 58 | 43 | 696 (0.54) | 0.42 | 0.24 | 0 | $1.36 | 274 s (10) |
| 4 | Haiku 4.5 / Opus 5 / Haiku 4.5 | statement pairs, run in a separate session | 60 | 35 | 671 (0.52) | - | 0.25 | 0 | $1.57 | 139 s (30) |
| 5 | Gemini 3.8 Flash for all three | statement pairs | 45 | 42 | 386 (0.30) | 0.71 | 0.10 | 1 | $2.61 | 221 s (10) |
| 6 | GLM 5.3 Flash / GLM 5.3 / GLM 5.3 Flash | statement pairs, first success after four failed attempts | 60 | 53 | 767 (0.59) | 0.59 | 0.15 | 28 | about $0.45 clean, $0.64 including the failed attempts | about 22 min (30) |
| 7 | GLM 5.3 Flash / GLM 5.3 / GLM 5.3 Flash | statement pairs, fresh run into an empty cache | 58 | 46 | 666 (0.51) | 0.53 | 0.19 | 8 | $0.40 | 51 min (30) |

Per-stage costs from the call records, for the three providers on the same design: extraction cost $0.21 (Haiku), $0.37 (Gemini), $0.03 to $0.04 (GLM Flash) for 38 batches; consolidation cost $0.28 to $0.35 (Sonnet 5, 25k to 32k thinking tokens), $0.34 (Opus 5, 9.8k), $0.03 (Gemini, 7k), $0.12 to $0.24 (GLM 5.3, 30k to 50k reasoning tokens, about 9 minutes); scoring cost $1.03 (Haiku, 17.7 stances per call), $2.17 (Gemini, 7.1 per call), $0.15 to $0.30 (GLM Flash, 14 to 16 per call, including split retries).

Failed GLM attempts, each of which led to a pipeline change: reasoning cannot be disabled on GLM 5.3 Flash (reasoning kept on); extraction and scoring calls truncated at 16k and 32k output tokens (ceilings raised, then split-on-truncation added); responses returned as bare arrays, as per-comment objects, and with the stance map under "axes" (shape tolerance added); one consolidation call truncated at 32k (ceiling raised to 128k for GLM); and every failure was a restart until the result cache was added.

What the runs show: the GLM pair is the cheapest and most thorough configuration but its wall time is slow and unpredictable, since GLM 5.3 Flash cannot skip reasoning and its serving speed varied by the hour; the Haiku plus Sonnet 5 pair is the fast, warning-free option at about three times the cost; Opus 5 as consolidator produced finer axes that spread the same stances over more rows at the same price as Sonnet 5; Gemini 3.8 Flash scored a third as many stances as the others at the highest cost, though with the most stable scores. Two GLM runs on the same snapshot shared 12 of their top 20 axes within the top 20 and 17 anywhere in the other list, by a conservative word-overlap match; GLM versus Claude shared 8 and 12 by the same measure.

On the 38-comment thread 3393477, used as a smoke test, all three providers completed: Claude $0.045 in 28 s, Gemini $0.058 in 26 s, GLM $0.022 in 326 s.

## Pareto frontier

Three objectives: quality, cost per run, and wall time. Quality is measured as two-sided axes (rows where both statements have supporters), which is what the table exists to show, with agreed stances per comment as the tie-break. One representative run per configuration on the statement-pair design; where two GLM runs exist, both values are given.

| Configuration | Two-sided axes | Agreed stances per comment | Cost | Wall time | On the frontier |
|---|---|---|---|---|---|
| GLM 5.3 Flash + GLM 5.3 | 53 and 46 | 0.59 and 0.51 | $0.40 to $0.45 | 22 to 51 min | yes: best quality, lowest cost |
| Haiku 4.5 + Sonnet 5 | 43 | 0.54 | $1.36 | 274 s at concurrency 10, about 140 s at 30 | yes: fastest without losing quality |
| Haiku 4.5 + Opus 5 | 35 | 0.52 | $1.57 | 139 s | no: dominated by Haiku + Sonnet 5 on quality and cost at equal speed |
| Gemini 3.8 Flash alone | 42 | 0.30 | $2.61 | 221 s at concurrency 10 | no: dominated by Haiku + Sonnet 5 on quality and cost, and not faster at equal concurrency |

The frontier has two points. The GLM pair sits at the cheap and thorough end, with the largest contested-axis set and the highest confirmed coverage at about a third of Claude's cost, but with wall time that ranged over a factor of two between runs because GLM 5.3 Flash cannot skip reasoning and its serving speed varied by the hour. The Haiku plus Sonnet 5 pair sits at the fast end, three times the cost and a tenth of the time, with no warnings. Between them there is a 3x cost gap and a 10x time gap.

Two caveats. Wall times were measured at different concurrencies; the frontier assumes concurrency 30 for all, which the Claude runs supported without rate-limit retries. And Gemini rejoins the frontier under a different quality measure: its ± of 0.10 on the top 20 is the most stable ranking of the four, at the highest price, so it is the choice only if run-to-run stability of the order outweighs coverage.

Untested: GLM 5.3 Flash for extraction and scoring with Sonnet 5 for consolidation, projected at about $0.55 and 13 minutes, which would replace GLM 5.3's slow consolidation call with Sonnet's fast, schema-clean one. It is a projection from the per-stage costs, not a measurement.
