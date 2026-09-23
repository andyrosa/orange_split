// Measures GPT-6 Luna low as an extraction and scoring model on the frozen stance-review thread.
// Runs production extraction, Sol-low consolidation and two-pass scoring at production concurrency, a
// GPT-5.6 Luna low reference run on the same thread, and a blind Astra-high review of up to 100 sampled
// GPT-6 Luna stances. No summary is generated.
// node scripts/eval_volume_addition.js --run [--out-dir=outputs/volume-addition]
const fs = require('node:fs');
const path = require('node:path');
const { hash, loadExperimentCore, makeClient } = require('./eval_consolidation_matched');
const { read, save } = require('./eval_summary_matched');
const { POLICY: REVIEW_POLICY, population, selectSample, makeCases, reviewRequest, validateReview, normalizeReviewQuotes } = require('./eval_volume_review');
const BASE_DIR = 'outputs/volume-review-holes';
const CACHE_FILE = 'hn-split-cache-2026-09-12T18-35-31-970Z.json';
const OMIT_SUMMARY = 'Summary deliberately omitted in extraction/scoring experiment';
const POLICY = Object.freeze({ version: 1, model: 'luna6Low', reference: 'lunaLow', consolidation: 'solLow', budget: 4,
    addition: { name: 'GPT-6 Luna', effort: 'low', model: 'openai/gpt-6-luna', sampling: 'seedOnly', reasoning: { effort: 'low' } } });
