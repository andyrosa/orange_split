// Measures how well one model does when one request replaces the extraction, consolidation, and scoring
// stages of the page pipeline. The request holds the whole thread and returns the axes and, for each comment,
// its stance on each axis it addresses. The summary stage is not part of the request. Each run is graded
// against the silver reference (data/silver.json, built by scripts/silver.js) as scripts/silver_lib.js grades a
// whole run, and the runs are written to data/single-call-benchmark.json.
// Usage: node scripts/single_call.js --choice=<key>[,<key>...]   choices of SINGLE_CALL_CHOICES
//        node scripts/single_call.js --all                       every choice
//        [--repeats=<n>] n more runs of each choice, each with its own call cache  [--budget=<usd>] [--key=sk-or-...]
// Run 1 replays the shared call cache, so measuring a choice again costs only its repeats.
// Each run measures two variants:
//   oneCall   the request alone: every stance it returns counts.
//   twoCalls  the request plus one scoring call, which is the pipeline's second scoring pass (axes shuffled,
//             statements swapped) over the whole thread in one request. Only the stances both calls give
//             count, as the pipeline counts only the stances both of its scoring passes give.
// Both variants run through the page pipeline (runPipeline) with the request's output as the fixed response of
// extraction, consolidation, and the first scoring pass, so the rows are the rows the page would show. The
// pipeline's floor applies: an axis on whose two statements the request put fewer than MIN_AXIS_PEOPLE people
// is dropped.
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./silver_lib');

const { core, MODEL } = lib;
const RESULT_FILE = path.join(lib.REPO_ROOT, 'data', 'single-call-benchmark.json');
const DEFAULT_BUDGET_USD = 10;
const SINGLE_CALL_STAGE = 'singleCall';
const FAILURE_MESSAGE_CHARS = 300;
// One extraction batch holds the whole thread, so the request's axes are the candidates of one batch.
const WHOLE_THREAD_BATCH_CHARS = Number.MAX_SAFE_INTEGER;

// The single-call choices: models of the page's consolidation choices, each at a reasoning effort set here.
// The page lists Claude Opus 5.5 with adaptive reasoning only and GPT-6.1 Sol at low only.
const LOW_EFFORT = 'low';
const HIGH_EFFORT = 'high';
function effortChoice(consolidationKey, effort) {
    const choice = core.CONSOLIDATION_MODELS[consolidationKey];
    return Object.freeze({ name: choice.name, effort, model: choice.config.modelConsolidate, sampling: choice.config.samplingConsolidate,
        reasoning: Object.freeze({ effort }), maxTokens: choice.config.maxTokensConsolidate });
}
const SINGLE_CALL_CHOICES = Object.freeze({
    opus55Low: effortChoice('opus55', LOW_EFFORT),
    sol61Low: effortChoice('sol61Low', LOW_EFFORT),
    fableLow: effortChoice('fableLow', LOW_EFFORT),
    sol61High: effortChoice('sol61Low', HIGH_EFFORT),
    opus55High: effortChoice('opus55', HIGH_EFFORT),
});

