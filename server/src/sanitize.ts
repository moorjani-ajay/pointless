import sanitizeHtml from 'sanitize-html';

export const MAX_SLIDE_HTML_BYTES = 100 * 1024;

/**
 * Slides are arbitrary HTML shared by link inside an org, so scripts, frames
 * and event handlers are stripped on every write. Inline styles and classes
 * are allowed by design — that's how decks are styled.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'div', 'section', 'span', 'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'mark', 'code', 'pre',
    'blockquote', 'q', 'cite', 'a',
    'img', 'figure', 'figcaption', 'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  ],
  allowedAttributes: {
    '*': ['class', 'style', 'aria-*', 'role', 'width', 'height',
          'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
          'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'rx', 'ry',
          'transform', 'opacity', 'font-size', 'text-anchor', 'colspan', 'rowspan'],
    a: ['class', 'style', 'href', 'target', 'rel'],
    img: ['class', 'style', 'src', 'alt', 'width', 'height', 'loading'],
  },
  allowedSchemes: ['http', 'https', 'data'],
  allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
  parser: { lowerCaseAttributeNames: false },
};

export function sanitizeSlideHtml(html: string): { html: string } | { error: string } {
  if (Buffer.byteLength(html, 'utf8') > MAX_SLIDE_HTML_BYTES) {
    return { error: `Slide HTML exceeds ${MAX_SLIDE_HTML_BYTES / 1024}KB. Split content across slides or trim inline data URIs.` };
  }
  return { html: sanitizeHtml(html, OPTIONS) };
}
