import type { Deck } from '@pointless/shared';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@pointless/shared';
import { getThemeCss } from './themes.js';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Plain server-rendered page with one fixed-size .slide per print page.
 * Used by headless Chromium for PDF export; slide html is already sanitized at write time.
 */
export function renderPrintHtml(deck: Deck): string {
  const pages = deck.slides
    .map((s) => `<div class="page"><section class="slide">${s.html}</section></div>`)
    .join('\n');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(deck.title)}</title>
<style>
${getThemeCss(deck.theme)}
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
@page { size: ${SLIDE_WIDTH}px ${SLIDE_HEIGHT}px; margin: 0; }
.page { width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; overflow: hidden; page-break-after: always; }
</style>
</head>
<body>
${pages}
</body>
</html>`;
}
