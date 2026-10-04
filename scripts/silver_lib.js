// Shared by scripts/silver.js (builds the silver reference) and scripts/benchmark.js (grades model choices
// against it). Both run the page's own pipeline (runPipeline) and replace the stages that are not under
// test with fixed responses, so a stage is always measured on the same inputs.
const fs = require('node:fs');
const path = require('node:path');
const { loadCore } = require('./load_core');

const core = loadCore();
const KEY_ENV_NAME = 'OPENROUTER_API_KEY';
const REPO_ROOT = path.join(__dirname, '..');
const SILVER_FILE = path.join(REPO_ROOT, 'data', 'silver.json');
const BENCHMARK_FILE = path.join(REPO_ROOT, 'data', 'silver-benchmark.json');
// Not in git: the thread snapshot and every finished model call, so a rerun pays for nothing twice.
const WORK_DIRECTORY = path.join(REPO_ROOT, 'outputs', 'silver');

// The silver reference is what these two models agree on: the strongest OpenAI and Anthropic models at a
// high reasoning effort. No person annotated anything.
const SILVER_SEED = 12345;
const SILVER_MODELS = Object.freeze([
    Object.freeze({ key: 'sol61xhigh', name: 'GPT-6.1 Sol', effort: 'xhigh', model: 'openai/gpt-6.1-sol', sampling: Object.freeze({ seed: SILVER_SEED }), reasoning: Object.freeze({ effort: 'xhigh' }) }),
    Object.freeze({ key: 'opus55high', name: 'Claude Opus 5.5', effort: 'high', model: 'anthropic/claude-opus-5.5', sampling: null, reasoning: Object.freeze({ effort: 'high' }) }),
]);
// Output ceilings of the silver models by stage suffix. Reasoning tokens count against the ceiling.
const SILVER_MAX_TOKENS = Object.freeze({ Extract: 64000, Consolidate: 128000, Score: 64000, Synthesize: 32000 });
const JUDGE_MAX_TOKENS = 64000;

// A stage handler is MODEL (send the call to the configured model) or a function that returns the fixed
// response JSON for the call.
const MODEL = Symbol('model');

