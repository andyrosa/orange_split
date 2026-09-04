# HN Split

For every claim made in a Hacker News thread, how many commenters are for it and how many against.

## Goal

Given a Hacker News comment thread id, produce the bipolar axes along which commenters disagree, with no human in the loop.

## Input

- Thread id.
- OpenRouter key, pasted on the page or obtained by signing in with OpenRouter. An OAuth key is remembered in the browser automatically; a pasted key is held in memory and gone on reload unless "Remember pasted key" is ticked.
- Test thread: https://news.ycombinator.com/item?id=49525378 (Claude Fable 5.1 and Claude Mythos 5.1, about 1300 comments). Thread 49537553 (Gemini 3.8 Flash release, 484-comment snapshot) served the model comparisons.

## Definition of an axis

An axis is a pair of incompatible statements about the same specific thing, such that one commenter could hold the first and another the second: "the safeguard fallback fires on ordinary coding work", "Codex subscription quota lasts longer than Claude's", "text watermarking degrades output quality". An overall verdict counts when phrased as a statement ("the release is a worthwhile upgrade" versus "the release is not a meaningful upgrade"). Not axes: topics ("pricing"), mood without a claim ("I'm disappointed"), traits of the commenter ("uses the API rather than a subscription"). The tool judges opinions, not people: commenter names never appear in the output or in any prompt.

## Output

Each disagreement pairs the better-supported view, in larger blue type, with the opposing view in smaller orange type. Vote totals flank a bar showing the split, including middle positions.

## Constraints

- No human review.
- Models are called through OpenRouter. Defaults: GPT-5.6 Luna at reasoning low for the high-volume stages and Claude Sonnet 5 for consolidation, the pair with the best measured quality per dollar.
- A run stops when its spend exceeds the Max cost box, default 1 dollar.
- Two runs on the same stored copy of a thread should produce similar top-20 lists.

## Files

- `hn_polarization.html`: the deliverable, one self-contained page. `<script id="core">` holds the pipeline with no DOM access; `<script id="page">` holds the browser glue.
- `scripts/load_core.js`: evaluates the core block as a Node module for the runner and the tests, so there is no build step and no second copy of the pipeline.
- `scripts/run_node.js`: headless runner with options for models, caching, thread files, comment share, and budget.
- `scripts/csp.js`: recomputes the Content-Security-Policy hashes of the page's two script blocks and its style block; `node scripts/csp.js` reports whether the policy is current, `--write` rewrites it. Run it after editing any of the three blocks; a browser refuses an inline block whose hash the policy does not name.
- `tests/core.test.js`: unit and integration tests for the core block. `tests/csp.test.js` checks that the policy is current and that the page has LF line endings, which the hashes depend on. `.gitattributes` pins every text file to LF in the index and the working tree, whatever `core.autocrlf` says. Run all with `node --test`.

## User interface

Open `hn_polarization.html` in a browser. The tab title names HN Split and changes to the loaded article title. Every button sits right after the thing it acts on and appears only when it can do something.

