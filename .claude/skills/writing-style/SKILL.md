---
name: writing-style
description: House prose rules for anything a person reads - developer-portal pages, READMEs, PR descriptions, commit bodies, reports, documents, emails, articles. Active voice, subject and verb first, no em dashes, no intensifiers, no clichés, concrete over abstract, varied sentence length. Apply whenever writing or editing prose. Skip for code, code comments, conversational chat replies, and shell output.
---

# Writing style

The rules below are the house style. Apply them the moment prose work is
requested. Do not announce them or narrate them; write to them.

## Never in finished prose

- **Em dashes (—) and double hyphens (--).** Restructure. Use a comma, period,
  colon, semicolon, or parentheses.
- **Intensifiers:** just, very, really, certainly, entirely, extremely,
  completely, truly, actually, basically, literally.
- **Verb-weakening hedges:** seems to, tends to, kind of, sort of, somewhat,
  fairly.
- **Abstract nouns hiding verbs:** "give consideration to" is "consider";
  "make a decision" is "decide".
- **Tech and business clichés:** seamless, robust, leverage, synergy, blazing
  fast, world-class, best-in-class, cutting-edge, production-ready, deep dive,
  low-hanging fruit, move the needle, paradigm shift.
- **Marketing language inside documentation.**
- **Empty redundancy:** "in order to" is "to"; "due to the fact that" is
  "because"; "at this point in time" is "now".
- **Emotional filler:** "Great!", "Awesome!", praise of the reader's work.

## Sentence craft

**Lead with subject and verb.** Meaning early, detail after. Hide who, when,
and where in the middle; save complications for after the fact.

> "The gate drops `_user_goal` before validating."
> Not: "Before validation takes place, host-injected arguments such as `_user_goal` are dropped by the gate."

**Emphasise by position.** Strongest material at the end, next strongest at
the start, weak elements in the middle. The period magnifies the word before
it.

**Activate verbs.** The subject acts. Present tense for behaviour. Drop
qualifiers.

> "The server returns `-32602`."
> Not: "A `-32602` error is returned by the server."

**Use passive deliberately.** Only when the receiver matters more than the
actor, or the actor is unknown. Never to dodge responsibility.

**Control adverbs.** Delete any -ly word that intensifies rather than changes
meaning. Replace adverb plus weak verb with one strong verb.

**Prefer simple present over -ing forms.** Gerunds only for ongoing action; no
gerund stacks.

## Rhythm

- Vary sentence length on purpose. Short for warnings and emphasis; medium for
  explanation; long for process and inventory.
- Parallel structure in lists; break the pattern at the end for emphasis.
- Element count carries meaning: one is power, two is contrast, three is
  completeness, four or more is inventory.
- Punctuation sets pace: period stops, comma slows, semicolon rolls, colon
  announces, parentheses detour.
- One idea per paragraph. A short paragraph after a long one lands.

## Word choice

- Short Saxon words over long Latinate ones at the point of complexity.
- Technical terms repeat exactly (`tools/list` stays `tools/list`; the acting
  user stays the acting user). Distinctive non-technical words do not repeat
  nearby.
- Reject first-level phrasing. When a familiar phrase arrives, find three
  alternatives and keep the most precise.

> Cliché: "The gate is robust."
> Specific: "The gate rejects any key the schema does not declare and names it in `violations`."

## Structure

- Climb the ladder of abstraction: principle, then example; or example, then
  conclusion. Avoid the bureaucratic middle.
- Show with scenes and data: a request, a response, a log line, a row.
- Use contrast: before and after, expected and actual, this surface and its
  neighbour.
- Foreshadow: an introduction forecasts the structure; do not introduce an
  element you will not use.
- Reward the reader through the middle with a concrete win, example, or tip.

## Tone

- Match intensity to subject. Serious material is understated and factual.
- Direct address where it fits ("set `MCP_CATALOG_FILTER=off`"). Authoritative,
  never condescending.
- Neutral and professional. Facts, accuracy, analysis.

## Editing

Cut big, then small: whole sections that do not serve the focus, then weak
sentences, then words. Read aloud; fix what stumbles. If you cannot write a
reverse outline of the piece, restructure it.

## Document level

Every document answers one question. Frame it early; let the content answer
it. Reference material reports; a tutorial walks. Where both are needed,
explain the concept, then walk through it.

## Workflow

1. Identify the question, the reader, and what they need.
2. Outline; each section earns its place.
3. Draft with energy: subject and verb first, active, concrete, varied.
4. Cut, big before small.
5. Polish: strong words at sentence ends, adverbs out, passives activated.
6. Read aloud.

Output Markdown unless told otherwise.
