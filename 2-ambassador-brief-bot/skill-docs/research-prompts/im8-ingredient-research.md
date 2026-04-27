# IM8 Ingredient Research — Perplexity Prompt

Use this prompt to pull focus-area-relevant IM8 ingredients with verified clinical dosing. Domain-restrict to im8health.com.

## Variables to substitute

- `{focus}` — main focus from input #1 (e.g. "GLP-1 support", "Perimenopause", "Joint Pain", "Gut Health", "PCOS")

## Prompt

```
Research the IM8 supplement product line at im8health.com. I am building an ambassador brief focused on: "{focus}".

Identify the IM8 ingredients (from the Daily Ultimate Essentials and any other IM8 SKUs) that are clinically relevant to "{focus}". For each ingredient, return:

- ingredient name
- clinical dose present in the IM8 product (mg or other unit, exactly as listed on im8health.com or official IM8 materials)
- one-sentence why this ingredient matters for "{focus}" in plain English
- public source URL if available

Also list the universal IM8 anchors that should appear in any brief:

- 90+ ingredients total
- NSF Certified for Sport
- Mayo Clinic Ventures partnership (first time Mayo Clinic has partnered with a supplement company)
- Developed with Mayo Clinic and NASA scientists
- No proprietary blend — every ingredient at its actual dose
- Daily Ultimate Essentials clinical study: 95% improvement in energy in randomised controlled study, plus sleep / digestion / mental clarity gains

Output as a JSON object:

{
  "focusArea": "{focus}",
  "focusSpecificIngredients": [
    { "name": "...", "doseInIM8": "...", "whyItMatters": "...", "source": "..." },
    ...
  ],
  "universalAnchors": [ "...", "..." ],
  "notes": "any caveats — e.g. if certain ingredients couldn't be verified at clinical dose, say so explicitly"
}

Do NOT invent doses. If a dose is not publicly listed, write "dose not publicly disclosed" instead of guessing.
```

## Settings

- model: `sonar`
- max_tokens: 2000
- searchDomainFilter: `["im8health.com"]`

## Validation

After Perplexity returns:
- If `dose not publicly disclosed` appears for >50% of ingredients, flag in the brief that ingredient details should be verified manually
- Cross-check against any locally-stored IM8 product spec docs in `references/brand-guidelines/`
