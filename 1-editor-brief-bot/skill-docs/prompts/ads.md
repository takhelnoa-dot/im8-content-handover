# Ads Mode (Performance / Direct Response)

Use these rules in addition to `shared-rules.md` when `briefType = ads`.

## Cut style

- **Pacing:** fast. Hooks land in the first 3 seconds. Cut every 2-4 seconds. Multiple speakers cycle quickly.
- **Length skew:** lean toward 30-45s base cuts. 60s only if the source genuinely supports a layered narrative. Avoid 90s.
- **Narrative shape:** hook (first 3s) → frame (problem / promise) → proof (expert validation, demo, transformation) → CTA-adjacent close. Product is the answer, not the climax.
- **Tone:** punchy, conversion-focused. Surface the strongest competitive frame ("15 pills or one packet" / "replaces 16 supplements" / "no proprietary blend"). Hooks should feel like a thumb-stopping line, not a brand statement.

## Hook discipline

The first transcript line of every ads cut should be a genuine hook — the strongest opener available in the source material. Pull from:

- Direct competitive framing ("15 pills or one packet")
- Surprising claim with citation ("95% improvement in energy in a randomised controlled study")
- Authority + curiosity ("Before I give it to any athlete, I want to know it actually works")
- Personal stakes ("I had a heart transplant in 2021…")
- DB peer advocacy ("every person I gave it to came back saying oh my god")

If no genuinely strong hook exists, output `[GAP: needs stronger opening hook from talent — current source material lacks a 3-second attention-grabber]` and continue.

## B-roll vocabulary (ads)

Faster, more demonstrative, conversion-focused:

- Product packet close-up (label visible)
- Pour / mix / drink demo (fast-cut sequence)
- 15-pill-bottle vs. one-packet visual comparison
- NSF certificate visual / Mayo Clinic Ventures branding
- Ingredient list close-up (transparency frame)
- Talent-in-action montages (training, treating patients, on court)
- Community UGC montage (rapid succession)
- On-screen text overlays — call them out explicitly: `[ON-SCREEN TEXT: "15 pills or 1 packet"]`

**Acceptable but use sparingly:** stock B-roll for problem-framing (lab, science, anatomy). Default to talent-led visuals.

## On-screen text

Performance ads carry their hook visually. Where useful, call out on-screen text directly:

```
| [ON-SCREEN TEXT] | *"15 pills or 1 packet"* | (frames 0-3) |
```

## Brief construction

- Title each brief with the angle (e.g. "ONE PACKET. EVERYTHING.", "STOP TAKING 16 SUPPLEMENTS", "THE BLOODWORK TEST"). No brand-statement taglines — make the title itself sell the angle.
- "Why It Works" rationale should explain the conversion logic — what objection this cut removes, what audience this targets, why this hook stops the scroll.

## Required end frame

```
| [END FRAME] | *[IM8 logo · NSF Certified badge]* |  |
```

## Cut count target

For ads mode, default toward more-and-varied: 7-10 cuts when source supports it. Each cut tests a different hook, angle, or audience. Performance creative wins on volume of distinct concepts.
