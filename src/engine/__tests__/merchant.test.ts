import { describe, expect, it } from 'vitest';
import { normaliseMerchant } from '../merchant';

describe('normaliseMerchant', () => {
  it('strips card numbers, dates and payment prefixes', () => {
    expect(normaliseMerchant('EFTPOS COUNTDOWN PONSONBY 4835-****-****-1234 12/03')).toBe('COUNTDOWN PONSONBY');
    expect(normaliseMerchant('POS W/D Countdown Ponsonby 12/03 10:15')).toBe('COUNTDOWN PONSONBY');
    expect(normaliseMerchant('Netflix.com *AB12CD')).toBe('NETFLIX COM');
    expect(normaliseMerchant('AP SPARK NZ 0012345678')).toBe('SPARK NZ');
    expect(normaliseMerchant('SPOTIFY P2A1B2C3')).toBe('SPOTIFY');
    expect(normaliseMerchant('Z ENERGY 2')).toBe('Z ENERGY 2');
  });
  it('never returns an empty key', () => {
    expect(normaliseMerchant('12/03')).toBe('12/03');
  });
});
