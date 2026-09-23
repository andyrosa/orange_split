# Consolidation additions

Same five frozen HN threads, 233 Luna-low candidates, frozen production core and consolidation settings as consolidation-matched-eight-v1; only the model differs. Isolated sequential consolidation calls, model order rotating by thread. The same two-pass Luna-low scoring at concurrency 10. One Sonnet 5 medium-effort review per thread sees only the 2 added anonymous variants, with each thread's common exclusion list from the matched review supplied as fixed.

| Model | Cost / 1k comments | Minutes / 1k comments | Two-sided / 1k comments | Axes flagged | Candidates preserved |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-6 Sol (low) | $0.09 | 1.2 | 100.5 | 3.1% (5/162) | 79.6% (176/221) |
| Claude Opus 5.5 (adaptive) | $0.39 | 2.2 | 98.1 | 9.4% (14/149) | 82.4% (182/221) |

- The added models are graded in a separate review call from the matched eight. The candidate denominator is identical, but the reviewer sees different companion outputs, which can shift grades.
- Five threads, one accepted output per model per thread; model judgments, not calibrated accuracy.
- The Sonnet reviewer shares a provider/model family with Opus 5.5.
- Prices come from a later catalog snapshot than the matched experiment; costs use uncached token prices.

Completed 2026-09-23T02:03:59.314Z. Evaluation spend: $2.043376. Raw requests and responses: outputs/consolidation-additions/.
