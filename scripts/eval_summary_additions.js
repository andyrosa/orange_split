// Adds new summary models to the frozen matched summary experiment without re-grading the existing eight.
// Reuses its frozen core and the shared Sol-low consolidation and Luna-low scoring rows; one Astra-high
// review per thread grades only the added summaries.
// node scripts/eval_summary_additions.js --run [--out-dir=outputs/summary-additions]
const fs = require('node:fs');
const path = require('node:path');
const { hash, makeClient } = require('./eval_consolidation_matched');
const { RUBRIC, SCHEMA } = require('./eval_summary_quality');
const { POLICY, generate, validateMatchedReview, loadSummaryCore, read, save } = require('./eval_summary_matched');
const BASE_DIR = 'outputs/summary-matched';
// Each review reserves about $4.90 before sending (full input at byte count plus the output ceiling).
const BUDGET_USD = 8;
const REVIEW_CONCURRENCY = 1;
// The same added profiles as the consolidation additions; the summary role reuses them.
const ADDITIONS = Object.freeze({
    sol6Low: { name: 'GPT-6 Sol', effort: 'low', model: 'openai/gpt-6-sol', sampling: 'seedOnly', reasoning: { effort: 'low' } },
    opus55: { name: 'Claude Opus 5.5', effort: 'adaptive', model: 'anthropic/claude-opus-5.5', sampling: null, reasoning: null },
});
const MODELS = Object.keys(ADDITIONS);
// Opus 5.5 rejects the synthesis schema's lookaround pattern (HTTP 400 from every provider, before generation).
// The frozen core gets the production fix: the lookaround-free pattern OpenAI models already receive. Requests
// for every model other than Opus 5.5 are unchanged.
const CORE_ADJUSTMENT = Object.freeze({
    reason: 'Opus 5.5 rejects regex lookaround in the synthesis schema; it receives the lookaround-free pattern already sent to OpenAI models, as in production.',
    find: "    if (!request.model.startsWith('openai/') || request.schema.name !== 'thread_synthesis') return request.schema.schema;",
    replace: "    if (!(request.model.startsWith('openai/') || request.model === 'anthropic/claude-opus-5.5') || request.schema.name !== 'thread_synthesis') return request.schema.schema;",
});
function adjustCore(baseSource) {
    const occurrences = baseSource.split(CORE_ADJUSTMENT.find).length - 1;
    if (occurrences !== 1) throw Error('Core adjustment target found ' + occurrences + ' times');
    return baseSource.replace(CORE_ADJUSTMENT.find, CORE_ADJUSTMENT.replace);
}
function additionConfig(core, key) {
    const addition = ADDITIONS[key];
    if (!addition) throw Error('Unknown added model: ' + key);
    const sampling = addition.sampling === 'seedOnly' ? { seed: core.SUMMARY_MODELS.solLow.config.samplingSynthesize.seed } : addition.sampling;
    if (addition.sampling === 'seedOnly' && !Number.isInteger(sampling.seed)) throw Error('Frozen core has no Sol seed');
    return { ...core.DEFAULT_CONFIG, ...core.buildStageConfig(POLICY.volume, POLICY.consolidation, POLICY.consolidation),
        modelSynthesize: addition.model, samplingSynthesize: sampling, reasoningSynthesize: addition.reasoning,
        maxTokensSynthesize: core.SUMMARY_MODELS.solLow.config.maxTokensSynthesize };
}
function summaryRequest(core, item, key) {
    const config = additionConfig(core, key);
    return { stage: 'synthesize', ...core.stageSettings(config, 'synthesize'),
        messages: core.buildSynthesisMessages(item.thread.title, item.rows, core.indexCommentsById(item.thread.comments)),
        schema: core.SYNTHESIS_SCHEMA, meta: { axisIds: item.rows.slice(0, 40).map(row => row.axisId) } };
}
// The matched review request, with the rubric's original two-summary wording kept for two variants.
function reviewRequest(core, item, variants) {
    if (variants.length !== 2) throw Error('The two-summary rubric needs exactly two variants');
    const schema = structuredClone(SCHEMA);
    schema.properties.grades.items.properties.variant.enum = variants.map(v => v.label);
    const rubric = RUBRIC.replace("each variant's supplied axis/evidence context", 'the shared citationEvidence supplied once for all variants')
        + ' A variant marked unavailable failed production validation after its one repair and would not be shown to the user. Give it 0 for all three dimensions, empty issues and omissions, and explain that no usable summary was produced. Do not infer content for an unavailable summary.';
    return { stage: 'summaryQuality', model: POLICY.evaluator, reasoning: { effort: POLICY.effort }, sampling: null,
        maxTokens: POLICY.maxTokens, schema: { name: 'summary_addition_quality_v1', schema },
        messages: [{ role: 'system', content: rubric }, { role: 'user', content: JSON.stringify({
            title: item.thread.title, comments: item.thread.comments.map(({ id, parentId, text }) => ({ id, parentId, text })),
            citationEvidence: JSON.parse(core.buildSynthesisMessages(item.thread.title, item.rows, core.indexCommentsById(item.thread.comments))[1].content),
            variants }) }] };
}
async function review(core, client, item, variants) {
    const request = reviewRequest(core, item, variants), log = [hash(request)];
    let response;
    try {
        response = await client.call(request);
        validateMatchedReview(response.json, item, variants);
    } catch (error) {
        if (!response && !core.isResponseFailure(error)) throw error;
        const repair = core.buildFormatRepairCall(request, { message: error.message, response: response?.json ?? error.response });
        log.push(hash(repair));
        response = await client.call(repair);
        validateMatchedReview(response.json, item, variants);
    }
    return { review: response.json, log };
}
async function main() {
    const arg = (name, fallback) => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
    const root = path.resolve(arg('out-dir', 'outputs/summary-additions'));
    const base = path.resolve(BASE_DIR);
    fs.mkdirSync(root, { recursive: true });
    const baseFixture = read(path.join(base, 'fixture.json'));
    const baseSource = fs.readFileSync(path.join(base, 'core.js'), 'utf8');
    if (hash(baseSource) !== baseFixture.coreHash) throw Error('Base core differs from the matched summary experiment');
    const sourceFile = path.join(root, 'core.js');
    if (!fs.existsSync(sourceFile)) fs.writeFileSync(sourceFile, adjustCore(baseSource));
    const source = fs.readFileSync(sourceFile, 'utf8');
    if (source !== adjustCore(baseSource)) throw Error('Core differs from the adjusted matched summary core');
    const core = loadSummaryCore(source);
    const fixtureFile = path.join(root, 'fixture.json');
    if (!fs.existsSync(fixtureFile)) {
        for (const item of baseFixture.items) {
            if (item.sourceHash !== hash(item.thread) || item.rowsHash !== hash(item.rows)) throw Error('Matched summary input changed');
        }
        save(fixtureFile, { experiment: 'summary-additions-v1', createdAt: new Date().toISOString(), baseExperiment: baseFixture.experiment,
            coreHash: hash(source), baseCoreHash: baseFixture.coreHash, adjustments: [CORE_ADJUSTMENT], models: MODELS, additions: ADDITIONS, policy: POLICY, budget: BUDGET_USD, items: baseFixture.items });
    }
    const fixture = read(fixtureFile);
    if (fixture.budget !== BUDGET_USD) throw Error('Frozen budget ' + fixture.budget + ' differs from ' + BUDGET_USD);
    if (fixture.coreHash !== hash(source) || JSON.stringify(fixture.adjustments) !== JSON.stringify([CORE_ADJUSTMENT]) || JSON.stringify(fixture.models) !== JSON.stringify(MODELS)
        || JSON.stringify(fixture.additions) !== JSON.stringify(ADDITIONS) || JSON.stringify(fixture.policy) !== JSON.stringify(POLICY)) throw Error('Frozen addition settings changed');
    for (const item of fixture.items) {
        if (item.sourceHash !== hash(item.thread) || item.rowsHash !== hash(item.rows)) throw Error('Frozen summary input changed');
    }
    const ids = [...MODELS.map(key => ADDITIONS[key].model), POLICY.evaluator];
    const priceFile = path.join(root, 'prices.json');
    if (!fs.existsSync(priceFile)) {
        const response = await fetch('https://openrouter.ai/api/v1/models');
        if (!response.ok) throw Error('Cannot obtain model prices: HTTP ' + response.status);
        const catalog = await response.json();
        save(priceFile, { fetchedAt: new Date().toISOString(), source: 'https://openrouter.ai/api/v1/models',
            models: Object.fromEntries(ids.map(id => { const model = catalog.data.find(m => m.id === id); if (!model) throw Error('Missing model: ' + id); return [id, model.pricing]; })) });
    }
    const prices = read(priceFile).models;
    for (const id of ids) if (!prices[id]) throw Error('Price snapshot missing model: ' + id);
    if (!process.argv.includes('--run')) {
        console.log(JSON.stringify({ prepared: fixture.experiment, threads: fixture.items.length, summaries: fixture.items.length * MODELS.length, budget: fixture.budget }));
        return;
    }
    if (!process.env.OPENROUTER_API_KEY) throw Error('OPENROUTER_API_KEY required');
    const client = makeClient(core, root, prices, fixture.budget);
    const log = message => console.log(new Date().toISOString() + ' ' + message + '; spent $' + client.budget.spent.toFixed(4));
    const orderFor = index => MODELS.slice(index % MODELS.length).concat(MODELS.slice(0, index % MODELS.length));
    const generationJobs = fixture.items.map((item, index) => async () => {
        for (const key of orderFor(index)) {
            const file = path.join(root, item.id + '-' + key + '.json');
            if (fs.existsSync(file)) continue;
            log(item.id + ' ' + key + ': summary');
            const result = await generate(core, client, summaryRequest(core, item, key));
            save(file, { id: item.id, key, sourceHash: item.sourceHash, rowsHash: item.rowsHash, ...result });
            log(item.id + ' ' + key + (result.summary ? ': summary complete' : ': summary unavailable after repair'));
        }
    });
    const reviewJobs = fixture.items.map((item, index) => async () => {
        const order = orderFor(index);
        const file = path.join(root, item.id + '-review.json');
        if (fs.existsSync(file)) return;
        const anonymousOrder = [...order].reverse();
        const variants = anonymousOrder.map((key, i) => {
            const run = read(path.join(root, item.id + '-' + key + '.json'));
            return { label: 'V' + (i + 1), summary: run.summary ?? { sections: [], caveats: [] }, unavailable: !run.summary };
        });
        log(item.id + ': anonymous addition review');
        const result = await review(core, client, item, variants);
        save(file, { id: item.id, mapping: Object.fromEntries(anonymousOrder.map((key, i) => ['V' + (i + 1), key])), ...result });
        log(item.id + ': review complete');
    });
    // Reviews run after generation at REVIEW_CONCURRENCY, so only one worst-case review reservation is held at a time.
    for (const [jobs, concurrency] of [[generationJobs, POLICY.concurrency], [reviewJobs, REVIEW_CONCURRENCY]]) {
        const results = await core.runPool(jobs.map(job => () => job().then(() => null, error => error)), concurrency);
        const failures = results.filter(Boolean);
        if (failures.length) throw failures[0];
    }
    save(path.join(root, 'completion.json'), { completedAt: new Date().toISOString(), spent: client.budget.spent, budget: fixture.budget });
    log('Summary addition experiment complete');
}
module.exports = { ADDITIONS, MODELS, BASE_DIR, CORE_ADJUSTMENT, adjustCore, additionConfig, summaryRequest, reviewRequest, review };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
