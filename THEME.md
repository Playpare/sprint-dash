# Playspare dashboard theme (colours)

A dark colour theme for any dashboard. It covers colour only: keep the target dashboard's own fonts, sizes, spacing and layout.

## 1. Tokens

Define these on the app root and use only these variables in components.

```css
:root {
  --bg:   #08090d;               /* page background */
  --sur:  #0b0c0f;               /* card / panel surface */
  --sur2: #1c1f2e;               /* raised surface inside a card: tiles, inputs, tracks, chips */
  --bor:  rgba(255,255,255,.08); /* hairline borders */
  --text: #e8ebfa;               /* primary text, headings, key numbers */
  --mut:  #c2c8df;               /* secondary text, labels, captions, axis text */
  --acc:  #4d9fff;               /* primary accent: links, active state, selection, neutral data */
  --grn:  #18c97a;               /* positive / success */
  --amb:  #f5a623;               /* warning / attention */
  --red:  #f05252;               /* negative / error */
  --pur:  #9b72f5;               /* secondary accent */
  --teal: #00e5c3;               /* brand teal */
  --brand-gradient: linear-gradient(135deg, #00E5C3 0%, #4D9FFF 100%);
}
```

The light variant, if a dashboard needs one:

```css
:root.light {
  --bg:#f0f2f9; --sur:#ffffff; --sur2:#e8ebf5; --bor:#d4d8ed;
  --text:#1a1d2e; --mut:#50567a; --acc:#4050e8; --grn:#0aaa62;
  --red:#d93535; --amb:#c47e0a; --pur:#7c3aed; --teal:#0e9f9f;
}
```

## 2. Surfaces

| Layer | Colour |
|---|---|
| Page background | `--bg` |
| Card or panel | background `--sur`, `1px` border in `--bor` |
| Element inside a card | `--sur2` with a `--bor` border |
| Header bar | `--sur`, with a bottom border in `--bor` |
| Modal backdrop | `rgba(0,0,0,.45)` |
| Scrollbar | track `--bg`; thumb `#353b58`, `#4a5275` on hover |

## 3. Text

| Role | Colour |
|---|---|
| Primary | `--text` |
| Secondary | `--mut` |
| Labels under large numbers | `#dbe1f5` |
| Text on `--brand-gradient` | `#001014` |
| Text on a solid accent fill | `#ffffff` |
| Text on a coloured chip or swatch | `#000000` |

## 4. Meaning

| Meaning | Colour |
|---|---|
| Good, success, done, up | `--grn` |
| Warning, attention, pending | `--amb` |
| Bad, error, overdue, down | `--red` |
| Neutral, info, selected, planned | `--acc` |
| Secondary series or category | `--pur` |

Keep these meanings fixed in every dashboard. Do not use red for decoration or green for something neutral.

## 5. Status badges and tinted states

Build each from its meaning colour: the colour at low opacity for the fill, a slightly stronger border, and solid text.

| Type | Fill | Border | Text |
|---|---|---|---|
| Success | `rgba(24,201,122,.15)` | `rgba(24,201,122,.30)` | `--grn`, or `#39dc91` for emphasis |
| Warning | `rgba(245,166,35,.12)` | `rgba(245,166,35,.30)` | `--amb` |
| Error | `rgba(240,82,82,.15)` | `rgba(240,82,82,.30)` | `--red`, or `#ff8181` for emphasis |
| Info / secondary | `rgba(155,114,245,.15)` | none | `--pur` |

For a whole panel that needs attention, such as an error or alert list:

```css
border-color: rgba(240,82,82,.28);
background: linear-gradient(180deg, rgba(240,82,82,.10), rgba(240,82,82,.04));
box-shadow: 0 10px 28px rgba(240,82,82,.08), inset 0 1px 0 rgba(255,255,255,.04);
/* title text: #ffb2b2 */
```

## 6. Interactive states

| State | Colours |
|---|---|
| Active tab or segmented button | background `--brand-gradient`, text and icon `#001014`, no border |
| Inactive tab | background `--sur`, border `--bor`, text `--mut`; on hover the text becomes `--text` and the border becomes `--mut` |
| Navigation item | text `#cbd1e5`, icon `#9ea7c4`, background `rgba(255,255,255,.018)`, border `rgba(255,255,255,.055)` |
| Navigation item on hover | text `#ffffff`, background `rgba(77,159,255,.10)`, border `rgba(77,159,255,.28)`, icon `--acc` |
| Active navigation item | text `#70b4ff`; background `linear-gradient(90deg, rgba(77,159,255,.17), rgba(155,114,245,.10))`; border `rgba(77,159,255,.34)`; left bar `inset 3px 0 0 --acc` |
| Clickable card on hover | border `rgba(91,110,245,.35)`, glow `0 8px 24px rgba(91,110,245,.12)` |
| Progress or loading bar | track `--sur2`, fill `--acc` or `linear-gradient(90deg, #00E5C3, #4D9FFF)` |

## 7. Data visualisation

### Categorical palette

Use the colours in this order for series and categories:

`#4d9fff` · `#18c97a` · `#f5a623` · `#9b72f5` · `#f05252` · `#22c4c4` · `#5b6ef5` · `#ff8fab` · `#0aaa62` · `#ffc56b` · `#d98a0b`

### Lifecycle states (any to-do → done flow)

| State | Colour |
|---|---|
| Done | `#3ecf8e` |
| To do | `#4c8df6` |
| In progress | `#fdd33c` |
| In review | `#e5484d` |
| Paused / blocked | `#9d6bf7` |

### Chart elements

| Element | Colour |
|---|---|
| Axis and tick text | `#c2c8df` (light theme: `#50567a`) |
| Grid lines | `rgba(150,160,220,.08)` (light theme: `rgba(0,0,0,.06)`) |
| Shaded background bands, such as weekends or off-hours | `rgba(150,160,220,.07)` |
| Target, baseline or ideal line | `#5b6ef5`, dashed |
| Negative or remaining series | `#f05252`, with an area fill of `rgba(240,82,82,.12)` |
| Positive or completed series | `#18c97a` |
| Area fill under any series | the series colour at `.12`–`.14` opacity |
| Donut or pie slice gaps | the card colour `--sur`, not white |
| Tooltip | background `rgba(17,20,36,.96)`, border `--bor`, title `#ffffff`, values `#dde1f5` |
| Labels on the chart | the meaning colour at `.20`–`.22` opacity for the fill, the solid colour for the border, and light text (`#ffd0d0` on red, `#8ff0c2` on green) |
| Hover line | `rgba(255,255,255,.35)`, dashed |

## 8. Rules

1. Use only the tokens in section 1 for UI colour. Use raw hex only for the chart palettes in section 7.
2. Nest surfaces as `--bg` → `--sur` (cards) → `--sur2` (anything inside a card), and give each layer a `--bor` hairline.
3. Show colour meaning through `--grn`, `--amb`, `--red` and `--acc` only, and keep it the same on every dashboard.
4. Make tinted fills by putting the meaning colour at 10–22% opacity, with a border at about 30% and solid text.
5. Use `--brand-gradient` sparingly, only for the single active or brand element in a group.
6. Never change the target dashboard's typography, sizing or layout because of this file.
