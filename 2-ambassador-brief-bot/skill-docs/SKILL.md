# IM8 Ambassador Brief Skill

Generates an ambassador campaign brief (Reel + optional Story Sets + Raw Footage Package) by adapting the master template to a specific creator's voice and the chosen focus area. Designed to be triggered by Slack mention.

## Inputs (10 fields)

The slack command supplies these (multi-line `field: value` format):

1. **focus** — main topic (e.g. GLP-1 support, Longevity, PCOS, Menopause, Joint Pain, Gut Health, Sleep, Energy)
2. **reference** — URL of a reference video that captures desired execution style (optional but recommended)
3. **handle** — ambassador's @handle or full IG/TikTok URL
4. **tier** — 1 / 2 / 3 / 4 / custom (controls which deliverables appear in the brief)
5. **code** — discount code (e.g. NAME10)
6. **link** — discount link
7. **tag** — `@im8health` plus any co-tags
8. **approval** — first cut due + approval window
9. **delivery** — final delivery deadline
10. **usage** — usage rights (channels + duration)

If any required field is missing, the bot replies in-thread asking for only the missing fields. Optional: `name` (creator name if different from handle), `tag` defaults to `@im8health`.

## Auto-discovery (unknown creators)

If the requested handle / name is not in `context/im8-roster/roster.json`:

1. Run `research-im8-roster.js --add <name> --handle <url> --type <best-guess>` to research them via Perplexity and save
2. Append them to the current month's Influencer Tracker tab via `appendInfluencerRow()`
3. Then proceed with the brief

After this, the creator is in the roster permanently — no re-research needed next time.

## Output

A single Google Doc saved to Drive folder `17YeuFLfcXzodNeL6dRgOd_SH2x9kZ0BW`, named `IM8 x [Ambassador Name] - [Focus] - [YYYY-MM-DD]`.

The Doc contains BOTH Part 1 (internal — campaign inputs + ambassador research + Claude instructions) and Part 2 (the ambassador-facing brief). Operator deletes Part 1 before sending to the ambassador's team.

A row is also appended to the current month's "Influencer Tracker" tab with `briefStatus = "Auto Briefed"` and the Doc URL.

Slack reply (threaded in `C0ASDVB3FB8`): summary line — ambassador, focus, tier, Doc link.

## Hard rules

1. **Adapt the Reel "Suggested Structure" to mirror the ambassador's actual best-performing video flow.** NOT a generic structure. Use the roster's `contentStyle.typicalOpenStyle` / `typicalCloseStyle` / `pacing` / `formats`.
2. **Voice-match the hooks** to the ambassador. Don't default to staccato fragment style unless that's their actual style.
3. **Verified credibility only.** Pull from `roster.research.credibility[]`. If uncertain, omit rather than inflate.
4. **Clinical doses for IM8 ingredients.** Reference `research-prompts/im8-ingredient-research.md` to pull focus-area ingredients with their clinical dosing — never invent doses or claims.
5. **Delete deliverable sections not contracted.** Tier 1 = Reel only. Tier 2 = Reel + 1-2 Story Sets. Tier 3 = Reel + 3-4 Story Sets. Tier 4 = full package incl. raw footage library.
6. **Focus area woven through ALL sections,** not bolted onto the Reel only.
7. **Include `@im8health` in the tagging spec** plus any co-tags from input.
8. **NEVER write the literal discount code or discount link in the brief.** The ads team supplies the code/link to the ambassador separately. Use phrases like *"your discount code"*, *"the discount code provided by the ads team"*, or *"link in bio"* anywhere the template references the code or link. This prevents any wrong code from leaking into the brief. The code/link inputs are captured for internal tracking (Influencer Tracker comments + roster) only.
9. **Multi-focus deliverables.** When a creator has more than one reel/story AND the focuses differ (e.g. "GLP-1 for reel 1, performance for reel 2"), output ONE separate DELIVERABLE section per reel — each with its own hooks, structure, IM8 reveal, and CTA tailored to its focus. Stories mirror their paired reel's focus in a different format unless specified.
10. **Free ideas.** If any deliverable is described as "free idea / creator's choice / come up with it yourself", don't prescribe content for it. Drop in the free-idea blurb (see `free-idea-blurb.md`) with the IM8 Idea Bank link.
11. **Auto-strip Part 1.** The pipeline already removes Part 1 (internal prep + Claude instructions) before saving the Doc. The model still outputs Part 1 so it has structured context, but everything before the `---\n---` divider is stripped server-side. Always keep the divider exactly `---\n---` on their own lines before the `# IM8 × <Name>` heading.
12. **Bold / heading formatting.** Use `#` / `##` for section headers and `**bold**` for key labels. Plain-text section labels render as body text in Google Docs and are hard to scan.

## Files

- `template.md` — verbatim two-part formula (Part 1 internal + Part 2 brief)
- `research-prompts/ambassador-research.md` — Perplexity prompt for handle research
- `research-prompts/im8-ingredient-research.md` — Perplexity prompt for IM8 focus-area ingredients
- `reel-structure-prompt.md` — adaptation rules for matching the Reel structure to the ambassador's content patterns
- `free-idea-blurb.md` — the exact blurb + IM8 Idea Bank link used in "free idea" deliverable sections

## Trigger

Slack mention in `C0ASDVB3FB8`:

```
@NoaOS ambassador brief
focus: GLP-1 support
reference: https://www.instagram.com/reel/...
handle: @some_creator
tier: 2
code: NAME10
link: https://im8health.com/discount/NAME10
tag: @im8health
approval: First cut 2026-04-25, approval window 3 business days
delivery: All assets by 2026-05-10
usage: Organic + paid + whitelisting, 6 months
```

## Pipeline

`scripts/content-sync/im8-ambassador-brief.js`:
1. Parse the 10 inputs from the mention text
2. Validate; ask for missing fields in-thread if needed
3. Look up the creator in the roster by name/handle
4. If not found → auto-discovery (research + sheet add) then continue
5. Optionally analyse the reference video (reuse `analyze-reference-video.js` if URL provided)
6. Pull IM8 ingredient data for the focus area (Perplexity, scoped to im8health.com)
7. Build prompt: template + roster entry + reference notes + ingredient data + inputs
8. Call Claude (Sonnet 4, max_tokens 8000+) to generate the full two-part document
9. Upload Google Doc to Drive folder `17YeuFLfcXzodNeL6dRgOd_SH2x9kZ0BW`
10. Append row to "April Influencer Tracker 2026" via `appendInfluencerRow()`
11. Post threaded reply with Doc link
