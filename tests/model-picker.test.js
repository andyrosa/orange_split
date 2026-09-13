const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadCore } = require('../scripts/load_core');

test('compact model pickers retain metrics, selection events and keyboard controls', () => {
    const source = fs.readFileSync(require.resolve('../hn_polarization.html'), 'utf8');
    const core = loadCore();
    const document = { activeElement: null };
    class Element extends EventTarget {
        constructor() {
            super();
            this.children = [];
            this.dataset = {};
            this.attributes = {};
            this.style = {};
            this.hidden = true;
        }
        replaceChildren(...children) { this.children = children; }
        querySelectorAll() { return this.children.filter(child => child.className?.includes('model-option')); }
        setAttribute(key, value) { this.attributes[key] = value; }
        getAttribute(key) { return this.attributes[key]; }
        focus() { document.activeElement = this; }
    }
    const makeElement = (_, { className, text } = {}) => Object.assign(new Element(), { className, textContent: text });
    const pickers = [
        [core.VOLUME_MODELS, core.VOLUME_METRIC_COLUMNS, core.volumeMetrics, 'volume'],
        [core.CONSOLIDATION_MODELS, core.CONSOLIDATION_METRIC_COLUMNS, core.consolidationMetrics, 'consolidation'],
        [core.SUMMARY_MODELS, core.SUMMARY_METRIC_COLUMNS, core.summaryMetrics, 'summary'],
    ].map(([choices, columns, metrics, role]) => ({
        choices, columns, metrics, gridClass: `${role}-grid`, metricKeys: new Set(),
        select: Object.assign(new Element(), { value: Object.keys(choices)[0] }),
        header: new Element(), button: new Element(), options: new Element(),
    }));
    pickers[2].metrics = choice => core.summaryMetrics(choice, pickers[1].select.value, pickers[0].select.value);
    const selectedQuality = () => core.summaryQualityText(pickers[2].choices[pickers[2].select.value], pickers[1].select.value, pickers[0].select.value);
    const sandbox = { document, makeElement, Event, modelPickers: pickers, summaryQualityText: core.summaryQualityText,
        perThousandCommentsRates: core.perThousandCommentsRates,
        elements: { volumeModel: pickers[0].select, consolidationModel: pickers[1].select, summaryModel: pickers[2].select,
            summaryQualityLabel: new Element(), summaryQualityScores: new Element(), summaryQualityMethod: new Element() } };
    const start = source.indexOf('function renderModelGrid(');
    const end = source.indexOf('// The thread box holds', start);
    assert.ok(start > 0 && end > start);
    vm.runInNewContext(source.slice(start, end), sandbox);
    const press = (element, key) => {
        const event = new Event('keydown', { cancelable: true });
        Object.defineProperty(event, 'key', { value: key });
        element.dispatchEvent(event);
        return event.defaultPrevented;
    };
    for (const picker of pickers) {
        let changes = 0;
        picker.select.addEventListener('change', () => {
            changes++;
            sandbox.syncModelPicker(picker);
        });
        sandbox.initializeModelPicker(picker);
        if (picker === pickers[2]) assert.equal(sandbox.elements.summaryQualityLabel.textContent, selectedQuality().label);
        assert.equal(picker.button.textContent, picker.choices[picker.select.value].name);
        assert.equal(picker.options.hidden, true);
        assert.equal(picker.options.children[0], picker.header);
        assert.equal(picker.header.children.length, picker.columns.length);
        const options = sandbox.modelOptionButtons(picker);
        assert.equal(options.length, Object.keys(picker.choices).length);
        for (const option of options) assert.equal(option.children.length, picker.columns.length);
        picker.button.dispatchEvent(new Event('click'));
        assert.equal(picker.options.hidden, false);
        assert.equal(document.activeElement, options[0]);
        assert.equal(press(options[0], 'ArrowDown'), true);
        assert.equal(document.activeElement, options[1]);
        options[1].dispatchEvent(new Event('click'));
        assert.equal(changes, 1);
        assert.equal(picker.select.value, options[1].dataset.key);
        if (picker === pickers[2]) {
            const quality = selectedQuality();
            assert.equal(sandbox.elements.summaryQualityLabel.textContent, quality.label);
            assert.equal(sandbox.elements.summaryQualityScores.textContent, quality.scores);
            assert.equal(sandbox.elements.summaryQualityMethod.textContent, quality.method);
        }
        assert.equal(picker.button.textContent, picker.choices[picker.select.value].name);
        assert.equal(options[1].getAttribute('aria-selected'), 'true');
        assert.equal(picker.options.hidden, true);
        assert.equal(document.activeElement, picker.button);
        press(picker.button, 'ArrowDown');
        assert.equal(document.activeElement, options[1]);
        press(options[1], 'End');
        assert.equal(document.activeElement, options.at(-1));
        press(options.at(-1), 'Home');
        assert.equal(document.activeElement, options[0]);
        press(options[0], 'Escape');
        assert.equal(picker.button.getAttribute('aria-expanded'), 'false');
        assert.equal(document.activeElement, picker.button);
        press(picker.button, 'ArrowDown');
        press(options[1], 'Tab');
        assert.equal(picker.options.hidden, true);
    }
    pickers[0].button.dispatchEvent(new Event('click'));
    press(pickers[1].button, 'ArrowDown');
    assert.equal(pickers[0].options.hidden, true);
    assert.equal(pickers[1].options.hidden, false);
});
