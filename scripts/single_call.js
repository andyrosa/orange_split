// Measures how well one model does when one request replaces the extraction, consolidation, and scoring
// stages of the page pipeline. The request holds the whole thread and returns the axes and, for each comment,
// its stance on each axis it addresses. The summary stage is not part of the request. Each result is graded
// against the silver reference (data/silver.json, built by scripts/silver.js) and, with --reference, against
// one multi-stage run, and written to data/single-call-benchmark.json.
// Usage: node scripts/single_call.js --choice=<key>            one choice of SINGLE_CALL_CHOICES
//        node scripts/single_call.js --all                     every choice without a result yet
//        node scripts/single_call.js --pipeline-result=<file>  grade a result file of scripts/run_node.js --out
//                                                              the same way; nothing is called or written
//        [--reference=<file>] also grade against that result file of scripts/run_node.js --out, a multi-stage
//                             run on the reference thread; a changed reference measures every choice again
//        [--force] measure again a choice that has a result  [--budget=<usd>] [--key=sk-or-...]
// Each choice is measured in two variants:
//   oneCall   the request alone: every stance it returns counts.
//   twoCalls  the request plus one scoring call, which is the pipeline's second scoring pass (axes shuffled,
//             statements swapped) over the whole thread in one request. Only the stances both calls give
//             count, as the pipeline counts only the stances both of its scoring passes give.
// Both variants run through the page pipeline (runPipeline) with the request's output as the fixed response of
// extraction, consolidation, and the first scoring pass, so the rows are the rows the page would show. The
// pipeline's floor applies: an axis on whose two statements the request put fewer than MIN_AXIS_PEOPLE people
// is dropped.
// Grading against a reference, which is silver or a multi-stage run. A reference has axes, stances, and
// disputed cells: for silver, the cells its two models do not agree on; for a multi-stage run, the cells only
// one of its scoring passes gave a stance or its passes gave different stances. A run axis's comments are
// those with a counted stance on it; a reference axis's comments are those with a reference stance on it. The
// similarity of a run axis and a reference axis is the number of comments on both over the number on either,
// leaving out the run comments on the reference axis's disputed cells. A run axis and a reference axis are
// paired when each is the other's most similar axis and they share at least MIN_SHARED_COMMENTS comments.
// Similarity is used, not the bare count that scripts/silver.js pairs the two silver models' axes by, because
// one comment has stances on several axes, so a large axis shares comments with many small ones. The run's
// stances on a paired axis are then graded as the scoring role is graded: precision is the share of the
// stances given on undisputed cells that equal the reference stance, recall is the share of all reference
// stances given, and agreement is their harmonic mean, the F1 score. A reference stance on an unpaired
// reference axis counts as not given, and a stance on an unpaired run axis is not graded, so the result also
// states how many axes were paired.
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./silver_lib');

const { core, MODEL } = lib;
const REPO_ROOT = path.join(__dirname, '..');
const RESULT_FILE = path.join(REPO_ROOT, 'data', 'single-call-benchmark.json');
const DEFAULT_BUDGET_USD = 10;
const SINGLE_CALL_STAGE = 'singleCall';
const MIN_SHARED_COMMENTS = 2;
const PRECISION_DIGITS = 4;
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

function rounded(value) {
    return Number(value.toFixed(PRECISION_DIGITS));
}

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