function readArgument(name) {
    const prefix = `--${name}=`;
    const found = process.argv.find(argument => argument.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
}

function requireApiKey() {
    const apiKey = readArgument('key') || process.env[KEY_ENV_NAME];
    if (!apiKey) throw new Error(`pass --key=... or set ${KEY_ENV_NAME}`);
    return apiKey;
}

function silverConfig(silverModel) {
    const config = {};
    for (const [suffix, maxTokens] of Object.entries(SILVER_MAX_TOKENS)) {
        config[`model${suffix}`] = silverModel.model;
        config[`sampling${suffix}`] = silverModel.sampling;
        config[`reasoning${suffix}`] = silverModel.reasoning;
        config[`maxTokens${suffix}`] = maxTokens;
    }
    return config;
}

function makeFileStore(directory) {
    fs.mkdirSync(directory, { recursive: true });
    const pathFor = key => path.join(directory, key + '.json');
    return {
        get(key) {
            try {
                return JSON.parse(fs.readFileSync(pathFor(key), 'utf8'));
            } catch (error) {
                if (error.code === 'ENOENT') return undefined;
                throw error;
            }
        },
        set(key, value) {
            fs.writeFileSync(pathFor(key), JSON.stringify(value), 'utf8');
        },
    };
}

// The thread snapshot the reference was built on. A later fetch can differ (edited or deleted comments), so
// the snapshot is kept in the work directory and reused.
async function loadThread(threadId) {
    fs.mkdirSync(WORK_DIRECTORY, { recursive: true });
    const threadFile = path.join(WORK_DIRECTORY, `thread-${threadId}.json`);
    if (!fs.existsSync(threadFile)) {
        process.stderr.write(`Fetching thread ${threadId}\n`);
        fs.writeFileSync(threadFile, JSON.stringify(await core.fetchThreadItem(String(threadId))), 'utf8');
    }
    const item = JSON.parse(fs.readFileSync(threadFile, 'utf8'));
    if (String(item.id) !== String(threadId)) throw new Error(`${threadFile} holds thread ${item.id}, not ${threadId}`);
    return core.flattenThread(item);
}

function threadChars(thread) {
    return thread.comments.reduce((sum, comment) => sum + comment.text.length + core.CONSTANTS.COMMENT_FRAME_CHARS, 0);
}

// The model call path: cache over a timed, capped OpenRouter client. ledger = { spentUsd, capUsd }. A call
// is refused once the spend has reached the cap; calls already in flight still finish, so keep the
// concurrency low enough that their cost is an acceptable overshoot. The call's wall-clock seconds are stored
// with its usage, so a replay from the cache still reports how long the call took.
function makeModelCallChat({ apiKey, ledger }) {
    const direct = core.makeOpenRouterCallChat({ apiKey });
    async function timed(call) {
        if (ledger.spentUsd >= ledger.capUsd) {
            throw new Error(`Spending cap of $${ledger.capUsd} reached ($${ledger.spentUsd.toFixed(2)} spent) before a ${call.stage} call to ${call.model}`);
        }
        const startedAt = Date.now();
        try {
            const response = await direct(call);
            ledger.spentUsd += response.usage.cost;
            return { ...response, usage: { ...response.usage, seconds: (Date.now() - startedAt) / 1000 } };
        } catch (error) {
            if (error.usage) {
                if (typeof error.usage.cost === 'number') ledger.spentUsd += error.usage.cost;
                error.usage = { ...error.usage, seconds: (Date.now() - startedAt) / 1000 };
            }
            throw error;
        }
    }
    return core.makeCachedCallChat(timed, makeFileStore(path.join(WORK_DIRECTORY, 'cache')));
}

// Collects what each model call cost and how long it took, whether it ran now or was replayed from cache.
function makeMeter() {
    const calls = [];
    function add(stage, usage, failed) {
        if (!usage) return;
        calls.push({ stage, usd: usage.originalCost ?? usage.cost, seconds: usage.seconds ?? null,
            promptTokens: usage.promptTokens ?? 0, completionTokens: usage.completionTokens ?? 0, failed });
    }
    return {
        calls,
        wrap: callChat => async call => {
            try {
                const response = await callChat(call);
                add(call.stage, response.usage, false);
                return response;
            } catch (error) {
                add(call.stage, error.usage, true);
                throw error;
            }
        },
        // The measured totals of one stage: dollars, calls, and the mean and longest call time.
        stage(stageKey) {
            const stageCalls = calls.filter(call => call.stage === stageKey);
            // A successful call always has its time; a failed call has it unless an earlier version stored it.
            const untimed = stageCalls.filter(call => call.seconds === null);
            if (untimed.some(call => !call.failed)) throw new Error(`${untimed.length} ${stageKey} calls have no recorded time`);
            const timed = stageCalls.filter(call => call.seconds !== null).map(call => call.seconds);
            const sum = values => values.reduce((total, value) => total + value, 0);
            return {
                usd: sum(stageCalls.map(call => call.usd)),
                calls: stageCalls.length,
                failedCalls: stageCalls.filter(call => call.failed).length,
                meanCallSeconds: timed.length ? sum(timed) / timed.length : 0,
                maxCallSeconds: timed.length ? Math.max(...timed) : 0,
                promptTokens: sum(stageCalls.map(call => call.promptTokens)),
                completionTokens: sum(stageCalls.map(call => call.completionTokens)),
            };
        },
    };
}

const FIXED_USAGE = Object.freeze({ promptTokens: 0, completionTokens: 0, cost: 0 });

// Runs the page pipeline on the thread. handlers maps each stage key (extract, consolidate, score,
// synthesize) to MODEL or to a function returning that call's fixed response.
async function runStages({ thread, config, handlers, modelCallChat, label }) {
    const callChat = async call => {
        const handler = handlers[call.stage];
        if (handler === undefined) throw new Error(`${label}: no handler for stage ${call.stage}`);
        if (handler === MODEL) return modelCallChat(call);
        return { json: handler(call), usage: FIXED_USAGE };
    };
    let lastLine = '';
    return core.runPipeline({
        thread,
        config: { ...config, budgetUsd: Number.MAX_SAFE_INTEGER },
        callChat,
        onProgress: update => {
            const line = `${label}: ${update.stage} ${update.done}/${update.total}`;
            if (line !== lastLine) process.stderr.write(line + '\n');
            lastLine = line;
        },
    });
}

// Fixed responses -----------------------------------------------------------

// Extraction: the pool candidates of the call's batch, in pool order.
function fixedCandidates(pool) {
    return call => ({ candidates: pool.filter(candidate => candidate.batchIndex === call.meta.batchIndex)
        .map(({ statementA, statementB, commentsA, commentsB }) => ({ statementA, statementB, commentsA, commentsB })) });
}

// Consolidation: the given axes.
function fixedAxes(axes) {
    return () => ({ axes: axes.map(({ statementA, statementB, candidates }) => ({ statementA, statementB, candidates })) });
}

// Consolidation for a run that only needs the extraction result: one axis that holds every candidate.
function oneAxisOfAllCandidates(call) {
    return { axes: [{ statementA: 'placeholder', statementB: 'placeholder',
        candidates: Array.from({ length: call.meta.candidateCount }, (unused, index) => index + 1) }] };
}

// Scoring: the stances of a table Map("commentId|axisId" -> "A" | "B" | "M"), the same in both passes.
function fixedStances(table) {
    return call => {
        const stances = [];
        call.meta.presentedAxes.forEach((axis, index) => {
            for (const commentId of call.meta.commentIds) {
                const stance = table.get(`${commentId}|${axis.id}`);
                if (stance !== undefined) stances.push({ comment: commentId, axis: index + 1, stance: call.meta.swapPoles ? core.flipStance(stance) : stance });
            }
        });
        return { stances };
    };
}

function noStances() {
    return { stances: [] };
}

function noSummary() {
    throw new Error('summary not requested');
}

// Reading results -----------------------------------------------------------

// The stances of a pipeline result in each axis's own orientation (rows put the larger side first):
// agreed = Map("commentId|axisId" -> stance both passes gave); unsure = Set of keys only one pass
// classified or the passes classified differently.
function stancesOfResult(result) {
    const axisById = new Map(result.axes.map(axis => [axis.id, axis]));
    const agreed = new Map();
    const unsure = new Set();
    for (const row of result.rows) {
        const axis = axisById.get(row.axisId);
        const flipped = row.statementA !== axis.statementA;
        if (flipped && row.statementA !== axis.statementB) throw new Error(`row ${row.axisId} matches neither statement of its axis`);
        const sides = flipped ? { A: row.commentIdsB, B: row.commentIdsA } : { A: row.commentIdsA, B: row.commentIdsB };
        for (const commentId of sides.A) agreed.set(`${commentId}|${row.axisId}`, 'A');
        for (const commentId of sides.B) agreed.set(`${commentId}|${row.axisId}`, 'B');
        for (const commentId of row.commentIdsM) agreed.set(`${commentId}|${row.axisId}`, 'M');
        for (const comment of row.unverifiedComments) unsure.add(`${comment.commentId}|${row.axisId}`);
    }
    for (const axis of result.unverifiedAxes) {
        for (const comment of axis.unverifiedComments) unsure.add(`${comment.commentId}|${axis.id}`);
    }
    return { agreed, unsure };
}

// The (axisId, stance) markers a summary cites, in order.
function summaryMarkers(synthesis) {
    return synthesis.sections.flatMap(section => core.synthesisTextParts(section.text).filter(part => part.axisId !== undefined));
}

// Metrics -------------------------------------------------------------------

// Agreement is the harmonic mean of precision and recall, 0 when either is 0.
function agreementOf(precision, recall) {
    return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

// For each candidate number 1..count, the set of candidates that share an axis with it (itself excluded).
function companions(axes, candidateCount) {
    const sets = Array.from({ length: candidateCount + 1 }, () => new Set());
    for (const axis of axes) {
        for (const first of axis.candidates) {
            for (const second of axis.candidates) {
                if (first !== second) sets[first].add(second);
            }
        }
    }
    return sets;
}

// Consolidation agreement (B-cubed over candidates). A pair of candidates is "together" when both silver
// partitions put it in one axis, "apart" when neither does, and disputed otherwise; disputed pairs are not
// graded. Precision of a candidate: of the graded candidates the model put with it, the share that are
// together. Recall of a candidate: of the candidates that are together with it, the share the model put
// with it. Each is averaged over the candidates for which it is defined.
function consolidationAgreement(modelAxes, silverPartitions, candidateCount) {
    const model = companions(modelAxes, candidateCount);
    const [first, second] = silverPartitions.map(axes => companions(axes, candidateCount));
    const precisions = [];
    const recalls = [];
    for (let candidate = 1; candidate <= candidateCount; candidate += 1) {
        const together = [...first[candidate]].filter(other => second[candidate].has(other));
        const disputed = other => first[candidate].has(other) !== second[candidate].has(other);
        const graded = [...model[candidate]].filter(other => !disputed(other));
        if (graded.length > 0) precisions.push(graded.filter(other => first[candidate].has(other)).length / graded.length);
        if (together.length > 0) recalls.push(together.filter(other => model[candidate].has(other)).length / together.length);
    }
    const mean = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
    const precision = mean(precisions);
    const recall = mean(recalls);
    return { agreement: agreementOf(precision, recall), precision, recall };
}

// Scoring agreement over the cells (comment, axis) on which the silver models agree. Precision: of the
// stances the model gave on graded cells, the share equal to the silver stance. Recall: of the silver stances,
// the share the model gave. silver = { stances: Map(key -> stance), disputed: Set(key) }.
function scoringAgreement(modelAgreed, silver) {
    let given = 0;
    let correct = 0;
    for (const [key, stance] of modelAgreed) {
        if (silver.disputed.has(key)) continue;
        given += 1;
        if (silver.stances.get(key) === stance) correct += 1;
    }
    const precision = given === 0 ? 0 : correct / given;
    const recall = silver.stances.size === 0 ? 0 : correct / silver.stances.size;
    return { agreement: agreementOf(precision, recall), precision, recall, given, correct };
}

// Judges ---------------------------------------------------------------------

const MATCH_SYSTEM_PROMPT = `You match candidate axes to reference axes. Both come from one Hacker News thread. The submission title is: "{title}".

An axis is a pair of incompatible statements, A and B, that answer the same question. The reference axes are the questions the thread argues about. Each candidate axis was extracted from one batch of the thread's comments.

A candidate matches a reference axis when its two statements answer the same question as the reference axis, in either order, or state a narrower facet, reason, example, or consequence of one side of that question, so that a commenter holding one side of the candidate would usually hold one particular side of the reference axis.

For each candidate, return the number of the one reference axis it matches best, or 0 when it matches none. Return exactly one entry per candidate, as JSON matching the schema and nothing else.`;
const MATCH_SCHEMA = { name: 'match_candidates', schema: { type: 'object', additionalProperties: false, required: ['matches'],
    properties: { matches: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['candidate', 'axis'],
        properties: { candidate: { type: 'integer' }, axis: { type: 'integer' } } } } } } };