1. Pick the thread in the Thread box: an id, or search words. A list opens under the box on focus, click, or typing: a header row, then one row per story as "title (comment count, posting date, id)", newest first. Under three characters the list is the current home page (Algolia HN API) filtered by them; from three on it is Algolia story search ("Searching sorted by date", then "Matches sorted by date" or "No matches"). The Min comments box to the left hides stories with fewer comments from both lists; default 100, empty hides nothing. Arrow keys move the highlight, Enter or a click picks, Escape or leaving the box closes. Rows whose run is fully cached at the current share and models are bold. A picked row or a typed id ("Load thread", Enter, or leaving the box) loads the thread; the box empties, the title follows it, and the line below reads, for example, "32 comments, posted 2026-09-02, id 49543530, fetched 9/2/2026, 9:24:51 PM".
2. Choose the models: one select for extraction and scoring (Claude Haiku 4.5, GLM 5.3 Flash, Gemini 3.8 Flash, Claude Opus 5, GPT-5.6 Luna at reasoning low) and one for consolidation (Claude Sonnet 5, GLM 5.3, Gemini 3.8 Flash, Claude Opus 5, GPT-5.6 Sol at reasoning low, GPT-5.6 Luna at reasoning max, Claude Fable 5.1 at reasoning low). Every label is built at load from its entry: the per-character constants the forecast uses, converted to cost and time per 1000 comments at 317.6 characters per comment, framing included (the test thread's average), then the entry's measured quality record: stances per comment, two-sided rows per 100 comments, and the share of stances that held under blind review for extraction and scoring; the share of axes two-sided for consolidation.
3. Set the Max cost box, default $1. It is the budget the run stops at; whenever it, a model, or the thread changes, the page sets the slider to the largest share of top comments whose forecast fits (well under 100% for Opus 5 on a large thread). The slider can then be moved by hand. It keeps the first N% of comments in thread order, Hacker News's own ranking, depth-first, so every reply in the share has its parent in it and the same percentage always gives the same comments. The text beside it shows the comments that leaves, their text size in characters, and, as "Next run:", the forecast cost and time: per-character rates and stage times from the measured runs, the consolidation share scaled by the candidate volume the chosen extraction model produces relative to Haiku 4.5, and a floor because the three stages run in sequence. The page also counts the run's model calls already in the cache, by building every request and looking it up; the count stops at the first stage with a miss. With some calls cached a sentence lists them per stage; with all cached the line reads "Next run: $0 and 0 seconds" and a just-loaded thread runs by itself, with or without a key.
4. Provide a key if none is held, then press Run (enabled once a thread is loaded, the share is above 0, and a key is held or typed). Either paste a key, or press "Sign in with OpenRouter instead": a PKCE code challenge to openrouter.ai, exchanged on return for a key bound to that account, with no secret and no server; the button appears only when the page is served over http(s) from a stable URL, since OpenRouter needs a callback URL and the browser a secure context. OAuth keys are remembered in the browser automatically. A pasted key stays only until reload unless "Remember pasted key" is ticked. The key is never displayed again. While one is held the entry field disappears and "OpenRouter key", "held until reload" or "remembered in this browser", and a Delete button appear on the storage line. Run adds the article, snapshot capture time, comment share, both model choices, and budget to the page URL. The snapshot time is the nonce tying that URL to the cached result; reopening the URL restores its controls and completed result. During a run the status line shows the stage, units done, calls in flight, call count, cached calls, running cost, and elapsed time. The completion line shows actual time and cost followed by their pre-run estimates in parentheses. A classification is one comment placed on one row. Cancel aborts the in-flight requests.

Storage is the browser's localStorage, which belongs to the origin (scheme, host, port), not the file name. Besides the remembered key, three caches are kept, counted on a line under the buttons: fetched thread snapshots keyed by article id; finished model calls keyed by request content, so failed runs resume where they stopped; and completed results keyed by all run URL parameters, so reopening a result URL restores it directly. Export downloads those three caches as JSON without the OpenRouter key. Import merges such a file into the browser, replacing entries with the same cache key while leaving the OpenRouter key untouched. Delete removes all three caches and never the key.

## HN post

Key handling: the page is one HTML file with no dependencies and no third-party script. The OpenRouter key is sent only to openrouter.ai; view-source shows every fetch, and a Content-Security-Policy on the page limits connections to openrouter.ai and hn.algolia.com. OAuth keys are kept in localStorage automatically. Pasted keys are held in memory and gone on reload unless Remember pasted key is ticked. Use the Delete button to remove either kind. Create the key with a credit limit, or use Sign in with OpenRouter and set a limit on the resulting key in the dashboard, where it can also be revoked.

## Pipeline

1. Extract. Comments are batched in thread order at about 12,000 characters, keeping top-level subtrees together when they fit. For each batch the model lists candidate axes: two incompatible statements plus the ids of comments in the batch holding each; ids from outside the batch are dropped with a warning.
2. Consolidate. One call merges all candidates into canonical axes: two candidates are the same disagreement when a commenter on side 1 of one would almost certainly be on side 1 of the other, merged into one axis worded after the largest; candidates stay apart only when commenters could plausibly split differently. No target count. This call is not split on truncation; its output ceiling is 128k tokens for every consolidator but Gemini 3.8 Flash, whose ceiling is 65,536.
3. Score. Every comment, with an excerpt of its parent (the parent's own words, skipping quoted lines), is classified against every axis in batches of 20: statement 1, statement 2, middle, or not addressed. Two passes, the second with the axes shuffled and the statements swapped; only stances both passes agree on count. The completion report separates true conflicts (both passes classify the pair differently) from single-pass classifications (one pass classifies it and the other omits it). Five leave-out rules: the parent excerpt only resolves what the comment refers to and its position is never the comment's; words that only agree or disagree with the parent carry no position; a line starting with > is not the commenter's claim; a position attributed to someone else is not the commenter's; holding one statement while granting a point to the other is that side, not middle. Extraction applies the second and third of these as well.
4. Compute. Stances are aggregated per commenter (majority of that commenter's comments on the axis, ties count as middle), and the side with more commenters becomes statement 1.

Provider misbehavior is tolerated and recorded in the warnings list: an extraction or scoring response truncated at the ceiling or of unknown shape splits the batch in half and retries down to one comment; a response with the right content in a nonstandard wrapper (a bare array, or per-comment objects holding an axis-to-stance map) is accepted.

## Result blocks

Per axis: statement 1 is blue at 18px and statement 2 is orange at 14px. These sizes are fixed for every axis. Between them is a fixed-width proportion bar, blue for statement 1, grey for middle, and orange for statement 2, showing the commenter split within the axis rather than its total size. The side counts flank the bar. Click the comment count to expand the agreed comments, grouped as Blue, Middle, and Orange; each includes its author, text, and Hacker News permalink. The runner prints the counts in words.

## Configuration

`DEFAULT_CONFIG` in the core block holds the model, sampling (temperature, seed), reasoning, and output ceiling per stage, batch sizes, concurrency, and the budget; the selects, the Max cost box, and the runner's flags override it per run. Sampling and reasoning are per stage because providers differ: Claude Haiku 4.5 takes temperature but not seed; Claude Sonnet 5 and Opus 5 take neither and think adaptively; Claude Fable 5.1 takes a reasoning effort only; GLM 5.3 Flash cannot run without reasoning and needs large ceilings; Gemini 3.8 Flash takes temperature and seed; the GPT-5.6 models take seed and a reasoning effort but not temperature.

## Headless runner

```
node scripts/run_node.js --thread=49525378 [--key=sk-or-...] [--out=result.json] [--concurrency=30] [--cache-dir=path] [--thread-file=path] [--config-file=path] [--volume=<key>] [--consolidation=<key>] [--model=id] [--temperature=0] [--seed=12345] [--share=<percent>] [--budget=<usd>]
```

The key comes from `--key` or `OPENROUTER_API_KEY`. `--cache-dir` stores each finished call as a file and reuses it. `--thread-file` reads the thread from that file when it exists, else fetches and saves it, which keeps reruns comparable. `--config-file` is a JSON object of `DEFAULT_CONFIG` overrides; `--volume` and `--consolidation` pick option entries by key, each setting only its own role's stages; `--model`, `--temperature`, and `--seed` apply to every stage; `--share` keeps the top N percent of comments; `--budget` sets the stop.

## Controlled model comparison on thread 49537553

These measurements use the current prompts on one 484-comment snapshot, at concurrency 30, to compare models under the same conditions. Sonnet 5 and GLM 5.3 are not offered as extraction and scoring models because they produced fewer stances than Haiku 4.5 at three to four times the cost, taking 3 and 18 minutes on 38 comments. "Top 50%" is the slider at 50. One-arm rows have supporters on one statement only.

The `Pareto role` column evaluates full-thread and top-50% runs separately on three objectives: maximize two-sided axes (using agreed stances per comment as a quality tie-break), minimize cost, and minimize wall time. Top-50% roles are marked `reduced coverage` because those runs omit half the thread. `Dominated` means another run at the same share is at least as good on all three objectives and better on at least one.

| Extract and score / consolidate             | Comments | Candidates | Axes | Two-sided | One-arm | Agreed stances (per comment) | Pass agreement | Cost  | Wall time | Pareto role                    |
| ------------------------------------------- | -------- | ---------- | ---- | --------- | ------- | ---------------------------- | -------------- | ----- | --------- | ------------------------------ |
| GPT-5.6 Luna, reasoning low / Sonnet 5      | 484      | 62         | 36   | 29        | 6       | 246 (0.51)                   | 0.62           | $0.34 | 245 s     | lowest cost                    |
| Haiku 4.5 / Claude Fable 5.1, reasoning low | 484      | 64         | 29   | 17        | 11      | 186 (0.38)                   | 0.45           | $0.61 | 64 s      | dominated                      |
| Haiku 4.5 / GLM 5.3 Flash                   | 484      | 64         | 42   | 22        | 19      | 238 (0.49)                   | 0.50           | $0.43 | 1017 s    | dominated                      |
| Haiku 4.5 / GLM 5.3 Flash, top 50%          | 242      | 29         | 23   | 10        | 12      | 96 (0.40)                    | 0.64           | $0.16 | 61 s      | lowest cost, reduced coverage  |
| Haiku 4.5 / GPT-5.6 Luna, reasoning max     | 484      | 64         | 36   | 20        | 13      | 236 (0.49)                   | 0.48           | $0.48 | 718 s     | dominated                      |
| Haiku 4.5 / GPT-5.6 Sol, reasoning low      | 484      | 64         | 42   | 16        | 23      | 206 (0.43)                   | 0.45           | $0.43 | 54 s      | fast at low cost               |
| Haiku 4.5 / Haiku 4.5                       | 484      | 64         | 63   | 25        | 33      | 205 (0.42)                   | 0.43           | $0.48 | 48 s      | fastest                        |
| Haiku 4.5 / Haiku 4.5, top 50%              | 242      | 29         | 28   | 12        | 11      | 83 (0.34)                    | 0.50           | $0.18 | 24 s      | fastest, reduced coverage      |
| Haiku 4.5 / Sonnet 5                        | 484      | 64         | 28   | 19        | 9       | 225 (0.46)                   | 0.49           | $0.61 | 212 s     | dominated                      |
| Haiku 4.5 / Sonnet 5, top 50%               | 242      | 29         | 16   | 11        | 5       | 83 (0.34)                    | 0.54           | $0.29 | 126 s     | dominated, reduced coverage    |
| Opus 5 / Sonnet 5                           | 484      | 134        | 85   | 63        | 22      | 354 (0.73)                   | 0.72           | $4.86 | 607 s     | highest quality                |
| Opus 5 / Sonnet 5, top 50%                  | 242      | 65         | 41   | 36        | 5       | 173 (0.71)                   | 0.81           | $2.75 | 316 s     | highest quality, reduced coverage |
