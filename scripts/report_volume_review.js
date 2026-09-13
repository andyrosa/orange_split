const fs = require('node:fs');
const path = require('node:path');
const { hash, loadExperimentCore } = require('./eval_consolidation_matched');
const { read, save } = require('./eval_summary_matched');
const { POLICY, population, selectSample, makeCases, reviewRequest, validateReview, normalizeReviewQuotes, aggregate } = require('./eval_volume_review');
async function buildReport(root, cacheFile = 'hn-split-cache-2026-09-12T18-35-31-970Z.json') {
    const fixture = read(path.join(root, 'fixture.json')), completion = read(path.join(root, 'completion.json'));
    const source = fs.readFileSync(path.join(root, 'core.js'), 'utf8'), core = loadExperimentCore(source);
    const imported = read(cacheFile);
    if (fixture.coreHash !== hash(source) || fixture.sourceHash !== hash(fixture.thread) || fixture.cacheHash !== hash(imported)
        || JSON.stringify(fixture.policy) !== JSON.stringify(POLICY)) throw Error('Frozen review provenance changed');
    const pipelines = {}, allRequestHashes = new Set();
    for (const key of POLICY.models) {
        const pipeline = read(path.join(root, key + '-pipeline.json'));
        if (pipeline.sourceHash !== fixture.sourceHash) throw Error('Pipeline input mismatch');
        for (const call of pipeline.calls) {
            if (call.requestHash !== hash(call.request) || call.cacheKey !== core.requestCacheKey(call.request)) throw Error('Invalid generation request identity');
            allRequestHashes.add(call.requestHash);
        }
        const cached = core.makeCachedCallChat(async () => { throw Error('Report replay needs an unrecorded generation'); }, {
            get(key) {
                const file = path.join(root, 'cache', key + '.json');
                return fs.existsSync(file) ? read(file) : imported.entries[core.CONSTANTS.CACHE_KEY_PREFIX + key];
            }, set() {},
        });
        const replay = await core.runPipeline({ thread: fixture.thread, config: pipeline.config, onProgress() {},
            callChat: call => { if (call.stage === 'synthesize') throw Error('Summary deliberately omitted in stance-review-only experiment'); return cached(call); } });
        for (const field of ['rows', 'axes', 'candidates']) if (hash(replay[field]) !== hash(pipeline.result[field])) throw Error('Recorded pipeline cannot be reproduced: ' + field);
        pipelines[key] = pipeline;
    }
    const selected = read(path.join(root, 'sample.json'));
    const expected = makeCases(fixture.thread, Object.fromEntries(POLICY.models.map(key => [key, selectSample(pipelines[key].result, key)])));
    if (hash(selected) !== hash(expected)) throw Error('Sample differs from fixed sampling rule');
    const judgments = [], reviews = [];
    for (let offset = 0, index = 0; offset < selected.cases.length; offset += POLICY.reviewBatchSize, index++) {
        const cases = selected.cases.slice(offset, offset + POLICY.reviewBatchSize), reviewed = read(path.join(root, 'review-' + index + '.json'));
        validateReview(reviewed.response, cases);
        if (reviewed.traceKeys[0] !== hash(reviewRequest(fixture.thread, cases))) throw Error('Review input mismatch');
        for (const key of reviewed.traceKeys) allRequestHashes.add(key);
        const final = read(path.join(root, 'traces', reviewed.traceKeys.at(-1) + '.json'));
        const normalized = normalizeReviewQuotes(final.response.json, cases);
        if (hash(normalized.review) !== hash(reviewed.response)
            || hash(normalized.changes) !== hash(reviewed.quoteNormalizations || [])) throw Error('Review output mismatch');
        judgments.push(...reviewed.response.judgments); reviews.push(reviewed);
    }
    const recoveryFile = path.join(root, 'provider-recovery.json');
    const recovery = fs.existsSync(recoveryFile) ? read(recoveryFile) : null;
    let spent = 0;
    if (recovery) {
        const interrupted = fs.readdirSync(path.join(root, 'interrupted-traces')).filter(file => file.endsWith('.json'))
            .map(file => read(path.join(root, 'interrupted-traces', file)));
        if (interrupted.length !== recovery.generations.length || new Set(recovery.generations.map(x => x.id)).size !== interrupted.length
            || hash(interrupted.map(x => x.key).sort()) !== hash(recovery.interruptedRequestHashes.slice().sort())) throw Error('Interrupted request ledger mismatch');
        for (const generation of recovery.generations) {
            if (!generation.cancelled || !Number.isFinite(generation.total_cost)) throw Error('Unresolved interrupted billing');
            spent += generation.total_cost;
        }
    }
    for (const file of fs.readdirSync(path.join(root, 'traces')).filter(file => file.endsWith('.json'))) {
        const trace = read(path.join(root, 'traces', file));
        if (!['complete', 'failed', 'rejected'].includes(trace.status) || trace.key !== hash(trace.request)
            || !allRequestHashes.has(trace.key)) throw Error('Unresolved or unaccounted paid request: ' + file);
        if (trace.status !== 'rejected' && !Number.isFinite(trace.usage?.cost)) throw Error('Missing billed cost');
        spent += trace.usage?.cost || 0;
    }
    if (Math.abs(spent - completion.spent) > 1e-8 || spent > POLICY.budget) throw Error('Budget ledger mismatch');
    const metrics = aggregate(selected.mapping, judgments);
    return { experiment: fixture.experiment, completedAt: completion.completedAt, spent, policy: POLICY,
        thread: { id: POLICY.threadId, title: fixture.thread.title, comments: fixture.thread.comments.length, fetchedAt: fixture.fetchedAt, sourceHash: fixture.sourceHash },
        coreHash: fixture.coreHash, cacheHash: fixture.cacheHash, providerRecovery: recovery ? {
            reason: recovery.reason, providerOnly: recovery.providerOnly, quantization: recovery.quantization,
            interruptedRequestHashes: recovery.interruptedRequestHashes, matching: recovery.matching,
            generations: recovery.generations.map(({ id, created_at, cancelled, total_cost, provider_name, generation_time }) =>
                ({ id, created_at, cancelled, total_cost, provider_name, generation_time })),
            rejectedRoutes: recovery.rejectedRoutes.map(({ key, httpStatus, provider }) =>
                ({ requestHash: key, httpStatus, provider: provider.error.metadata.provider_name, reason: provider.error.metadata.provider_error_code })),
        } : null,
        method: 'Only Gemini 3.8 Flash and GLM 5.3 Flash receive new stance-review measurements. Both run production extraction and two-pass scoring on the same frozen 592-comment thread, using Sol low consolidation and no summary. Exact matching cached calls are reused. From each model\'s reported agreed comment/axis stances, select up to 100 pairs by a fixed seeded hash before review. Astra high independently classifies anonymous cases without the generating model or proposed stance. Cases include the full comment and ancestor chain, with author names omitted; identical cases share a judgment. Review batches contain at most 50 cases, with one format repair allowed.',
        definitions: { held: 'Reviewer assigns exactly the original A/B/M/C stance.', wrong: 'Reviewer confidently assigns a different stance or N (no supported stance).',
            unclear: 'Reviewer returns U for ambiguity, insufficient context, or a defective axis. These cases stay in the denominator but count as neither held nor wrong.',
            denominator: 'All sampled agreed comment/axis stances for that model. This is stance-label accuracy, not extraction recall or the percentage of all source comments analyzed.' },
        limitations: ['One source thread and a sample of at most 100 reported stances per model. These are model judgments, not human ground truth.',
            'The other three extraction/scoring rows and existing cost, time, coverage and yield values retain their earlier measurements; this fills only four missing cells.',
            'Sampling reported agreed stances does not measure missed stances or missing extracted disagreements. Shared consolidation can affect the axes being judged.',
            'A straight apostrophe in one repaired supporting quote was restored to the source’s curly apostrophe by deterministic typography matching. Labels and explanations were unchanged; the original and exact quote are retained.',
            ...(recovery ? [`GLM initially ran on Wafer; after prolonged unusable responses, five in-flight calls were cancelled and their provider-confirmed charges retained. ${recovery.rejectedRoutes.length} provider overload rejections occurred before generation. Remaining GLM calls used ${recovery.providerOnly.join(', ')} with the same model, prompts and settings. Provider and quantization can affect results. The four simultaneous cancelled requests are reconciled as a group, without claiming a per-request ID mapping.`] : [])],
        models: Object.fromEntries(POLICY.models.map(key => [key, { name: core.VOLUME_MODELS[key].name, ...metrics[key],
            population: population(pipelines[key].result).length, extractionConfig: pipelines[key].config, importedCalls: pipelines[key].importedKeys.length,
            generationRequests: pipelines[key].calls.map(({ requestHash, cacheKey }) => ({ requestHash, cacheKey })),
            sample: selected.mapping[key].map(pair => ({ ...pair, judgment: judgments.find(j => j.caseId === pair.caseId) })) }])), reviews };
}
function markdown(report) {
    const lines = ['# Flash extraction/scoring: missing stance-review cells', '', report.method, '',
        '| Model | Sampled stances | Held | Wrong | Unclear |', '| --- | ---: | ---: | ---: | ---: |'];
    for (const value of Object.values(report.models)) lines.push(`| ${value.name} | ${value.sampled} / ${value.population} | ${value.reviewHeldPercent.toFixed(1)}% | ${value.reviewWrongPercent.toFixed(1)}% | ${(100 * value.unclear / value.sampled).toFixed(1)}% |`);
    lines.push('', ...Object.entries(report.definitions).map(([key, text]) => `- ${key}: ${text}`), '', ...report.limitations.map(text => '- ' + text), '',
        `New cost: $${report.spent.toFixed(6)}. Raw requests and responses are retained in outputs/volume-review-holes. data/volume-review-holes.json retains every sampled label, review judgment and request hash.`, '');
    return lines.join('\n');
}
async function main() {
    const root = path.resolve(process.argv.find(a => a.startsWith('--out-dir='))?.slice(10) || 'outputs/volume-review-holes');
    const report = await buildReport(root);
    save(path.join(root, 'report.json'), report); fs.writeFileSync(path.join(root, 'report.md'), markdown(report));
    if (process.argv.includes('--write-data')) { save('data/volume-review-holes.json', report); fs.writeFileSync('docs/volume-review-holes.md', markdown(report)); }
    console.log(markdown(report));
}
module.exports = { buildReport, markdown };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
