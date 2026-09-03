// Loads the <script id="core"> block out of the page and evaluates it as a CommonJS module.
// This is the project's only packaging seam: the page stays a single file with no build step,
// and Node consumers (the runner, the tests) share the exact same code.
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '..', 'hn_polarization.html');
const CORE_SCRIPT_PATTERN = /<script id="core">([\s\S]*?)<\/script>/;

function loadCore() {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const match = html.match(CORE_SCRIPT_PATTERN);
    if (!match) {
        throw new Error('core script block not found in ' + HTML_PATH);
    }
    const moduleShim = { exports: {} };
    new Function('module', match[1])(moduleShim);
    return moduleShim.exports;
}

module.exports = { loadCore };