const FAITHFUL_SYSTEM_PROMPT = `You check a summary of a Hacker News discussion against the evidence it was written from. The submission title is: "{title}".

The evidence lists axes. Each axis has two rival statements, A and B, a group computed from its counts (consensus, split, leaning, or tooFew), the number of people on each side, and comment excerpts. The summary cites one side of one axis with a marker such as [[axis:3:A]], placed immediately after the words that state that side. The application replaces each marker with the number of people on that side.

For each marker in the summary, decide whether the words it follows are faithful. They are faithful when all of these hold: they state the marked side of the marked axis, as the axis's statement and excerpts support it; they add no claim that the evidence does not support; and they present the weight of the side consistently with the counts and the group (a majority as a majority, a minority as a minority, a near-even division as a disagreement).

Return exactly one entry per marker, in the order the markers appear, as JSON matching the schema and nothing else.`;
const FAITHFUL_SCHEMA = { name: 'check_summary', schema: { type: 'object', additionalProperties: false, required: ['markers'],
    properties: { markers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['axisId', 'stance', 'faithful'],
        properties: { axisId: { type: 'integer' }, stance: { type: 'string', enum: ['A', 'B'] }, faithful: { type: 'boolean' } } } } } } };

async function judgeCall(modelCallChat, silverModel, stage, systemPrompt, title, userContent, schema) {
    const call = { stage, model: silverModel.model, sampling: silverModel.sampling, reasoning: silverModel.reasoning, maxTokens: JUDGE_MAX_TOKENS,
        messages: [{ role: 'system', content: systemPrompt.replace('{title}', title) }, { role: 'user', content: userContent }], schema };
    return (await modelCallChat(call)).json;
}