// Pairs the run's axes with the reference's axes and grades the run's stances on the paired axes.
// run = { axes: [{ id }], agreed: Map("commentId|axisId" -> stance) }.
function gradeRun(run, reference) {
    const table = lib.silverStanceTable(reference);
    const runComments = new Map(run.axes.map(axis => [axis.id, new Map()]));
    for (const [key, stance] of run.agreed) {
        const { commentId, axisId } = core.parseStanceKey(key);
        if (!runComments.has(axisId)) throw new Error(`stance on comment ${commentId} names axis ${axisId}, which the run does not list`);
        runComments.get(axisId).set(commentId, stance);
    }
    const commentsByAxis = cells => {
        const sets = new Map(reference.axes.map(axis => [axis.id, new Set()]));
        for (const [commentId, axisId] of cells) sets.get(axisId).add(commentId);
        return sets;
    };
    const referenceComments = commentsByAxis(reference.stances);
    const disputedComments = commentsByAxis(reference.disputedCells);
    // The comments the two axes share, and that count over the count of comments on either axis. A run comment
    // on a disputed cell of the reference axis is on neither side of that division.
    const overlap = (runAxis, referenceAxis) => {
        const onReference = referenceComments.get(referenceAxis.id);
        const disputed = disputedComments.get(referenceAxis.id);
        let sharedComments = 0;
        let eitherComments = onReference.size;
        for (const commentId of runComments.get(runAxis.id).keys()) {
            if (onReference.has(commentId)) sharedComments += 1;
            else if (!disputed.has(commentId)) eitherComments += 1;
        }
        return { sharedComments, similarity: eitherComments === 0 ? 0 : sharedComments / eitherComments };
    };
    const bestMatch = (others, similarityTo) => others.reduce((best, other) => (similarityTo(other) > (best ? similarityTo(best) : 0) ? other : best), null);
    const translated = new Map();
    const pairs = [];
    for (const runAxis of run.axes) {
        const referenceAxis = bestMatch(reference.axes, other => overlap(runAxis, other).similarity);
        if (referenceAxis === null || bestMatch(run.axes, other => overlap(other, referenceAxis).similarity) !== runAxis) continue;
        const { sharedComments, similarity } = overlap(runAxis, referenceAxis);
        if (sharedComments < MIN_SHARED_COMMENTS) continue;
        // The run's statements can be in the opposite order: the order under which more stances equal the
        // reference stances is taken. A middle stance equals itself under both orders.
        let equalAsGiven = 0;
        let equalSwapped = 0;
        for (const [commentId, stance] of runComments.get(runAxis.id)) {
            const referenceStance = table.stances.get(`${commentId}|${referenceAxis.id}`);
            if (referenceStance === undefined) continue;
            if (referenceStance === stance) equalAsGiven += 1;
            if (referenceStance === core.flipStance(stance)) equalSwapped += 1;
        }
        const swapped = equalSwapped > equalAsGiven;
        for (const [commentId, stance] of runComments.get(runAxis.id)) {
            translated.set(`${commentId}|${referenceAxis.id}`, swapped ? core.flipStance(stance) : stance);
        }
        pairs.push({ runAxisId: runAxis.id, referenceAxisId: referenceAxis.id, sharedComments, similarity: rounded(similarity), swapped });
    }
    const { precision, recall, given, correct } = lib.scoringAgreement(translated, table);
    const pairedReferenceAxes = new Set(pairs.map(pair => pair.referenceAxisId));
    const people = reference.rows.reduce((sum, row) => sum + row.people, 0);
    const pairedPeople = reference.rows.filter(row => pairedReferenceAxes.has(row.axisId)).reduce((sum, row) => sum + row.people, 0);
    return { agreement: rounded(lib.agreementOf(precision, recall)), precision: rounded(precision), recall: rounded(recall), given, correct,
        referenceStances: reference.stances.length, axes: run.axes.length, pairedAxes: pairs.length, referenceAxes: reference.axes.length,
        pairedPeopleShare: rounded(people === 0 ? 0 : pairedPeople / people), pairs };
}

// Grades a pipeline result: its scored axes and the stances both of its scoring passes gave.
function gradeResult(result, reference) {
    const { agreed } = lib.stancesOfResult(result);
    return { ...gradeRun({ axes: result.axes, agreed }, reference), stances: agreed.size, rows: result.rows.length, axesBelowFloor: result.stats.axesBelowFloor };
}

// The dollars, seconds, and count of the given metered calls. The calls of a variant run one after another.
function spent(calls) {
    const sum = values => values.reduce((total, value) => total + value, 0);
    return { usd: sum(calls.map(call => call.usd)), seconds: rounded(sum(calls.map(call => call.seconds ?? 0))), calls: calls.length,
        promptTokens: sum(calls.map(call => call.promptTokens)), completionTokens: sum(calls.map(call => call.completionTokens)) };
}

function failure(error) {
    return { agreement: 0, precision: 0, recall: 0, failed: error.message.slice(0, FAILURE_MESSAGE_CHARS) };
}

// A response that stays invalid or truncated is a result. Any other error (network, spending cap) stops the run.
function isOutputFailure(error) {
    return error instanceof core.InvalidResponseError || error instanceof core.TruncationError;
}

function percent(share) {
    return `${(share * 100).toFixed(1)}%`;
}

