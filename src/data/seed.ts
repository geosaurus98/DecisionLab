/** Default categories and starter rules for New Zealand transactions. Users can edit all of these. */
import type { Category, CategoryRule } from '@/domain/types';
import { nowTimestamp } from '@/domain/ids';

// Category dot colours. Identity in the UI is always also given by the category name.
const C = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  yellow: '#eda100',
  magenta: '#e87ba4',
  green: '#008300',
  violet: '#6250d6',
  red: '#e34948',
  grey: '#898781',
};

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-income', name: 'Income', kind: 'income', essential: false, color: C.green, sortOrder: 0 },
  { id: 'cat-groceries', name: 'Groceries', kind: 'expense', essential: true, color: C.aqua, sortOrder: 10 },
  { id: 'cat-eating-out', name: 'Eating out', kind: 'expense', essential: false, color: C.orange, sortOrder: 20 },
  { id: 'cat-transport', name: 'Transport', kind: 'expense', essential: true, color: C.blue, sortOrder: 30 },
  { id: 'cat-accommodation', name: 'Accommodation', kind: 'expense', essential: true, color: C.violet, sortOrder: 40 },
  { id: 'cat-utilities', name: 'Utilities', kind: 'expense', essential: true, color: C.yellow, sortOrder: 50 },
  { id: 'cat-subscriptions', name: 'Subscriptions', kind: 'expense', essential: false, color: C.magenta, sortOrder: 60 },
  { id: 'cat-health', name: 'Health and fitness', kind: 'expense', essential: false, color: C.red, sortOrder: 70 },
  { id: 'cat-entertainment', name: 'Entertainment', kind: 'expense', essential: false, color: C.magenta, sortOrder: 80 },
  { id: 'cat-shopping', name: 'Shopping', kind: 'expense', essential: false, color: C.orange, sortOrder: 90 },
  { id: 'cat-travel', name: 'Travel', kind: 'expense', essential: false, color: C.blue, sortOrder: 100 },
  { id: 'cat-other', name: 'Other', kind: 'expense', essential: false, color: C.grey, sortOrder: 110 },
  { id: 'cat-transfers', name: 'Transfers', kind: 'transfer', essential: false, color: C.grey, sortOrder: 120 },
  { id: 'cat-savings', name: 'Investments and savings', kind: 'savings', essential: false, color: C.green, sortOrder: 130 },
];

type RuleSeed = [name: string, pattern: string, categoryId: string, direction?: CategoryRule['direction']];

const RULE_SEEDS: RuleSeed[] = [
  // Savings, then transfers, run first so e.g. "Transfer to Sharesies" is savings, never spending.
  ['Investments and KiwiSaver', 'sharesies|kernel|simplicity|kiwisaver|inv360|hatch|smartshares', 'cat-savings'],
  ['Internal transfers', 'transfer to|transfer from|tfr to|tfr from|internet transfer|online transfer|internal transfer|td deposit', 'cat-transfers'],
  // Resident withholding tax on interest is netted against interest income (income category).
  ['Withholding tax on interest', 'withholding tax|\\brwt\\b', 'cat-income'],
  ['Salary', 'salary|payroll|wages', 'cat-income', 'in'],
  ['Interest', 'interest', 'cat-income', 'in'],
  ['Countdown / Woolworths', 'countdown|woolworths', 'cat-groceries'],
  ['New World', 'new world', 'cat-groceries'],
  ["Pak'nSave", "pak ?'?n ?save", 'cat-groceries'],
  ['Fresh Choice / Four Square', 'fresh choice|four square', 'cat-groceries'],
  ['Cafes and takeaways', 'cafe|coffee|uber \\*?eats|uber eats|delivereasy|mcdonald|burger|sushi|pizza|kebab|bakery', 'cat-eating-out'],
  ['Fuel', '\\b(z energy|bp|mobil|gull|waitomo|caltex|npd)\\b', 'cat-transport'],
  ['Public transport', 'at hop|snapper|metlink|bee card|uber trip|\\buber\\b(?! \\*?eats)', 'cat-transport'],
  ['Power / internet / phone', 'mercury|genesis|contact energy|meridian|electric kiwi|spark|one nz|2degrees|skinny|vodafone|watercare', 'cat-utilities'],
  ['Streaming and software', 'netflix|spotify|disney|neon|apple\\.com|google \\*|icloud|youtube|github|adobe|chatgpt|openai', 'cat-subscriptions'],
  ['Gym and health', 'gym|les mills|anytime fitness|pharmacy|chemist|physio|doctor|medical|dentist', 'cat-health'],
  ['Rent', '\\brent\\b|property management|barfoot|harcourts|ray white', 'cat-accommodation', 'out'],
  ['Entertainment', 'event cinemas|hoyts|ticketek|ticketmaster|steam|playstation|nintendo', 'cat-entertainment'],
  ['Shopping', 'warehouse|kmart|mighty ape|noel leeming|jb hi-?fi|pb tech|briscoes|farmers|bunnings|mitre 10|trade me|amazon', 'cat-shopping'],
  ['Travel', 'air new zealand|jetstar|qantas|airbnb|booking\\.com|expedia|hotel|interislander|bluebridge', 'cat-travel'],
];

export function defaultRules(): CategoryRule[] {
  const createdAt = nowTimestamp();
  return RULE_SEEDS.map(([name, pattern, categoryId, direction], i) => ({
    id: `rule-default-${i + 1}`,
    name,
    field: 'description' as const,
    operator: 'regex' as const,
    pattern,
    caseSensitive: false,
    direction: direction ?? 'any',
    categoryId,
    enabled: true,
    priority: (i + 1) * 10,
    createdAt,
  }));
}
