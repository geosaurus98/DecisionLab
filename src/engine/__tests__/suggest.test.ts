import { describe, expect, it } from 'vitest';
import { buildSuggestionIndex } from '../suggest';

const known = [
  { merchant: 'COUNTDOWN PONSONBY AUCKLAND NZ', categoryId: 'groceries' },
  { merchant: 'COUNTDOWN PONSONBY AUCKLAND NZ', categoryId: 'groceries' },
  { merchant: 'NEW WORLD THORNDON WELLINGTON NZ', categoryId: 'groceries' },
  { merchant: 'BURGER FUEL AUCKLAND NZ', categoryId: 'eating' },
  { merchant: 'SUSHI BAR AUCKLAND NZ', categoryId: 'eating' },
  { merchant: 'Z ENERGY TE ARO', categoryId: 'transport' },
];

describe('category suggestions', () => {
  const idx = buildSuggestionIndex(known);
  it('suggests from a similar known merchant, driven by distinctive words', () => {
    expect(idx.suggest('COUNTDOWN NEWMARKET AUCKLAND NZ')).toMatchObject({ categoryId: 'groceries', like: 'COUNTDOWN PONSONBY AUCKLAND NZ' });
    expect(idx.suggest('NEW WORLD KILBIRNIE WELLINGTON NZ')?.categoryId).toBe('groceries');
  });
  it('does not suggest from shared common words alone', () => {
    // Only "AUCKLAND NZ" in common with known merchants.
    expect(idx.suggest('PET STORE AUCKLAND NZ')).toBeNull();
    // A shared place name is not evidence about the category.
    expect(idx.suggest('PONSONBY DAIRY')).toBeNull();
    expect(idx.suggest('')).toBeNull();
  });
  it('uses the majority category for a merchant and ignores exact self-matches', () => {
    const i2 = buildSuggestionIndex([...known, { merchant: 'BURGER FUEL AUCKLAND NZ', categoryId: 'eating' }, { merchant: 'BURGER FUEL AUCKLAND NZ', categoryId: 'shopping' }]);
    expect(i2.suggest('BURGER FUEL PONSONBY AUCKLAND NZ')?.categoryId).toBe('eating');
    expect(i2.suggest('Z ENERGY TE ARO')).toBeNull();
  });
});
