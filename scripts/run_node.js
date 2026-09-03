// Headless runner: executes the same core pipeline as hn_polarization.html from Node.
// Usage: node scripts/run_node.js --thread=49525378 [--key=sk-or-...] [--out=result.json] [--thread-file=path] [--cache-dir=path]
//        [--config-file=path] [--volume=<key>] [--consolidation=<key>] [--model=id] [--temperature=0] [--seed=12345] [--concurrency=30]
// The OpenRouter key comes from --key, else from the OPENROUTER_API_KEY environment variable.
// --thread-file reads the thread from that file when it exists; otherwise the thread is fetched and saved there.
//   A live thread gains comments over time, which changes every prompt, so reruns need the same snapshot to hit the cache.
// --cache-dir stores each finished model call as <dir>/<key>.json and reuses it on later runs.
// Config flags apply in the order given in buildConfig; later flags override earlier ones.
const fs = require('node:fs');
const path = require('node:path');
const { loadCore } = require('./load_core');

const core = loadCore();
const KEY_ENV_NAME = 'OPENROUTER_API_KEY';
const STATEMENT_INDENT = '     ';

function readArgument(name) {
    const prefix = `--${name}=`;
    const found = process.argv.find(argument => argument.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
}

// Config overrides, applied in this order so that later flags win: config file, role choices,
// one model for every stage, one sampling setting for every stage, concurrency.
function buildConfig() {
    const config = {};
    const configFile = readArgument('config-file');
    if (configFile !== null) {
        Object.assign(config, JSON.parse(fs.readFileSync(configFile, 'utf8')));
    }
    const volume = readArgument('volume');
    const consolidation = readArgument('consolidation');
    if (volume !== null || consolidation !== null) {
        Object.assign(config, core.buildStageConfig(volume || core.DEFAULT_VOLUME_KEY, consolidation || core.DEFAULT_CONSOLIDATION_KEY));
    }
    const model = readArgument('model');
    if (model !== null) {
        core.applyToAllStages(config, { model });
    }
    const temperature = readArgument('temperature');
    const seed = readArgument('seed');
    if (temperature !== null || seed !== null) {
        const sampling = {};
        if (temperature !== null) sampling.temperature = Number(temperature);
        if (seed !== null) sampling.seed = Number(seed);
        core.applyToAllStages(config, { sampling });
    }
    const concurrency = readArgument('concurrency');
    if (concurrency !== null) {
        config.concurrency = Number(concurrency);
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

// Reads the thread from threadFile when it exists, otherwise fetches it (and saves it when threadFile is given).
async function loadThreadItem(threadId, threadFile) {
    if (threadFile && fs.existsSync(threadFile)) {
        process.stderr.write(`Reading thread ${threadId} from ${threadFile}\n`);
        const item = JSON.parse(fs.readFileSync(threadFile, 'utf8'));
        if (String(item.id) !== threadId) {
            throw new Error(`${threadFile} holds thread ${item.id}, not ${threadId}`);
        }
        return item;
    }
    process.stderr.write(`Fetching thread ${threadId}\n`);
    const item = await core.fetchThreadItem(threadId);
    if (threadFile) {
        fs.writeFileSync(threadFile, JSON.stringify(item), 'utf8');
        process.stderr.write(`Saved thread snapshot to ${threadFile}\n`);
    }
    return item;
}

// Each axis prints as three lines: statement 1, statement 2, then the split bar and metrics.
function formatRow(row) {
    const metrics = `mid ${row.countM}  authors ${row.authors}  comments ${row.comments}  polar ${core.formatWithSpread(row.score, row.scoreSpread)}  cons ${core.formatWithSpread(row.consensus, row.consensusSpread)}`;
    return [
        `#${String(row.rank).padStart(3)} ${row.statementA}`,
        `${STATEMENT_INDENT}${row.statementB}`,
        `${STATEMENT_INDENT}${core.formatSplit(row)}  ${metrics}`,
    ].join('\n');
}

function report(result, elapsedSeconds) {
    for (const row of result.rows) {
        console.log(formatRow(row));
    }
    console.log('');
    for (const line of core.formatRunSummary(result)) {
        console.log(line);
    }
    console.log(`${result.warnings.length} warnings, ${core.formatDuration(elapsedSeconds)}`);
}

async function main() {
    const threadId = readArgument('thread');
    if (!threadId || !core.isThreadId(threadId)) {
        throw new Error('pass --thread=<numeric Hacker News item id>');
    }
    const apiKey = readArgument('key') || process.env[KEY_ENV_NAME];
    if (!apiKey) {
        throw new Error(`pass --key=... or set ${KEY_ENV_NAME}`);
    }
    const config = buildConfig();
    const thread = core.flattenThread(await loadThreadItem(threadId, readArgument('thread-file')));
    process.stderr.write(`${thread.title} (${thread.comments.length} comments)\n`);

    const cacheDirectory = readArgument('cache-dir');
    const directCallChat = call => core.callOpenRouter({ apiKey, request: call });
    const callChat = cacheDirectory ? core.makeCachedCallChat(directCallChat, makeFileStore(cacheDirectory)) : directCallChat;

    const startedAt = Date.now();
    const result = await core.runPipeline({
        thread,
        config,
        onProgress: update => process.stderr.write(core.formatProgress(update) + '\n'),
        callChat,
    });
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    report(result, elapsedSeconds);

    const outPath = readArgument('out');
    if (outPath) {
        fs.writeFileSync(outPath, JSON.stringify({ threadId, title: thread.title, url: thread.url, elapsedSeconds, ...result }, null, 2), 'utf8');
        process.stderr.write(`wrote ${outPath}\n`);
    }
}

main().catch(error => {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
});
