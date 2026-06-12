import { THEMES } from './themes.js';

const themeList = Object.entries(THEMES)
  .map(([name, t]) => `- \`${name}\` — ${t.blurb}`)
  .join('\n');

/**
 * Returned by the get_style_guide MCP tool. This document is the contract
 * between LLM authors and the renderer — keep it in sync with themes/base.css.
 */
export const STYLE_GUIDE = `# Pointless slide authoring guide

You are writing slides for Pointless. Each slide is an **HTML fragment** rendered
inside a fixed **1280×720** canvas that already has theme styling applied. Do not
include \`<html>\`, \`<head>\`, \`<body>\`, or a wrapper with class \`slide\` — the renderer
provides those. Scripts, iframes, and event handlers are stripped.

**Rule one: use the design-system classes below instead of inventing your own
styling.** Inline styles are allowed for fine-tuning (e.g. a specific width), but
fonts, colors, and spacing come from the theme — that's what makes decks look
designed. Prefer editing an existing slide over deleting and re-adding it.

**Rule two: less is more.** One idea per slide, generous whitespace, max ~5 bullets,
never paragraphs of prose. If a slide feels full, split it.

## Themes
${themeList}

## Typography
- \`<h1>\` — slide-deck title (64px). One per deck, on the title slide.
- \`<h2>\` — slide headline (44px). The default heading for content slides.
- \`<h3>\` — section heading inside a slide (31px).
- \`<p class="kicker">\` — small uppercase accent eyebrow above a heading.
- \`<p class="subtitle">\` — large muted line under a heading.
- \`<p class="footnote">\` — small muted text (sources, dates).
- \`class="muted"\` / \`class="accent"\` — muted or accent-colored text.
- \`<hr class="divider">\` — short accent rule, looks good under an h2.

## Layout (compose freely)
- \`<div class="center">…</div>\` — vertically + horizontally centered block. Title slides, quotes, single big statements.
- \`<div class="columns"><div class="col">…</div><div class="col">…</div></div>\` — side-by-side columns. \`class="col-wide"\` makes one column 1.6×.
- \`<div class="spread">…</div>\` — pushes children apart vertically (e.g. content top, footnote bottom).
- \`<div class="fill">…</div>\` — takes remaining vertical space.

## Components
- Stats: \`<div class="stat-row"><div class="stat"><div class="stat-value">87%</div><div class="stat-label">renewal rate</div></div>…</div>\`
- Quote: \`<div class="center"><p class="quote">"…"</p><p class="attribution">Name, Role</p></div>\`
- Card: \`<div class="card">…</div>\` — subtle panel for grouping. Cards inside \`.col\`s make comparison layouts.
- Badge: \`<span class="badge">Beta</span>\`
- Image: \`<img class="img-cover" src="https://…">\` inside a \`.col\` or \`.fill\` (use real, reachable URLs only).
- Lists: plain \`<ul>\`/\`<ol>\` are styled (accent markers). Keep items short.
- Tables: plain \`<table>\` with \`<th>\`/\`<td>\` is styled. Good for 3–6 rows, not data dumps.
- Code: \`<pre><code>…</code></pre>\` for snippets (keep under ~12 lines).
- Charts: no chart engine; build simple bar charts from divs with inline widths/heights and \`var(--accent)\` backgrounds, or inline \`<svg>\`.

## Recipes
Title slide:
\`\`\`html
<div class="center">
  <p class="kicker">Q3 Business Review</p>
  <h1>Growth held. Costs didn't.</h1>
  <p class="subtitle">Finance · October 2026</p>
</div>
\`\`\`

Content slide:
\`\`\`html
<p class="kicker">Where we are</p>
<h2>Three things changed this quarter</h2>
<hr class="divider">
<div class="columns">
  <div class="col"><div class="card"><h3>Pricing</h3><p>New tiers shipped in July; ARPU up 11%.</p></div></div>
  <div class="col"><div class="card"><h3>Churn</h3><p>Down to 2.1% after onboarding revamp.</p></div></div>
  <div class="col"><div class="card"><h3>Hiring</h3><p>Eng +6, all backfills closed.</p></div></div>
</div>
\`\`\`

Big-number slide:
\`\`\`html
<p class="kicker">Impact</p>
<h2>Renewals</h2>
<div class="fill" style="display:flex;align-items:center">
  <div class="stat-row">
    <div class="stat"><div class="stat-value">87%</div><div class="stat-label">renewal rate</div></div>
    <div class="stat"><div class="stat-value">$4.2M</div><div class="stat-label">renewed ARR</div></div>
    <div class="stat"><div class="stat-value">31</div><div class="stat-label">expansions</div></div>
  </div>
</div>
<p class="footnote">Source: billing export, Sep 30</p>
\`\`\`

## Workflow
1. \`create_deck\`, then add slides with \`add_slide\` (title slide first).
2. Add speaker \`notes\` to slides — viewers can toggle them.
3. Iterate with \`update_slide\` / \`reorder_slides\` / \`get_deck\`.
4. \`publish\` returns the share link; re-publishing after edits keeps the same link.
`;
