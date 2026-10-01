# Consolidation additions

Same five frozen HN threads, 233 Luna-low candidates, frozen production core and consolidation settings as consolidation-matched-eight-v1; only the model differs. Isolated sequential consolidation calls, model order rotating by thread. The same two-pass Luna-low scoring at concurrency 10. One Sonnet 5 medium-effort review per thread sees only the 2 added anonymous variants, with each thread's common exclusion list from the matched review supplied as fixed.

| Model | Cost / 1k comments | Minutes / 1k comments | Two-sided / 1k comments | Axes flagged | Candidates preserved |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-6.1 Sol (low) | $0.10 | 2.8 | 85.1 | 6.9% (10/144) | 71.5% (158/221) |
| Claude Sonnet 5.5 (adaptive) | $0.23 | 2.1 | 89.1 | 12.2% (17/139) | 73.3% (162/221) |

- The added models are graded in a separate review call from the matched eight. The candidate denominator is identical, but the reviewer sees different companion outputs, which can shift grades.
- Five threads, one accepted output per model per thread; model judgments, not calibrated accuracy.
- The Sonnet reviewer shares a provider/model family with Opus 5.5.
- Prices come from a later catalog snapshot than the matched experiment; costs use uncached token prices.

Completed 2026-10-01T02:05:07.223Z. Evaluation spend: $1.826643. Raw requests and responses: outputs/consolidation-additions-2/.

