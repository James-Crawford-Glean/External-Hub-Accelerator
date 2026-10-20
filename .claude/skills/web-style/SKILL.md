---
name: web-style
description: Apply the house web design system to generated HTML and CSS - modernist editorial minimalism (Swiss typography, Rams restraint, Apple HIG). Strict design tokens, one accent colour, hairline borders, asymmetric bento grids, type-driven hierarchy. Use when generating or editing standalone HTML or CSS - landing pages, static sites, article layouts, generated reports. Skip for the portal and the developer portal, which have their own themes, and for non-visual code.
---

# Web design system

House style for generated HTML. Modernist editorial minimalism: type does the
work, whitespace is the design, one accent colour.

Scope note for this repository: `apps/portal` has its own design tokens under
`src/styles/`, and `apps/dev` uses the Docusaurus theme in
`src/css/custom.css`. Match those when editing them. This skill is for new
standalone HTML (a static page, a generated report, a demo artifact).

## Drop-in brief

Paste this verbatim at the top of a generation prompt.

```
Design style: modernist editorial minimalism. Swiss typography, Rams restraint, Apple HIG.
Type does the heavy lifting. Whitespace IS the design. One accent colour, ever.

TOKENS (use these exact values; do not invent new ones):

  Light:  bg #fbfbfd  surface #ffffff  text #1d1d1f  muted #6e6e73  subtle #86868b
          primary #0071e3   border #e5e5ea
  Dark:   bg #000000  surface #1d1d1f  text #f5f5f7  muted #a1a1a6  subtle #6e6e73
          primary #2997ff   border #2c2c2e

  Font:   -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
          "Helvetica Neue", system-ui, sans-serif
  Body:   17px / line-height 1.6 / weight 400
  Display: clamp(2.5rem, 7vw, 5rem) / 1.05 / weight 700 / tracking -0.04em
  H2:     clamp(2rem, 4vw, 2.75rem) / 1.1 / weight 700 / tracking -0.04em
  H3:     1.25rem / weight 600 / tracking -0.025em
  Eyebrow: 0.875rem uppercase / tracking 0.02em / colour = primary
  Caption: 0.75rem / colour = subtle

  Spacing scale (px): 4, 8, 16, 24, 32, 48, 80, 120
  Radius:  cards 16-24, hero images 32, pills 9999
  Borders: 1px hairline only, colour = border. Never thicker.
  Shadow:  none at rest; 0 4px 16px rgba(0,0,0,.06) on hover only.

LAYOUT:
- Section width: 56rem for prose, 76rem for grids. Centre, pad 80px top/bottom.
- Hero: eyebrow + two-line display title + subtitle + ONE primary button.
- Cards: flat at rest; hairline border and -2px lift on hover.
- Grids: asymmetric bento (7/5, 5/7), never a uniform 4-up.
- Article header: centred, eyebrow row, big title, slim dot-separated meta.
- Buttons: pill, padding 0.7em 1.4em. Primary = solid primary bg. Ghost = 1px border.
- Sticky nav: backdrop-filter saturate(180%) blur(20px), translucent surface bg.

RULES:
- One accent colour total. No second hue, no rainbow categories.
- Type, not icons, sets hierarchy. Icons only for utility (CTAs, controls).
- Headings centre; body left-aligned. Never all-caps body.
- Pull quotes: large weight-500 text, 2px left border, no italics, no quote marks.

DO NOT:
- Multiple gradients, shadows on flat elements, borders over 1px.
- Skeuomorphism, neumorphism, glass everywhere.
- Vivid or neon palettes.
- Decorative emoji or icons in headings or prose.
```

## Making it stick

**Multi-page work.** Save the brief as `DESIGN_SYSTEM.md` beside the pages and
instruct the tool to follow it for every styling decision.

**Lock the tokens in CSS.** Put the values in a `tokens.css` of `--var`
definitions, link it once, and instruct: use only `var(--…)` from
`tokens.css`; never write a hex code or a pixel value directly. Drift becomes
impossible because there is nothing else to type.

## Where it comes from

Three traditions stacked: the Swiss International Typographic Style (grid,
sans-serif, hierarchy by size and space, asymmetric balance); Dieter Rams'
"less, but better"; and editorial modernism (eyebrow, display title, subtitle,
pull quotes, hairline rules). The Apple flavour on top: one restrained accent,
tight tracking on display type, a frosted nav, bento grids.
