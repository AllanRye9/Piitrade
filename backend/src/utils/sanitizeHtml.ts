/**
 * sanitizeHtml.ts — allow-list sanitiser for admin-authored blog HTML.
 *
 * The blog page renders `post.content` with dangerouslySetInnerHTML, so whatever is
 * stored runs in every visitor's browser. Scripts, inline event handlers, iframes,
 * javascript: URLs, etc. are stripped; ordinary article markup is kept.
 */
import sanitize from 'sanitize-html';

const OPTIONS: sanitize.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
    'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    '*': ['class'],
    th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}) },
    }),
  },
};

export function sanitizeBlogHtml(html: unknown): string {
  return typeof html === 'string' ? sanitize(html, OPTIONS) : '';
}
