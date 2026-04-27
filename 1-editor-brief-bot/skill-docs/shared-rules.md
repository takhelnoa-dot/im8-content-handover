# Shared Rules — All IM8 Editor Briefs

These rules apply to BOTH `branded` and `ads` modes. The mode-specific prompt overlays additional rules on top.

## 1. Verbatim transcript only

Every `VERBATIM TRANSCRIPT LINE` row must contain text that exists in the supplied transcripts, exactly as transcribed. No paraphrasing. No "smoothed" wording. No combining two speakers' lines into one quote.

## 2. Citation format

Cite every transcript line as `Tn · Lx-y` where `n` is the transcript number (T1, T2, T3...) and `x-y` is the line range. If a line stitches two non-adjacent ranges, use `+`: e.g. `T2 · L103-104 + L379-382`. Single line: `T1 · L165`.

## 3. B-roll directives

`[B-ROLL]` rows are creative direction for the editor. They describe what the visual cuts to. They do NOT need to come from the transcripts. Format:

```
| [B-ROLL] | *[brief description of the visual]* |  |
```

Place B-roll rows between transcript lines to indicate where the editor cuts away from the talking head.

## 4. Gap handling

If a brief beat genuinely cannot be filled from the transcripts, output:

```
| [GAP] | *[describe what's missing — e.g. "needs DB line about NSF certification, none in transcripts"]* | needs re-shoot |
```

Never invent. Never paraphrase a related line into the missing one.

## 5. Editor notes

For compliance / brand exclusions, surround usable lines with `[NOTE]` rows:

```
| [NOTE] | *EDITOR: L96 ('I felt it immediately') sits inside this run — cut around it. Use L92-95 then splice to L98-104.* | *exclude — instant impact* |
```

## 6. Output structure (per cut)

Every cut MUST have:
- Title block: `| BRIEF NN — TITLE |` table header
- Tagline (bold, one line)
- Format / Talent / Objective / (optional) Concept tables
- "Why It Works" rationale (one paragraph, business reasoning)
- Optional `⚠ EDITOR NOTE` callout for exclusions
- Script table with columns: `SPEAKER | VERBATIM TRANSCRIPT LINE | TRANSCRIPT REF`
- `[END FRAME]` row with `[IM8 logo · NSF Certified badge]`

Match `references/examples/im8-ad-cut-briefs-example.md` exactly.

## 7. Diversity requirement

Across the 5-10 cuts you generate, no two may pull the same line set. Vary by:
- **Length**: ~30s (solo / minimal) / ~45s (single-narrative) / ~60s (dual-narrative) / ~90s (long-form expert)
- **Talent emphasis**: solo, dual, expert panel, athlete + coach, etc
- **Narrative angle**: founder story, expert validation, community proof, simplification, longevity, transformation
- **B-roll strategy**: kitchen / training / clinical / lab / community-UGC / product-detail

Each cut must justify its existence with a distinct angle. If the source genuinely supports only N cuts where N < 5, output N — do not pad.

## 8. Master sheet header

Open the document with this header (once, at top):

```
| IM8 AD CUT CREATIVE BRIEFS [source folder name] |
| :---: |

| Date [today] | Total Briefs [N] | Base Length [range] |
| :---: | :---: | :---: |

* All base videos are master cuts. Shorter cuts should be derived from these, not built separately.

*— BRIEFS FOLLOW —*
```