// The rules are those of the pipeline's extraction, consolidation, and scoring prompts, stated for one request.
const SINGLE_CALL_SYSTEM_PROMPT = `You analyze a complete Hacker News comment thread. The submission title is: "{title}".

Task: list the axes of disagreement the thread argues about, then classify every comment against every axis.

An axis is a pair of incompatible statements that answer the same question, such that one commenter could hold the first and another the second. Examples of statements that anchor an axis: "remote work makes teams less productive", "static typing prevents more bugs than it costs in effort", "the paper's main result will replicate". An overall verdict on the subject also counts when phrased as a statement ("the product is worth its price"). Examples that do not count: topics ("pricing"), mood statements without a claim about the subject ("I'm disappointed"), traits of the commenter ("has used the product for years").

Axes:
- An axis is one question the thread argues about, not one comment's particular wording, example, or reason. Comments that give different reasons for the same side hold the same statement. A narrower facet, reason, example, or consequence of one side of a question belongs to that question's axis.
- Keep two questions apart only when several comments hold each of them and a commenter could plausibly take side A on one and side B on the other.
- The reader is shown how many people take each side of each axis. An axis is useful only when several people take a side on it. Make each axis broad enough to gather the commenters who address its question. There is no target count, but the application drops every axis on whose two statements fewer than ${core.MIN_AXIS_PEOPLE} people are placed.
- statementA and statementB: each one full sentence about the same thing, the two incompatible with each other so a commenter can hold at most one, and each understandable on its own. Word them as the two answers to the question.

Stances: for each comment, and for each axis that the comment clearly takes a position on, output one stance. Name the axis by its position in your axes list, counted from 1:
- "A" if the comment holds statement A,
- "B" if the comment holds statement B,
- "M" if the comment explicitly addresses the question the two statements answer but takes a middle, mixed, or it-depends position.

Rules:
- Skip axes the comment does not address. Most comments address zero, one, or two axes.
- A comment addresses an axis only when its position is clear from its own text. A comment header "[id X, re P]" names the comment's parent P. Use the parent only to resolve what the comment refers to, such as a pronoun or an omitted subject. The parent's position is never read as the comment's own. Do not infer a stance from tone or from the author.
- Words that only agree or disagree with the parent ("this", "exactly", "+1", "same here", "no", "wrong") state no position. Judge the rest of the comment's text as if those words were absent, and give no stance when nothing else is left.
- A line inside a comment that begins with ">" quotes another comment or the article and is not the commenter's own claim. A comment whose own words only accept or reject a quoted line gets no stance.
- A position the comment attributes to someone else ("people say", "the article claims") is not the comment's own.
- "M" is not for a comment whose position is unclear, and not for a comment that holds one statement while granting a point to the other, which is still "A" or "B".
- Use only the comment ids that appear in the thread. Give a comment at most one stance per axis.
- Return JSON matching the schema and nothing else.`;

const SINGLE_CALL_SCHEMA = {
    name: 'single_call_analysis',
    schema: {
        type: 'object',
        properties: {
            axes: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        statementA: { type: 'string' },
                        statementB: { type: 'string' },
                    },
                    required: ['statementA', 'statementB'],
                    additionalProperties: false,
                },
            },
            stances: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        comment: { type: 'integer' },
                        axis: { type: 'integer' },
                        stance: { type: 'string', enum: ['A', 'B', 'M'] },
                    },
                    required: ['comment', 'axis', 'stance'],
                    additionalProperties: false,
                },
            },
        },
        required: ['axes', 'stances'],
        additionalProperties: false,
    },
};

// The request's output: axes numbered from 1 in the order given, and a Map("commentId|axisId" -> stance).
// The stance list has the scoring schema's shape, so the pipeline's own parser reads it.
function parseSingleCall(json, thread) {
    if (!json || !Array.isArray(json.axes)) throw new core.InvalidResponseError('single call response has no axes array', json);
    const axes = json.axes.map((raw, index) => {
        const statementA = raw && typeof raw.statementA === 'string' ? raw.statementA.trim() : '';
        const statementB = raw && typeof raw.statementB === 'string' ? raw.statementB.trim() : '';
        if (statementA === '' || statementB === '') throw new core.InvalidResponseError(`single call axis ${index + 1} is missing a statement`, json);
        return { id: index + 1, statementA, statementB };
    });
    if (axes.length === 0) throw new core.InvalidResponseError('single call response lists no axes', json);
    const { stances, warnings } = core.parseScoreResponse(json, new Set(thread.comments.map(comment => comment.id)), axes, false);
    return { axes, stances, warnings };
}

