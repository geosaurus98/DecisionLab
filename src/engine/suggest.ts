/**
 * Category suggestions for uncategorised merchants, learned from merchants you have already
 * categorised. Transparent nearest-neighbour matching on merchant-key words:
 *
 *   similarity(A, B) = Σ idf(w) over shared words / min(Σ idf(A), Σ idf(B))   (weighted overlap)
 *
 * The overlap form (rather than Jaccard) stops extra branch/suburb words — which are rare but
 * say nothing about the category — from hiding a strong match on the merchant's name.
 * Merchant keys start with the business name and end with places, so the first word of both
 * merchants must also match: a shared suburb alone ("KELBURN DAIRY" vs "COUNTDOWN KELBURN")
 * never produces a suggestion.
 *   idf(w) = ln(1 + N / df(w)), N = number of known merchants, df = merchants containing w
 *
 * Rare, distinctive words ("COUNTDOWN") count for more than common ones ("AUCKLAND", "NZ").
 * The best-matching known merchant's category is suggested if similarity ≥ threshold; the
 * matched merchant is shown as the reason. Suggestions are never applied automatically.
 */

export interface KnownMerchant {
  merchant: string;
  categoryId: string;
}

export interface CategorySuggestion {
  categoryId: string;
  /** Known merchant that drove the suggestion. */
  like: string;
  similarity: number;
}

const tokens = (merchant: string) => [...new Set(merchant.split(' ').filter((w) => w.length >= 2 && !/^\d+$/.test(w)))];

export interface SuggestionIndex {
  suggest(merchant: string): CategorySuggestion | null;
}

export function buildSuggestionIndex(known: KnownMerchant[], threshold = 0.5): SuggestionIndex {
  // One category per merchant: the most frequent among its examples.
  const votes = new Map<string, Map<string, number>>();
  for (const k of known) {
    const m = votes.get(k.merchant) ?? new Map<string, number>();
    m.set(k.categoryId, (m.get(k.categoryId) ?? 0) + 1);
    votes.set(k.merchant, m);
  }
  const merchants = [...votes.entries()].map(([merchant, m]) => ({
    merchant,
    categoryId: [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0],
    words: tokens(merchant),
  }));
  const df = new Map<string, number>();
  for (const m of merchants) for (const w of m.words) df.set(w, (df.get(w) ?? 0) + 1);
  const N = Math.max(1, merchants.length);
  const idf = (w: string) => Math.log(1 + N / (df.get(w) ?? 0.5));
  const byWord = new Map<string, number[]>();
  merchants.forEach((m, i) => m.words.forEach((w) => byWord.set(w, [...(byWord.get(w) ?? []), i])));

  return {
    suggest(merchant: string): CategorySuggestion | null {
      const words = tokens(merchant);
      if (words.length === 0) return null;
      const candidates = new Set<number>();
      for (const w of words) for (const i of byWord.get(w) ?? []) candidates.add(i);
      let best: CategorySuggestion | null = null;
      for (const i of candidates) {
        const m = merchants[i]!;
        if (m.merchant === merchant || m.words[0] !== words[0]) continue;
        const shared = words.filter((w) => m.words.includes(w));
        const sum = (ws: string[]) => ws.reduce((a, w) => a + idf(w), 0);
        const den = Math.min(sum(words), sum(m.words));
        const sim = den > 0 ? sum(shared) / den : 0;
        if (sim >= threshold && (!best || sim > best.similarity)) best = { categoryId: m.categoryId, like: m.merchant, similarity: sim };
      }
      return best;
    },
  };
}
