import { describe, it, expect } from 'vitest';
import { evaluateDescription } from './contentSafety';

const st = (d: string, labels: { label: string; confidence: number }[] = []) => evaluateDescription(d, labels).status;

describe('evaluateDescription', () => {
  it('passes ordinary goods', () => {
    for (const d of [
      'A silver iPhone 13 Pro on a wooden table.',
      'A red Toyota Corolla parked on a street.',
      'A nude lipstick and a pair of nude heels.',
      'A naked cake with strawberries.',
      'An ivory wedding dress on a mannequin.',
      'A toy gun made of plastic on a shelf.',
      'A kitchen knife next to chopped onions.',
      'A woman wearing a floral dress smiling.',
      'Garden weeds growing beside a fence.',
      'A crack in the wall and a bath bomb on a shelf.',
      'A printer cartridge, a glue pistol and a role-playing game box.',
    ]) expect(st(d), d).toBe('PASSED');
  });
  it('blocks prohibited content', () => {
    const cases: [string, string][] = [
      ['A naked woman lying on a bed.', 'sexual-content'],
      ['An explicit sexual photo of a young girl.', 'child-safety'],
      ['A dead body covered in blood on the road.', 'graphic-violence'],
      ['An AK-47 assault rifle leaning on a wall.', 'weapons'],
      ['A pistol on a table.', 'weapons'],
      ['Bags of cocaine and cash.', 'drugs'],
      ['Two elephant tusks on a rug.', 'wildlife'],
      ['A stack of counterfeit money notes.', 'counterfeit'],
      ['A flag of ISIS on a pole.', 'extremism'],
    ];
    for (const [d, cat] of cases) { const r = evaluateDescription(d); expect(r.status, d).toBe('BLOCKED'); expect(r.category, d).toBe(cat); }
  });
  it('flags borderline items for review but does not block', () => {
    expect(st('A machete leaning against a shed.')).toBe('REVIEW');
    expect(st('A swastika carved on a wall.')).toBe('REVIEW');
    expect(st('A parcel', [{ label: 'assault rifle', confidence: 0.8 }])).toBe('REVIEW');
    expect(st('A parcel', [{ label: 'assault rifle', confidence: 0.3 }])).toBe('PASSED');
  });
});
