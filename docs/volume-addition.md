# GPT-6 Luna extraction and scoring

GPT-6 Luna low runs production extraction, GPT-5.6 Sol low consolidation and two-pass scoring on the frozen 592-comment stance-review thread at production concurrency, with no summary. A GPT-5.6 Luna low reference run uses the same thread and settings. Up to 100 agreed GPT-6 Luna comment/axis stances, selected by a fixed seeded hash, receive the same blind Astra-high classification as the Flash stance review.

| Model | USD / million chars | Seconds / million chars | Candidates | Stances / comment | Two-sided rows / 100 comments |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-6 Luna | $0.390 | 319 | 81 | 0.41 | 5.9 |
| GPT-5.6 Luna (reference) | $1.027 | 396 | 91 | 0.50 | 6.8 |

Blind review: 86/100 held (86.0%), 8 wrong (8.0%), 6 unclear. Candidate factor 0.89; median call 8.9 s.

- stancesPerComment: Agreed comment/axis stances in the result rows divided by source comments.
- twoSidedPer100Comments: 100 * result rows with people on both poles / source comments.
- candidateFactor: Extracted candidates relative to the GPT-5.6 Luna low reference run on the same thread, whose selector factor is 1.
- cost: Extraction and scoring calls only, repriced at uncached token prices, per million characters of framed comment text.
- time: Busy wall seconds of the extraction stage plus the scoring stage (union of call intervals), per million characters.
- minimumSeconds: Median single-call latency of the extraction and scoring calls.
- held: Reviewer assigns exactly the original A/B/M/C stance.
- wrong: Reviewer confidently assigns a different stance or N.

- One source thread and a sample of at most 100 reported stances; model judgments, not human ground truth.
- The review sample contains only GPT-6 Luna stances, so its batches differ from earlier stance reviews.
- The scoring stage was interrupted once by a local file-rename error and resumed from saved responses; busy-interval timing excludes the pause.

New cost: $1.751104. Raw requests and responses: outputs/volume-addition/.