// One grade as text. referenceName is "silver" or "multi-stage".
function gradeText(grade, referenceName) {
    return `F1 against ${referenceName} ${percent(grade.agreement)} (precision ${percent(grade.precision)}, recall ${percent(grade.recall)}), `
        + `${grade.pairedAxes} of ${grade.referenceAxes} ${referenceName} axes paired`;
}

function variantLine(label, variant) {
    const multiStagePart = variant.multiStage ? `; ${gradeText(variant.multiStage, 'multi-stage')}` : '';
    const figures = variant.failed
        ? `FAILED: ${variant.failed}`
        : `${variant.axes} axes, ${variant.axesBelowFloor} more below the floor, ${variant.stances} stances; ${gradeText(variant, 'silver')}${multiStagePart}`;
    const cost = variant.usd === undefined ? '' : `; $${variant.usd.toFixed(4)}, ${variant.seconds} s, ${variant.calls} calls`;
    return `${label}: ${figures}${cost}`;
}

// A result file of scripts/run_node.js --out, which must hold the reference thread.
function readPipelineResult(file, silver) {
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (String(result.threadId) !== String(silver.threadId) || result.stats.comments !== silver.comments) {
        throw new Error(`${file} holds thread ${result.threadId} with ${result.stats.comments} comments, not the reference thread ${silver.threadId} with ${silver.comments} comments`);
    }
    return result;
}

// A multi-stage result in the shape of the silver reference: its scored axes, the stances both of its
// scoring passes gave, as disputed cells those only one pass gave or the passes gave differently, and the
// people on each row.
function referenceOfResult(result) {
    const { agreed, unsure } = lib.stancesOfResult(result);
    const cell = key => {
        const { commentId, axisId } = core.parseStanceKey(key);
        return [commentId, axisId];
    };
    return { axes: result.axes, stances: [...agreed].map(([key, stance]) => [...cell(key), stance]), disputedCells: [...unsure].map(cell),
        rows: result.rows.map(row => ({ axisId: row.axisId, people: row.authors })) };
}

// The multi-stage reference of --reference: the shape results are graded against, and what the results file
// states about the run, its own grade against silver included.
function readMultiStage(file, silver) {
    const result = readPipelineResult(file, silver);
    const reference = referenceOfResult(result);
    const roleChoices = result.roleChoices ?? null;
    const models = roleChoices === null ? null
        : Object.fromEntries(Object.entries(roleChoices).map(([role, key]) => [role, key === null ? null : core.modelDisplayName(core.roleChoice(role, key))]));
    return { reference, description: { file: path.relative(REPO_ROOT, path.resolve(file)).split(path.sep).join('/'), roleChoices, models,
        axes: reference.axes.length, stances: reference.stances.length, usd: result.cost, seconds: result.elapsedSeconds, calls: result.calls,
        silver: gradeResult(result, silver) } };
}

// A pipeline result graded against silver and, when a multi-stage reference is given, against that too.
function gradeBoth(result, silver, multiStage) {
    const multiStagePart = multiStage === null ? {} : { multiStage: gradeRun({ axes: result.axes, agreed: lib.stancesOfResult(result).agreed }, multiStage.reference) };
    return { ...gradeResult(result, silver), ...multiStagePart };
}

async function measureChoice({ choiceKey, silver, multiStage, thread, modelCallChat }) {
    const choice = SINGLE_CALL_CHOICES[choiceKey];
    const meter = lib.makeMeter();
    const meteredCallChat = meter.wrap(modelCallChat);
    const callsOf = stage => meter.calls.filter(call => call.stage === stage);
    const outcome = { name: choice.name, effort: choice.effort, model: choice.model };
    let single;
    try {
        single = await requestSingleCall({ choice, thread, modelCallChat: meteredCallChat });
    } catch (error) {
        if (!isOutputFailure(error)) throw error;
        outcome.oneCall = { ...failure(error), ...spent(callsOf(SINGLE_CALL_STAGE)) };
        outcome.twoCalls = outcome.oneCall;
    }
    if (single !== undefined) {
        Object.assign(outcome, { axesReturned: single.axes.length, stancesReturned: single.stances.size, warnings: single.warnings.length });
        const config = pipelineConfig(choice, thread);
        const run = (variant, secondPassByModel) => lib.runStages({ thread, config, handlers: handlersOf(single, secondPassByModel), modelCallChat: meteredCallChat, label: `${choiceKey} ${variant}` });
        outcome.oneCall = { ...gradeBoth(await run('oneCall', false), silver, multiStage), ...spent(callsOf(SINGLE_CALL_STAGE)) };
        try {
            outcome.twoCalls = { ...gradeBoth(await run('twoCalls', true), silver, multiStage), ...spent(meter.calls) };
        } catch (error) {
            if (!isOutputFailure(error)) throw error;
            outcome.twoCalls = { ...failure(error), ...spent(meter.calls) };
        }
    }
    outcome.measuredAt = new Date().toISOString();
    console.log(variantLine(`${choiceKey} oneCall`, outcome.oneCall));
    console.log(variantLine(`${choiceKey} twoCalls`, outcome.twoCalls));
    return outcome;
}

