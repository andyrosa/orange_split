// Loads the <script id="core"> block out of the page and evaluates it as a CommonJS module.
// This is the project's only packaging seam: the page stays a single file with no build step,
// and the Node runner shares the exact same code. Also holds the command-line helpers every script uses.
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '..', 'hn_polarization.html');
const KEY_ENV_NAME = 'OPENROUTER_API_KEY';
const CORE_SCRIPT_PATTERN = /<script id="core">([\s\S]*?)<\/script>/;

function readPage() {
    return fs.readFileSync(HTML_PATH, 'utf8');
}

// The text between a block's open and close tags, which `pattern` captures.
function blockText(html, pattern) {
    const match = html.match(pattern);
    if (!match) {
        throw new Error(`inline block ${pattern} not found in ${HTML_PATH}`);
    }
    return match[1];
}

function loadCore() {
    const moduleShim = { exports: {} };
    new Function('module', blockText(readPage(), CORE_SCRIPT_PATTERN))(moduleShim);
    return moduleShim.exports;
}

function readArgument(name) {
    const prefix = `--${name}=`;
    const found = process.argv.find(argument => argument.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
}

// The OpenRouter key: --key=..., else the environment variable named by KEY_ENV_NAME.
function requireApiKey() {
    const apiKey = readArgument('key') || process.env[KEY_ENV_NAME];
    if (!apiKey) throw new Error(`pass --key=... or set ${KEY_ENV_NAME}`);
    return apiKey;
}

// A call cache that keeps each entry as <directory>/<key>.json.
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

module.exports = { HTML_PATH, CORE_SCRIPT_PATTERN, readPage, blockText, loadCore, readArgument, requireApiKey, makeFileStore };
