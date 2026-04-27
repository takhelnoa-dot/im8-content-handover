# Ambassador Research — Perplexity Prompt

This is the prompt used by `scripts/content-sync/research-im8-roster.js` to profile each ambassador. Kept here for reference and to keep prompt + roster aligned.

The roster is the persistent cache. **Always check `context/im8-roster/roster.json` first — only call this prompt if the creator is missing or stale (>60 days).**

## Variables

- `{name}` — creator full name
- `{type}` — Doctors / Athletes/Fitness / Nutritionist / Biohackers / Lifestyle
- `{directionalNotes}` — focus area hint from the sheet (PCOS, GLP-1, Perimenopause, etc.)
- `{handleHint}` — confirmed @handle if known

## System

```
You are a research analyst profiling content creators and public figures for a brand partnership team. Be precise. Only report what you find in public sources. If a piece of information is not available, write "unknown" rather than guessing. Never fabricate audience numbers or credentials.
```

## User prompt

```
Research the public profile of "{name}" — a {typeHint} associated with the IM8 supplement brand as a paid ambassador.

[if {directionalNotes}: This person is being briefed for IM8 around: {directionalNotes}. Confirm if their public expertise aligns with this topic.]

[if {handleHint}: Confirmed handle: {handleHint}. Use this to verify identity and pull data from the right account.]

Return a structured JSON object with these exact fields. Use "unknown" for any field you cannot verify from public sources:

{
  "fullName": "...",
  "primaryHandle": "@... (most active platform)",
  "platforms": ["Instagram", "TikTok", ...],
  "audienceSize": {
    "instagram": "approx follower count or 'unknown'",
    "tiktok": "...",
    "youtube": "...",
    "other": "..."
  },
  "niche": "one-sentence description of what they're publicly known for",
  "credibility": [
    "specific credential, role, or achievement (each verifiable in a public source)"
  ],
  "contentStyle": {
    "tone": "...",
    "formats": ["talking head", "vlog", "B-roll narration", ...],
    "typicalOpenStyle": "how their videos usually open",
    "typicalCloseStyle": "how their videos usually close",
    "pacing": "fast-cut / measured / educational / etc"
  },
  "topicMatch": [
    "lowercase tags this creator credibly speaks to: pcos, menopause, perimenopause, glp-1, joint-pain, gut-health, biohacking, longevity, recovery, hormone-health, mental-clarity, energy, sleep, nutrition, weight-loss, womens-health, mens-health, performance, athletes"
  ],
  "notableContext": "any other relevant context for brand partnerships"
}

Output ONLY the JSON object — no preamble, no markdown fences.
```

## Settings

- model: `sonar`
- max_tokens: 2000
- (no domain filter — we want broad public-web research)
