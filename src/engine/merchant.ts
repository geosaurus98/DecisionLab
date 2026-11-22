/**
 * Normalise a raw bank description into a stable merchant key, used for rules,
 * learned corrections, recurring-payment detection and duplicate detection.
 *
 * The goal is stability, not prettiness: "EFTPOS COUNTDOWN PONSONBY 4835-****-1234 12/03"
 * and "COUNTDOWN PONSONBY" should map to the same key.
 */
const NOISE_PREFIXES = [
  'EFTPOS',
  'POS W D',
  'POS',
  'VISA PURCHASE',
  'DEBIT CARD PURCHASE',
  'CARD PURCHASE',
  'DEBIT TRANSACTION',
  'DIRECT DEBIT',
  'DD',
  'AP',
  'AUTOMATIC PAYMENT',
  'BILL PAYMENT',
  'CONTACTLESS',
  'ONLINE PAYMENT',
  'PAYWAVE',
];

export function normaliseMerchant(description: string): string {
  let s = description.toUpperCase();
  s = s.replace(/\b\d{4}[-\s*]*[\d*]{4}[-\s*]*[\d*]{4}[-\s*]*\d{4}\b/g, ' '); // card numbers
  s = s.replace(/\b(CARD|C\/D)\s*\*?\d{3,4}\b/g, ' ');
  s = s.replace(/\b\d{4}[:/-]\d{2}[:/-]\d{2}\b/g, ' '); // embedded timestamps' dates, e.g. 2026:07:11 (Heartland POS)
  s = s.replace(/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g, ' '); // dates
  s = s.replace(/\b\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\b/g, ' '); // times, incl. fractional seconds
  s = s.replace(/\b(19|20)\d{2}\b/g, ' '); // stray years
  s = s.replace(/\b\d{1,2}-[A-Z]{3}-\d{2,4}\b/g, ' '); // 12-NOV-26 style dates
  s = s.replace(/\b\d{1,2}\.\d{2}\.\d{2}(\.\d+)?(\s*(AM|PM))?\b/g, ' '); // 10.15.32.123456 AM style times
  s = s.replace(/[*#]+\s*\w*\d\w*/g, ' '); // reference tails like *AB12C or #1234
  s = s.replace(/[^A-Z0-9&' ]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of NOISE_PREFIXES) {
      if (s.startsWith(prefix + ' ')) {
        s = s.slice(prefix.length + 1).trim();
        changed = true;
      }
    }
  }
  // Drop reference-like tokens: long digit runs and long letter+digit codes ("P2A1B2C3"),
  // but keep short numbers (e.g. "Z ENERGY 2")
  s = s
    .split(' ')
    .filter((tok) => !/^\d{5,}$/.test(tok) && !(tok.length >= 6 && /\d/.test(tok) && /[A-Z]/.test(tok)))
    .join(' ');
  return s.trim() || description.trim().toUpperCase();
}

/** Human-readable merchant label derived from the key. */
export function merchantLabel(key: string): string {
  return key
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
