# Matched consolidation comparison

One fresh consolidation per model on each of the same five frozen HN threads, with identical Luna-low extracted candidates and production prompts. Isolated sequential consolidation calls with rotated model order. The same Luna-low scorer runs two passes per output with shuffled axes and swapped poles, at concurrency 10. One Sonnet 5 medium-effort review per thread sees all 4 anonymous variants in rotated order and uses one common eligibility list. Reviews run at concurrency 2 alongside scoring after all consolidation timing is complete.

| Model | Cost / 1k comments | Minutes / 1k comments | Two-sided / 1k comments | Axes flagged | Candidates preserved |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-6 Astra (low) | $0.49 | 2.0 | 86.7 | 3.3% (5/150) | 73.5% (164/223) |
| Gemini 3.8 Flash (default) | $0.16 | 1.8 | 47.8 | 7.8% (5/64) | 34.1% (76/223) |
| Claude Opus 5 (adaptive) | $0.87 | 6.1 | 83.5 | 7.5% (9/120) | 61.9% (138/223) |
| GPT-5.6 Sol (low) | $0.11 | 1.9 | 101.3 | 2.4% (4/164) | 79.4% (177/223) |

- **cost:** Consolidation only, including format repairs. Token usage repriced at the same dated catalog: uncached input rate plus output rate (including billed reasoning tokens). Divide total by total source comments and multiply by 1000. Excludes extraction, scoring, summaries and evaluation reviews.
- **time:** Consolidation service wall seconds including format repairs, summed over threads, divided by total comments and multiplied by 1000. No local response-cache hits or concurrent generation calls. Provider caching/routing and ordinary latency variation remain.
- **twoSided:** 1000 * total axes with verified people on both poles / total source comments.
- **flagged:** 100 * distinct output axes with at least one concrete review issue / total output axes; count an axis only once per thread.
- **preserved:** 100 * fully preserved candidates / (all candidates minus common legitimate exclusions). Partial and missing candidates remain in the denominator. The same denominator applies to every model.

- Five threads, one generation per model per thread; repeatability and article quality are not measured.
- The common Sonnet reviewer is an uncalibrated model judge and shares a provider/model family with Opus.
- Candidate preservation measures the frozen extractor output, not all disagreements in the original discussion.
- Other selector models retain earlier measurements and are outside this matched experiment.

Completed 2026-09-13T02:37:27.955Z. Total new evaluation spend: $5.243007. Raw requests, responses and frozen sources: outputs/consolidation-matched/.

The retained JSON includes per-thread measurements, anonymous mappings, common exclusions, and every review issue. Evaluation design follows the model-grading considerations in [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

Protocol adjustment before any completed grade: The first Sonnet default-effort review used all 24,000 output tokens for reasoning and returned no grade. Before any completed review, all five reviews were set to medium effort with a 32,000-token output ceiling. Scoring and up to two reviews run concurrently after isolated consolidation calls finish. Cost of the ungraded attempt is included in total evaluation spending.

When a complete grade omitted a required explanation, a separate evidence-completion call supplied only the missing explanation and references. It did not change candidate classifications or axis flags. Those calls are included in evaluation spending and retained in each review log.
