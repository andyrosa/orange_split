# Summary additions

Each added summary model receives the identical frozen Sol-low consolidation and two-pass Luna-low scoring results used by summary-matched-v1 on the same five threads (1,234 comments), with production summary prompts, reasoning settings and 16,000-token ceilings; one output per model per thread, with at most one production format repair. Each thread receives one Astra-high review of only the 2 added anonymous outputs, with complete source comments and the shared citation evidence.

| Model | Quality /100 | Failed / major error | Cost /1k comments | Time /1k comments |
| --- | ---: | ---: | ---: | ---: |
| GPT-6 Sol (low) | 90.3 | 0% | $0.11 | 0.5 min |
| Claude Opus 5.5 (adaptive) | 86.4 | 20% | $0.36 | 1.3 min |

- The added models are graded in a separate review call from the matched eight; the reviewer sees different companion summaries, which can shift grades.
- Five HN threads and one output/review per model per thread; model judgments, not statistically established ranks.
- The Astra reviewer evaluates another OpenAI model (GPT-6 Sol); anonymity does not eliminate evaluator bias.
- Opus 5.5 receives the lookaround-free paragraph pattern already sent to OpenAI models, because it rejects regex lookaround; the parser still enforces all word limits.
- Prices come from a later catalog snapshot than the matched experiment; costs use uncached token prices.

Protocol adjustment: Opus 5.5 rejects regex lookaround in the synthesis schema; it receives the lookaround-free pattern already sent to OpenAI models, as in production.

Total new spending: $3.974217, including quality reviews. Raw requests and responses: outputs/summary-additions/.