// The thread is formatted as one extraction batch that holds every comment, so each reply names its parent.
async function requestSingleCall({ choice, thread, modelCallChat }) {
    const commentsById = core.indexCommentsById(thread.comments);
    const call = {
        stage: SINGLE_CALL_STAGE, model: choice.model, sampling: choice.sampling, reasoning: choice.reasoning, maxTokens: choice.maxTokens,
        messages: [
            { role: 'system', content: SINGLE_CALL_SYSTEM_PROMPT.replace('{title}', () => thread.title) },
            core.buildExtractMessages(thread.title, thread.comments, commentsById, core.DEFAULT_CONFIG.parentSnippetChars)[1],
        ],
        schema: SINGLE_CALL_SCHEMA,
    };
    return parseSingleCall((await modelCallChat(call)).json, thread);
}

// The pipeline config of both variants: the choice's model in every stage, and one batch per stage.
function pipelineConfig(choice, thread) {
    return { ...core.applyToAllStages({}, { model: choice.model, sampling: choice.sampling, reasoning: choice.reasoning, maxTokens: choice.maxTokens }),
        extractBatchChars: WHOLE_THREAD_BATCH_CHARS, scoreBatchComments: thread.comments.length, concurrency: 1 };
}

// The fixed pipeline responses that stand for the request: one candidate per axis holding the comments the
// request put on its two statements, one axis per candidate, and the request's stances as the first scoring
// pass. The second scoring pass repeats those stances (secondPassByModel false) or goes to the model.
function handlersOf(single, secondPassByModel) {
    const sides = single.axes.map(() => ({ A: [], B: [] }));
    for (const [key, stance] of single.stances) {
        const { commentId, axisId } = core.parseStanceKey(key);
        // A middle stance is on neither statement.
        const side = sides[axisId - 1][stance];
        if (side !== undefined) side.push(commentId);
    }
    const requestStances = lib.fixedStances(single.stances);
    return {
        extract: () => ({ candidates: single.axes.map((axis, index) => ({ statementA: axis.statementA, statementB: axis.statementB, commentsA: sides[index].A, commentsB: sides[index].B })) }),
        consolidate: () => ({ axes: single.axes.map((axis, index) => ({ statementA: axis.statementA, statementB: axis.statementB, candidates: [index + 1] })) }),
        score: call => (secondPassByModel && call.meta.passIndex === 1 ? MODEL : requestStances(call)),
        synthesize: lib.noSummary,
    };
}

// The dollars, seconds, and count of the given metered calls. The calls of a variant run one after another.
function spent(calls) {
    const sum = values => values.reduce((total, value) => total + value, 0);
    return { usd: sum(calls.map(call => call.usd)), seconds: lib.rounded(sum(calls.map(call => call.seconds ?? 0))), calls: calls.length,
        promptTokens: sum(calls.map(call => call.promptTokens)), completionTokens: sum(calls.map(call => call.completionTokens)) };
}

function failure(error) {
    return { agreement: 0, precision: 0, recall: 0, failed: error.message.slice(0, FAILURE_MESSAGE_CHARS) };
}

// A response that stays invalid or truncated is a result. Any other error (network, spending cap) stops the run.
function isOutputFailure(error) {
    return error instanceof core.InvalidResponseError || error instanceof core.TruncationError;
}

function runLine(label, run) {
    const figures = run.failed
        ? `FAILED: ${run.failed}`
        : `${run.axes} axes, ${run.rowsWithEnoughPeople} outside "too few", ${run.stances} stances; F1 against silver ${lib.percent(run.agreement)} `
            + `(precision ${lib.percent(run.precision)}, recall ${lib.percent(run.recall)}), ${run.pairedAxes} of ${run.referenceAxes} silver axes paired`;
    return `${label}: ${figures}; $${run.usd.toFixed(4)}, ${run.seconds} s, ${run.calls} calls`;
}