function readResults(silver, multiStage) {
    const header = { threadId: silver.threadId, title: silver.title, comments: silver.comments, chars: silver.chars, silverBuiltAt: silver.builtAt,
        multiStage: multiStage === null ? null : multiStage.description };
    const stored = fs.existsSync(RESULT_FILE) ? JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')) : null;
    // Results graded against another build of silver or another multi-stage reference do not compare with new ones.
    const comparable = stored !== null && stored.silverBuiltAt === silver.builtAt && JSON.stringify(stored.multiStage ?? null) === JSON.stringify(header.multiStage);
    return { ...header, results: comparable ? stored.results : {} };
}

function gradePipelineResultFile(file, silver, multiStage) {
    const result = readPipelineResult(file, silver);
    console.log(variantLine(file, gradeBoth(result, silver, multiStage)));
    console.log(`the run cost $${result.cost.toFixed(4)} and took ${result.elapsedSeconds} s in ${result.calls} calls, its summary call included`);
}

async function main() {
    const silver = lib.readSilver();
    const referenceFile = lib.readArgument('reference');
    const multiStage = referenceFile === null ? null : readMultiStage(referenceFile, silver);
    const pipelineResultFile = lib.readArgument('pipeline-result');
    if (pipelineResultFile !== null) {
        gradePipelineResultFile(pipelineResultFile, silver, multiStage);
        return;
    }
    const choiceKey = lib.readArgument('choice');
    const force = process.argv.includes('--force');
    if (!process.argv.includes('--all') && choiceKey === null) throw new Error('pass --choice=<key>, or --all, or --pipeline-result=<file>');
    if (choiceKey !== null && SINGLE_CALL_CHOICES[choiceKey] === undefined) throw new Error(`--choice must be one of ${Object.keys(SINGLE_CALL_CHOICES).join(', ')}`);
    const benchmark = readResults(silver, multiStage);
    const keys = Object.keys(SINGLE_CALL_CHOICES).filter(key => (choiceKey === null ? force || benchmark.results[key] === undefined : key === choiceKey));
    if (keys.length === 0) throw new Error('every choice already has a result; pass --force to measure again');
    const ledger = { spentUsd: 0, capUsd: Number(lib.readArgument('budget') ?? DEFAULT_BUDGET_USD) };
    const modelCallChat = lib.makeModelCallChat({ apiKey: lib.requireApiKey(), ledger });
    const thread = await lib.loadThread(silver.threadId);
    if (thread.comments.length !== silver.comments || lib.threadChars(thread) !== silver.chars) {
        throw new Error(`the thread snapshot (${thread.comments.length} comments) is not the one the reference was built on (${silver.comments} comments)`);
    }
    // The choices run side by side; each result is saved as it arrives.
    await Promise.all(keys.map(async key => {
        benchmark.results[key] = await measureChoice({ choiceKey: key, silver, multiStage, thread, modelCallChat });
        fs.writeFileSync(RESULT_FILE, JSON.stringify(benchmark, null, 1) + '\n', 'utf8');
    }));
    console.log(`wrote ${RESULT_FILE}; $${ledger.spentUsd.toFixed(2)} spent in this run`);
}

module.exports = { SINGLE_CALL_CHOICES, SINGLE_CALL_SCHEMA, parseSingleCall, pipelineConfig, handlersOf, gradeRun, gradeResult, referenceOfResult };
if (require.main === module) main().catch(error => {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
});
