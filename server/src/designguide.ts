/**
 * Returned by the get_design_guide MCP tool. Presentations are full HTML
 * documents, so this is craft guidance, not an enforced schema.
 */
export const DESIGN_GUIDE = `# Pointless presentation authoring guide

A Pointless presentation is **one complete, self-contained HTML document** —
\`<!doctype html>\` through \`</html>\` — that runs in a sandboxed iframe at the
share link. You are not filling slide templates; you are designing a small,
beautiful interactive experience. Think bespoke microsite, not PowerPoint.

## Hard requirements
- **Self-contained**: all CSS and JS inline in the document. No external
  scripts or stylesheets, no CDNs. (Exception: Google Fonts links are allowed.)
  Images must be external URLs the viewer can reach, inline SVG, or data URIs.
- **Sandboxed**: the document runs with scripts enabled but in an isolated
  origin — no cookies, no storage guarantees, no parent-page access. Design
  within that.
- **Self-navigating**: Pointless adds no chrome. If the content has sections
  or slides, build the navigation: keyboard (arrows, space, Esc), click/tap,
  and touch swipe. Show subtle affordances (a progress mark, a folio, a hint
  line) so a first-time viewer knows what to do.
- **Fits the viewport**: design for both a 16:9 projector/laptop fullscreen
  and a phone. Use vw/vh/clamp() sizing, test your layout mentally at 1440×900
  and 390×844. Avoid page scroll on the main view unless scrolling IS the
  design (long-form reading is fine).
- **Size**: keep the document under 2 MB.

## Craft rules (this is what makes it good)
1. **Commit to one aesthetic** and execute it everywhere: typography, color,
   spacing, motion. A presentation with a point of view beats a neutral one.
   Directions that work well: editorial/print (paper textures, serif display,
   hairline rules, small-caps labels), luxe dark (deep gradients, gold/jewel
   accents, ornamental borders), brutalist (raw contrast, monospace, hard
   shadows), soft modern (rounded cards, gentle gradients, airy spacing).
2. **Typography first.** Pair a characterful display face with a quiet body
   face (Google Fonts allowed, or rich system stacks: Didot/Bodoni/Playfair,
   Baskerville/Charter/Georgia, ui-monospace). Use clamp() so headlines are
   huge on projectors and sane on phones. Never default to Arial/Helvetica.
3. **Motion with restraint**: one good entrance animation per view, eased
   transitions between sections (300–600ms, cubic-bezier), micro-feedback on
   interactive elements. Respect prefers-reduced-motion.
4. **Texture and depth**: SVG-noise grain, layered radial gradients, inset
   hairline frames, corner ornaments — small details that make it feel
   designed, not generated.
5. **Information pacing**: one idea per view. Big statement, then supporting
   detail on demand (reveal, flip, drill-in). Don't wall-of-text a view —
   unless it's a reading deck, in which case give it proper book typography
   (measure ~65ch, line-height 1.6+, drop caps if it suits the aesthetic).

## House palettes (use as defaults when the user doesn't specify)
**Light — "Gallery"**: paper #f5f1e8 · ink #1c1b17 · muted #6f695c ·
accent #8b2027 (crimson) or #2c5840 (forest) · hairlines rgba(28,27,23,.3).
**Dark — "After Hours"**: ground #0b1a2a (or #12161d) · text #f5ecd7 ·
muted rgba(245,236,215,.65) · accent #c9a14a (gold) or #64a4ea (sky) ·
glows via layered radial-gradients, never flat black.
The user may name any other direction — honor it fully.

## Interaction patterns that work
- **Slide stepper**: full-viewport views, arrow-key + click + swipe to move,
  thin progress bar, numbered folio ("3 / 12").
- **Card deck**: stacked cards that flip (front = title, back = content),
  swipe between cards — great on phones.
- **Menu + drill-in**: a home grid of tiles, each opening a detail view, Esc
  to return — great for quizzes, catalogs, reference decks.
- **Scrollytelling**: a single long page with section reveals — great for
  narrative reports.

## Workflow
1. \`create_presentation\` with a title.
2. Write the complete HTML document and send it with \`set_html\`.
3. \`publish\` — give the user the returned share_url. That link is the
   deliverable. Offer a \`password\` if the content is sensitive.
4. For edits, send the full updated document via \`set_html\` again, then
   re-publish (the link stays the same).
`;
