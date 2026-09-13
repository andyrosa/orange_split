# Matched consolidation comparison

One accepted consolidation output per model on each of the same five frozen HN threads, with identical Luna-low extracted candidates and production prompts. Isolated sequential consolidation calls. The first four models reuse the earlier rotated-order experiment; the added models run Sonnet, GLM, Luna max, then Fable on each thread. The same Luna-low scorer runs two passes per output with shuffled axes and swapped poles, at concurrency 10. One Sonnet 5 medium-effort review per thread sees all 8 anonymous variants in rotated order and uses one common eligibility list. Reviews run at concurrency 2 alongside scoring after all consolidation timing is complete.

| Model | Cost / 1k comments | Minutes / 1k comments | Two-sided / 1k comments | Axes flagged | Candidates preserved |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-6 Astra (low) | $0.49 | 2.0 | 86.7 | 4.7% (7/150) | 71.9% (159/221) |
| Gemini 3.8 Flash | $0.16 | 1.8 | 47.8 | 7.8% (5/64) | 32.1% (71/221) |
| Claude Opus 5 (adaptive) | $0.87 | 6.1 | 83.5 | 7.5% (9/120) | 57.0% (126/221) |
| GPT-5.6 Sol (low) | $0.11 | 1.9 | 101.3 | 0.6% (1/164) | 81.4% (180/221) |
| Claude Sonnet 5 (adaptive) | $0.71 | 10.0 | 70.5 | 15.7% (16/102) | 52.5% (116/221) |
| GLM 5.3 (high) | $0.49 | 18.6 | 94.8 | 4.8% (7/146) | 76.0% (168/221) |
| GPT-5.6 Luna (max) | $0.26 | 31.6 | 90.0 | 4.3% (6/139) | 70.1% (155/221) |
| Claude Fable 5.1 (low) | $0.88 | 3.0 | 64.0 | 13.0% (12/92) | 44.3% (98/221) |

- **cost:** Consolidation only, including format repairs and verified-cancellation retries. Token usage repriced at the same dated catalog: uncached input rate plus output rate (including billed reasoning tokens). Divide total by total source comments and multiply by 1000. Excludes extraction, scoring, summaries and evaluation reviews.
- **time:** Consolidation service wall seconds including format repairs and verified-cancellation retries, summed over threads, divided by total comments and multiplied by 1000. No local response-cache hits or concurrent generation calls. Provider caching/routing and ordinary latency variation remain.
- **twoSided:** 1000 * total axes with verified people on both poles / total source comments.
- **flagged:** 100 * distinct output axes with at least one concrete review issue / total output axes; count an axis only once per thread.
- **preserved:** 100 * fully preserved candidates / (all candidates minus common legitimate exclusions). Partial and missing candidates remain in the denominator. The same denominator applies to every model.

- Five threads, one accepted output per model per thread; bounded repairs and verified-cancellation retries are included in cost/time. Repeatability and article quality are not measured.
- The common Sonnet reviewer is an uncalibrated model judge; it reviews its own model and shares a provider/model family with Opus and Fable.
- Candidate preservation measures the frozen extractor output, not all disagreements in the original discussion.
- The first four models were generated earlier; their outputs and scoring are reused, and all eight outputs receive a new common review.

Completed 2026-09-13T04:46:15.498Z. Additional evaluation spend: $7.076760; total including reused experiment: $12.319767. Raw requests, responses and frozen sources: outputs/consolidation-matched-eight/.

The retained JSON includes per-thread measurements, anonymous mappings, common exclusions, and every review issue. Evaluation design follows the model-grading considerations in [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

Protocol adjustment: Eight-model extension reuses the first four generation/scoring artifacts and their paid traces. All eight variants are reviewed together with medium effort and a 64,000-token ceiling, selected before any extension grade, to accommodate the doubled review output. All related calls are included in evaluation spending.
Protocol adjustment: GLM first request timed out at 600 seconds, with cancellation and $0.38085349 billing confirmed by generation metadata. Transport timeout increased to 1800 seconds for consolidation and reviews. One bounded retry is allowed only after verified cancellation; its original charge and elapsed time remain in the model accounting. All related calls are included in evaluation spending.
Protocol adjustment: After the ordinary full-format repair, the fourth-thread review still omitted five candidate/variant classifications. One targeted same-reviewer completion fills only these unassigned pairs, preserving every existing classification, exclusion and consolidation flag. This adjustment occurred after the other reviews had completed. All related calls are included in evaluation spending.

When a complete grade omitted a required explanation, a separate evidence-completion call supplied only the missing explanation and references. It did not change candidate classifications or axis flags. Those calls are included in evaluation spending and retained in each review log.
