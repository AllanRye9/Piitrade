import { describe, it, expect } from 'vitest';
import { sanitizeBlogHtml } from './sanitizeHtml';

describe('sanitizeBlogHtml', () => {
  it('strips scripts, event handlers, iframes and javascript: links', () => {
    const out = sanitizeBlogHtml('<p onclick="x()">hi</p><script>alert(1)</script><iframe src="//e.com"></iframe><a href="javascript:alert(1)">l</a><img src=x onerror=alert(1)>');
    expect(out).not.toMatch(/script|onclick|onerror|iframe|javascript:/i);
    expect(out).toContain('<p>hi</p>');
  });
  it('keeps normal article markup', () => {
    const html = '<h2>Title</h2><p><strong>Bold</strong> and <a href="https://piitrade.com/x" target="_blank">link</a></p><img src="https://cdn.x/a.jpg" alt="a"><ul><li>1</li></ul>';
    const out = sanitizeBlogHtml(html);
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>Bold</strong>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('<img src="https://cdn.x/a.jpg" alt="a" />');
  });
  it('returns empty string for non-strings', () => {
    expect(sanitizeBlogHtml(undefined)).toBe('');
    expect(sanitizeBlogHtml({})).toBe('');
  });
});
