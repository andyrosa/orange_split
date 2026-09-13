# Flash extraction/scoring: missing stance-review cells

Only Gemini 3.8 Flash and GLM 5.3 Flash receive new stance-review measurements. Both run production extraction and two-pass scoring on the same frozen 592-comment thread, using Sol low consolidation and no summary. Exact matching cached calls are reused. From each model's reported agreed comment/axis stances, select up to 100 pairs by a fixed seeded hash before review. Astra high independently classifies anonymous cases without the generating model or proposed stance. Cases include the full comment and ancestor chain, with author names omitted; identical cases share a judgment. Review batches contain at most 50 cases, with one format repair allowed.

| Model | Sampled stances | Held | Wrong | Unclear |
| --- | ---: | ---: | ---: | ---: |
| Gemini 3.8 Flash | 100 / 138 | 97.0% | 2.0% | 1.0% |
| GLM 5.3 Flash | 100 / 372 | 64.0% | 33.0% | 3.0% |

- held: Reviewer assigns exactly the original A/B/M/C stance.
- wrong: Reviewer confidently assigns a different stance or N (no supported stance).
- unclear: Reviewer returns U for ambiguity, insufficient context, or a defective axis. These cases stay in the denominator but count as neither held nor wrong.
- denominator: All sampled agreed comment/axis stances for that model. This is stance-label accuracy, not extraction recall or the percentage of all source comments analyzed.

- One source thread and a sample of at most 100 reported stances per model. These are model judgments, not human ground truth.
- The other three extraction/scoring rows and existing cost, time, coverage and yield values retain their earlier measurements; this fills only four missing cells.
- Sampling reported agreed stances does not measure missed stances or missing extracted disagreements. Shared consolidation can affect the axes being judged.
- A straight apostrophe in one repaired supporting quote was restored to the source’s curly apostrophe by deterministic typography matching. Labels and explanations were unchanged; the original and exact quote are retained.
- GLM initially ran on Wafer; after prolonged unusable responses, five in-flight calls were cancelled and their provider-confirmed charges retained. 11 provider overload rejections occurred before generation. Remaining GLM calls used morph/fp8 with the same model, prompts and settings. Provider and quantization can affect results. The four simultaneous cancelled requests are reconciled as a group, without claiming a per-request ID mapping.

New cost: $4.371401. Raw requests and responses are retained in outputs/volume-review-holes. data/volume-review-holes.json retains every sampled label, review judgment and request hash.
