# IM8 Editor Brief Skill

Generates 5-10 ad-cut briefs from a Drive folder of raw IM8 footage. Each brief is a verbatim-transcript-only edit plan with interleaved B-roll directives. Designed to be run by a Slack bot when triggered with `@NoaOS editor brief <drive-link> branded|ads`.

## Inputs

- **driveFolderUrl** — Drive folder containing one or more raw video files
- **briefType** — `branded` (high-end / cinematic / polished) OR `ads` (performance / fast-cut / direct response)
- **brand** — defaults to `im8`; future-proofed for other brands
- **slackChannel + threadTs** — for ack and final reply

## Output

A single Google Doc saved to Drive folder `1Um55xGVRguvLKefqHPtDO5jOW7Snso3b` containing **5-10 distinct cuts**. Each cut varies in length, talent emphasis, narrative angle, and B-roll strategy.

Each cut row appears in the [April Ad Pipeline 2026 tab](https://docs.google.com/spreadsheets/d/1UoOw8x5QMZwPxldWPTDWGiPzQjGWt7gyf7H93QIKEXQ) automatically once generated.

Slack reply (threaded in `C0ASDVB3FB8`): summary line with cut count, length range, source video count, Doc link.

## Hard rules

1. **Spoken lines are VERBATIM transcript text only.** Cite every line as `Tn · Lx-y` where `n` is the source-transcript number and `x-y` is the line range. Never paraphrase, invent dialogue, or stitch fragments without `+` notation.
2. **B-roll = creative direction only.** `[B-ROLL]` directive rows describe what the editor cuts to. They do not need to come from the transcripts — they describe visuals available in the source folder or stock.
3. **No invention.** If a beat can't be filled from the transcripts, output `[GAP: needs additional footage / re-shoot — describe what's missing]`. Never paper over a gap.
4. **Brand exclusion rules apply.** See `brand-rules/im8.md` — IM8 currently excludes "instant impact" / "I felt it immediately" claims for compliance reasons. If a usable line abuts an excluded one, add `[NOTE — EDITOR: cut around Lx]`.
5. **Cut diversity.** No two cuts may pull the same line set. Vary by length (30s / 45s / 60s / 90s), talent emphasis, narrative angle, and B-roll strategy.
6. **Match the format of `references/examples/im8-ad-cut-briefs-example.md` exactly.** Tables, headers, structure all the same.

## Cut count guidance

- 1-2 source videos / under 10 min total transcript → 5 cuts
- 3 source videos / 10-25 min total → 6-7 cuts
- 4+ source videos / 25+ min total → 8-10 cuts

Each cut must justify its existence with a distinct angle. If the source material genuinely supports only 5 cuts, output 5 — do not pad.

## Files

- `prompts/high-end-branded.md` — branded mode rules (cinematic, clean, polished)
- `prompts/ads.md` — performance/ads mode rules (fast-cut, hook-driven, conversion)
- `brand-rules/im8.md` — IM8-specific exclusions, anchors, end-frame spec
- `shared-rules.md` — transcript-only enforcement, citation format, GAP handling

## Trigger

Slack mention in `C0ASDVB3FB8`:

```
@NoaOS editor brief https://drive.google.com/drive/folders/<id> branded
@NoaOS editor brief https://drive.google.com/drive/folders/<id> ads
```

## Pipeline

`scripts/content-sync/im8-editor-brief.js` orchestrates:
1. Resolve folder ID from URL
2. List videos via `listFiles()` from `drive-helpers.js`
3. Transcribe each via `transcribeVideo()` from `lib/transcribe.js`. Number transcripts T1, T2, T3...
4. Add line numbers to each transcript so cuts can cite `T2 · L92-104`
5. Load shared rules + brand rules + style prompt + the example doc as few-shot
6. Call Claude (Sonnet 4, retry pattern, max_tokens 16000+)
7. Validate every `VERBATIM TRANSCRIPT LINE` row exists in source
8. Upload Google Doc to Drive folder `1Um55xGVRguvLKefqHPtDO5jOW7Snso3b`
9. Append rows to "April Ad Pipeline 2026" tab via `lib/im8-tracker.js` `appendAdCutRow()`
10. Post threaded reply in `C0ASDVB3FB8` with Doc link + sheet row count