// One run of a choice: the request, then both variants through the pipeline, graded against silver.
async function runChoice({ choiceKey, silver, thread, modelCallChat, label }) {
    const choice = SINGLE_CALL_CHOICES[choiceKey];
    const meter = lib.makeMeter();
    const meteredCallChat = meter.wrap(modelCallChat);
    const callsOf = stage => meter.calls.filter(call => call.stage === stage);
    let single;
    try {
        single = await requestSingleCall({ choice, thread, modelCallChat: meteredCallChat });
    } catch (error) {
        if (!isOutputFailure(error)) throw error;
        const failed = { ...failure(error), ...spent(callsOf(SINGLE_CALL_STAGE)) };
        return { oneCall: failed, twoCalls: failed };
    }
    const config = pipelineConfig(choice, thread);
    const run = (variant, secondPassByModel) => lib.runStages({ thread, config, handlers: handlersOf(single, secondPassByModel), modelCallChat: meteredCallChat, label: `${label} ${variant}` });
    const returned = { axesReturned: single.axes.length, stancesReturned: single.stances.size, warnings: single.warnings.length };
    const oneCall = { ...returned, ...lib.gradeWholeRun(await run('oneCall', false), silver), ...spent(callsOf(SINGLE_CALL_STAGE)) };
    let twoCalls;
    try {
        twoCalls = { ...returned, ...lib.gradeWholeRun(await run('twoCalls', true), silver), ...spent(meter.calls) };
    } catch (error) {
        if (!isOutputFailure(error)) throw error;
        twoCalls = { ...failure(error), ...spent(meter.calls) };
    }
    return { oneCall, twoCalls };
}

// The runs of one variant and, over them, the mean, lowest, and highest of each figure. A failed run counts as
// F1 0 and has no shape.
const SPREAD_FIELDS = Object.freeze(['agreement', 'precision', 'recall', 'axes', 'rowsWithEnoughPeople', 'stances', 'usd', 'seconds']);
function variantSummary(runs) {
    return { runs, ...lib.runSummary(runs, SPREAD_FIELDS) };
}

async function measureChoice({ choiceKey, repeats, silver, thread, apiKey, ledger }) {
    const choice = SINGLE_CALL_CHOICES[choiceKey];
    const runs = [];
    for (let runNumber = 1; runNumber <= 1 + repeats; runNumber += 1) {
        const modelCallChat = lib.runCallChat({ apiKey, ledger, name: `single-${choiceKey}`, runNumber, firstCacheDirectory: lib.CACHE_DIRECTORY });
        const label = `${choiceKey} run ${runNumber}`;
        const result = await runChoice({ choiceKey, silver, thread, modelCallChat, label });
        console.log(runLine(`${label} oneCall`, result.oneCall));
        console.log(runLine(`${label} twoCalls`, result.twoCalls));
        runs.push(result);
    }
    return { name: choice.name, effort: choice.effort, model: choice.model, oneCall: variantSummary(runs.map(run => run.oneCall)),
        twoCalls: variantSummary(runs.map(run => run.twoCalls)), measuredAt: new Date().toISOString() };
}

async function main() {
    const silver = lib.readSilver();
    const keys = lib.readKeyList('choice', SINGLE_CALL_CHOICES);
    const repeats = lib.readRepeats();
    const benchmark = { threadId: silver.threadId, title: silver.title, comments: silver.comments, chars: silver.chars, silverBuiltAt: silver.builtAt,
        results: lib.readStoredResults(RESULT_FILE, silver) ?? {} };
    const ledger = { spentUsd: 0, capUsd: Number(lib.readArgument('budget') ?? DEFAULT_BUDGET_USD) };
    const apiKey = lib.requireApiKey();
    const thread = await lib.loadThread(silver.threadId);
    lib.checkSilverSnapshot(thread, silver);
    // The choices run side by side; each result is saved as it arrives.
    await Promise.all(keys.map(async key => {
        benchmark.results[key] = await measureChoice({ choiceKey: key, repeats, silver, thread, apiKey, ledger });
        fs.writeFileSync(RESULT_FILE, JSON.stringify(benchmark, null, 1) + '\n', 'utf8');
    }));
    console.log(`wrote ${RESULT_FILE}; $${ledger.spentUsd.toFixed(2)} spent in this run`);
}

module.exports = { SINGLE_CALL_CHOICES, SINGLE_CALL_SCHEMA, parseSingleCall, pipelineConfig, handlersOf };
if (require.main === module) main().catch(error => {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
});