// Each silver model matches the candidates to the reference axes. Returns, per candidate (index 0 is
// candidate 1), the axis id both models chose, 0 when both chose none, or null when they differ or either
// gave no valid answer.
async function matchCandidates({ modelCallChat, title, axes, candidates }) {
    const axisLines = axes.map((axis, index) => `${index + 1}. A: ${axis.statementA} | B: ${axis.statementB}`);
    const candidateLines = candidates.map((candidate, index) => `#${index + 1} A: ${candidate.statementA} | B: ${candidate.statementB}`);
    const userContent = `Reference axes:\n\n${axisLines.join('\n')}\n\nCandidates:\n\n${candidateLines.join('\n')}`;
    const answers = await Promise.all(SILVER_MODELS.map(async silverModel => {
        const json = await judgeCall(modelCallChat, silverModel, 'matchCandidates', MATCH_SYSTEM_PROMPT, title, userContent, MATCH_SCHEMA);
        const byCandidate = new Map();
        for (const match of json.matches || []) {
            if (Number.isInteger(match.candidate) && Number.isInteger(match.axis) && match.axis >= 0 && match.axis <= axes.length) byCandidate.set(match.candidate, match.axis);
        }
        return byCandidate;
    }));
    return candidates.map((candidate, index) => {
        const [first, second] = answers.map(byCandidate => byCandidate.get(index + 1));
        if (first === undefined || second === undefined || first !== second) return null;
        return first === 0 ? 0 : axes[first - 1].id;
    });
}

