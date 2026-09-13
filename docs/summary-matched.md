# Matched summary model comparison

Eight summary models each receive identical frozen Sol-low consolidation and two-pass Luna-low scoring results on the same five threads (1,234 comments). Production summary prompts, reasoning settings and 16,000-token ceilings; one output per model per thread, with at most one production format repair. Five independent thread workers rotate generation order. Each completed thread receives one Astra-high review of all eight anonymous outputs in rotated/reversed order, with complete source comments and the shared citation evidence. Generation and review calls share the five-worker pool.

| Model | Quality /100 | Failed / major error | Cost /1k comments | Time /1k comments |
| --- | ---: | ---: | ---: | ---: |
| Claude Fable 5.1 (low) | 87.7 | 0% | $1.27 | 2.1 min |
| Claude Opus 5 (adaptive) | 83.3 | 40% | $0.58 | 1.9 min |
| Claude Sonnet 5 (adaptive) | 70.9 | 100% | $0.19 | 1.1 min |
| Gemini 3.8 Flash | 78.4 | 60% | $0.10 | 0.9 min |
| GLM 5.3 (high) | 29.1 | 100% | $0.11 | 0.7 min |
| GPT-5.6 Luna (max) | 75.8 | 80% | $0.05 | 3.5 min |
| GPT-5.6 Sol (low) | 85.3 | 40% | $0.12 | 0.9 min |
| GPT-6 Astra (low) | 91.4 | 0% | $0.56 | 0.7 min |

- Mean of five per-thread grades: 60% faithfulness, 30% coverage, 10% clarity; each dimension uses a 0–100 rubric. A summary unavailable after its one production repair scores zero.
- Percentage of the five summaries whose review flags at least one materially unsupported claim. Counts summaries, not individual issues.
- Percentage of the five summary attempts that failed production validation after repair OR had a major support error. Each attempt counts at most once; failures and major-error counts are retained separately.
- Summary calls only, including format repairs. Reprice input and output token usage at the same catalog snapshot without cache discounts. Divide total by 1,234 comments and multiply by 1,000. Excludes extraction, consolidation, scoring and quality reviews.
- Sum summary service wall time including repairs, divided by 1,234 comments and multiplied by 1,000. Five independent thread workers; this is service latency, not total experiment makespan.

- Five HN threads and one output/review per model per thread; scores are preliminary model judgments, not statistically established ranks or article results.
- The Astra reviewer evaluates its own model and other OpenAI models; anonymity does not eliminate evaluator bias.
- Every model uses the same Sol/Luna inputs. These benchmarks compare summary choices and do not grade every possible upstream combination.
- Provider routing, caching and ordinary latency variation remain; cost is normalized to uncached prices.

Protocol adjustment: Sol rejected lookaround in the response schema before generation. Apply existing Astra provider compatibility to all OpenAI summary requests; keep prompts and local validation identical. Retain all prior successful calls. GLM failed local validation after its permitted repair, so include unavailable outputs as zero quality and count them in the combined failure/major-support-error rate; no extra generation retries.

Total new spending: $9.099880, including quality reviews. Full traces and frozen inputs are retained in outputs/summary-matched; compact per-thread grades, summaries and request hashes are in data/summary-matched.json.