function pipelineConfig(core, key) {
    const config = { ...core.DEFAULT_CONFIG, ...core.buildStageConfig(POLICY.reference, POLICY.consolidation), budgetUsd: POLICY.budget };
    if (key === POLICY.reference) return config;
    if (key !== POLICY.model) throw Error('Unknown extraction/scoring model: ' + key);
    const sampling = { seed: core.VOLUME_MODELS.lunaLow.config.samplingExtract.seed };
    if (!Number.isInteger(sampling.seed)) throw Error('Frozen core has no Luna seed');
    for (const stage of ['Extract', 'Score']) {
        config['model' + stage] = POLICY.addition.model;
        config['sampling' + stage] = sampling;
        config['reasoning' + stage] = POLICY.addition.reasoning;
    }
    return config;
}
async function main() {
    const arg = (name, fallback) => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
    const root = path.resolve(arg('out-dir', 'outputs/volume-addition'));
    const base = path.resolve(BASE_DIR);
    fs.mkdirSync(root, { recursive: true });
    const baseFixture = read(path.join(base, 'fixture.json'));
    const imported = read(path.resolve(CACHE_FILE));
    const sourceFile = path.join(root, 'core.js');
    if (!fs.existsSync(sourceFile)) fs.copyFileSync(path.join(base, 'core.js'), sourceFile);
    const source = fs.readFileSync(sourceFile, 'utf8');
    if (hash(source) !== baseFixture.coreHash || hash(imported) !== baseFixture.cacheHash || hash(baseFixture.thread) !== baseFixture.sourceHash) throw Error('Frozen stance-review input changed');
    const core = loadExperimentCore(source);
    const fixtureFile = path.join(root, 'fixture.json');
    if (!fs.existsSync(fixtureFile)) {
        save(fixtureFile, { experiment: 'volume-addition-v1', createdAt: new Date().toISOString(), baseExperiment: baseFixture.experiment, policy: POLICY,
            reviewPolicy: REVIEW_POLICY, sourceHash: baseFixture.sourceHash, coreHash: baseFixture.coreHash, cacheHash: baseFixture.cacheHash,
            fetchedAt: baseFixture.fetchedAt, thread: baseFixture.thread });
    }
    const fixture = read(fixtureFile);
    if (hash(source) !== fixture.coreHash || hash(imported) !== fixture.cacheHash || hash(fixture.thread) !== fixture.sourceHash
        || JSON.stringify(fixture.policy) !== JSON.stringify(POLICY) || JSON.stringify(fixture.reviewPolicy) !== JSON.stringify(REVIEW_POLICY)) throw Error('Frozen experiment changed');
    const ids = [...new Set([POLICY.addition.model, core.VOLUME_MODELS.lunaLow.config.modelExtract,
        core.CONSOLIDATION_MODELS[POLICY.consolidation].config.modelConsolidate, REVIEW_POLICY.reviewer])];
    const priceFile = path.join(root, 'prices.json');
    if (!fs.existsSync(priceFile)) {
        const response = await fetch('https://openrouter.ai/api/v1/models');
        if (!response.ok) throw Error('Cannot obtain current prices: HTTP ' + response.status);
        const catalog = await response.json();
        save(priceFile, { fetchedAt: new Date().toISOString(), source: 'https://openrouter.ai/api/v1/models', models: Object.fromEntries(ids.map(id => {
            const model = catalog.data.find(m => m.id === id); if (!model) throw Error('Missing model: ' + id); return [id, model.pricing];
        })) });
    }
    const prices = read(priceFile).models;
    for (const id of ids) if (!prices[id]) throw Error('Price snapshot missing model: ' + id);
    if (!process.argv.includes('--run')) { console.log(JSON.stringify({ prepared: fixture.experiment, comments: fixture.thread.comments.length, budget: POLICY.budget })); return; }
    if (!process.env.OPENROUTER_API_KEY) throw Error('OPENROUTER_API_KEY required');
    const client = makeClient(core, root, prices, POLICY.budget);
    const log = text => console.log(new Date().toISOString() + ' ' + text + '; spent $' + client.budget.spent.toFixed(4));
    async function pipeline(key) {
        const file = path.join(root, key + '-pipeline.json');
        if (fs.existsSync(file)) return;
        const calls = [], importedKeys = new Set(), stageStarts = {};
        const cached = core.makeCachedCallChat(async call => {
            const { signal, ...request } = call;
            return client.call(request);
        }, {
            get(cacheKey) {
                const saved = path.join(root, 'cache', cacheKey + '.json');
                if (fs.existsSync(saved)) return read(saved);
                const hit = imported.entries[core.CONSTANTS.CACHE_KEY_PREFIX + cacheKey];
                if (hit?.billingResponse) throw Error('Unresolved imported billing; cannot repeat request');
                if (hit) importedKeys.add(cacheKey);
                return hit;
            },
            set(cacheKey, value) { save(path.join(root, 'cache', cacheKey + '.json'), value); },
        });
        const config = pipelineConfig(core, key);
        const started = Date.now();
        const result = await core.runPipeline({ thread: fixture.thread, config,
            onProgress: update => {
                if (stageStarts[update.stage] === undefined) { stageStarts[update.stage] = (Date.now() - started) / 1000; log(key + ': ' + update.stage); }
            },
            callChat: async call => {
                if (call.stage === 'synthesize') throw Error(OMIT_SUMMARY);
                const { signal, ...request } = call;
                calls.push({ requestHash: hash(request), cacheKey: core.requestCacheKey(request), stage: request.stage, model: request.model });
                return cached(call);
            } });
        if (result.synthesisError !== OMIT_SUMMARY || !result.rows.length) throw Error('Incomplete scoring pipeline: ' + key);
        save(file, { key, sourceHash: fixture.sourceHash, config, stageStarts, result, calls, importedKeys: [...importedKeys] });
        log(key + ': ' + result.candidates.length + ' candidates, ' + population(result).length + ' stances');
    }
    // The measured model runs alone first so its stage timing has no concurrent generation traffic.
    await pipeline(POLICY.model);
    await pipeline(POLICY.reference);
    const sample = { [POLICY.model]: selectSample(read(path.join(root, POLICY.model + '-pipeline.json')).result, POLICY.model) };
    const selected = makeCases(fixture.thread, sample);
    const selectionFile = path.join(root, 'sample.json');
    if (fs.existsSync(selectionFile) && hash(read(selectionFile)) !== hash(selected)) throw Error('Frozen review sample changed');
    save(selectionFile, selected);
    const batches = Array.from({ length: Math.ceil(selected.cases.length / REVIEW_POLICY.reviewBatchSize) },
        (_, index) => selected.cases.slice(index * REVIEW_POLICY.reviewBatchSize, (index + 1) * REVIEW_POLICY.reviewBatchSize));
    const results = await core.runPool(batches.map((cases, index) => async () => {
        const file = path.join(root, 'review-' + index + '.json');
        if (fs.existsSync(file)) return null;
        const request = reviewRequest(fixture.thread, cases), traceKeys = [hash(request)];
        let response, quoteNormalizations = [];
        try {
            log('Blind review ' + (index + 1) + '/' + batches.length + ': ' + cases.length + ' cases');
            try { response = await client.call(request); validateReview(response.json, cases); }
            catch (error) {
                if (!response && !core.isResponseFailure(error)) throw error;
                const repair = core.buildFormatRepairCall(request, { message: error.message, response: response?.json ?? error.response });
                traceKeys.push(hash(repair)); response = await client.call(repair);
                const normalized = normalizeReviewQuotes(response.json, cases);
                response = { ...response, json: normalized.review }; quoteNormalizations = normalized.changes;
                validateReview(response.json, cases);
            }
        } catch (error) { return error; }
        save(file, { index, caseIds: cases.map(c => c.caseId), response: response.json, traceKeys, quoteNormalizations });
        log('Blind review ' + (index + 1) + ': complete');
        return null;
    }), REVIEW_POLICY.reviewConcurrency);
    const failure = results.find(Boolean);
    if (failure) throw failure;
    save(path.join(root, 'completion.json'), { completedAt: new Date().toISOString(), spent: client.budget.spent, budget: POLICY.budget });
    log('Extraction/scoring addition complete');
}
module.exports = { POLICY, BASE_DIR, CACHE_FILE, pipelineConfig };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