// Each silver model checks every marker of the summary. Returns Map("axisId:stance" -> true when both
// found it faithful, false when both found it unfaithful, null when they differ or either gave no answer).
async function checkSummary({ modelCallChat, title, evidenceContent, synthesis }) {
    const userContent = JSON.stringify({ evidence: JSON.parse(evidenceContent), summary: synthesis.sections.map(section => section.text) });
    const answers = await Promise.all(SILVER_MODELS.map(async silverModel => {
        const json = await judgeCall(modelCallChat, silverModel, 'checkSummary', FAITHFUL_SYSTEM_PROMPT, title, userContent, FAITHFUL_SCHEMA);
        return new Map((json.markers || []).filter(marker => typeof marker.faithful === 'boolean').map(marker => [`${marker.axisId}:${marker.stance}`, marker.faithful]));
    }));
    return new Map(summaryMarkers(synthesis).map(marker => {
        const key = `${marker.axisId}:${marker.stance}`;
        const [first, second] = answers.map(byMarker => byMarker.get(key));
        return [key, first === undefined || second === undefined || first !== second ? null : first];
    }));
}

// Silver file -----------------------------------------------------------------

function readSilver() {
    if (!fs.existsSync(SILVER_FILE)) throw new Error(`${SILVER_FILE} not found; build it with: node scripts/silver.js --thread=<id>`);
    return JSON.parse(fs.readFileSync(SILVER_FILE, 'utf8'));
}

// The silver stances as scoringAgreement and fixedStances use them.
function silverStanceTable(silver) {
    return {
        stances: new Map(silver.stances.map(([commentId, axisId, stance]) => [`${commentId}|${axisId}`, stance])),
        disputed: new Set(silver.disputedCells.map(([commentId, axisId]) => `${commentId}|${axisId}`)),
    };
}

module.exports = {
    core, SILVER_FILE, BENCHMARK_FILE, WORK_DIRECTORY, SILVER_MODELS, MODEL,
    readArgument, requireApiKey, silverConfig, loadThread, threadChars, makeModelCallChat, makeMeter, runStages,
    fixedCandidates, fixedAxes, oneAxisOfAllCandidates, fixedStances, noStances, noSummary,
    stancesOfResult, summaryMarkers, agreementOf, companions, consolidationAgreement, scoringAgreement,
    matchCandidates, checkSummary, readSilver, silverStanceTable,
};
