import { describe, it, expect } from 'vitest';
import { sanitizeTemplateParam, toRecipient, buildTemplatePayload } from './whatsapp';

describe('sanitizeTemplateParam', () => {
  it('removes newlines, tabs and long space runs (rejected by the API)', () => {
    expect(sanitizeTemplateParam('a\nb\r\nc\td')).toBe('a b c d');
    expect(sanitizeTemplateParam('a     b')).toBe('a b');
  });
  it('never returns an empty value (the API rejects empty parameters)', () => {
    expect(sanitizeTemplateParam('')).toBe('-');
    expect(sanitizeTemplateParam('  \n ')).toBe('-');
  });
  it('truncates to the limit with an ellipsis', () => {
    const out = sanitizeTemplateParam('x'.repeat(500), 100);
    expect(out).toHaveLength(100);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('toRecipient', () => {
  it('keeps digits only', () => {
    expect(toRecipient('+256 772-123456')).toBe('256772123456');
  });
});

describe('buildTemplatePayload', () => {
  it('builds a body-only template message', () => {
    const p = buildTemplatePayload({ to: '+256772123456', template: 'piitrade_alert', language: 'en', bodyParams: ['T', 'M', 'U'] });
    expect(p).toEqual({
      messaging_product: 'whatsapp',
      to: '256772123456',
      type: 'template',
      template: {
        name: 'piitrade_alert', language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'T' }, { type: 'text', text: 'M' }, { type: 'text', text: 'U' }] }],
      },
    });
  });
  it('adds the copy-code button for authentication templates', () => {
    const p = buildTemplatePayload({ to: '+256772123456', template: 'v', language: 'en', bodyParams: ['123456'], copyCodeButton: '123456' }) as {
      template: { components: Array<Record<string, unknown>> };
    };
    expect(p.template.components[1]).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] });
  });
});
