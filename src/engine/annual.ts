/**
 * Year in review: one calendar year compared with the previous one, from the same cash-flow
 * definitions as the rest of the app, plus the decisions made that year.
 */
import type { Cents } from '@/domain/money';
import type { Category, Decision } from '@/domain/types';
import { spendingByCategory, summarise, type AnalysedTxn, type PeriodSummary } from './cashflow';

export interface YearReview {
  year: number;
  summary: PeriodSummary;
  previous: PeriodSummary | null;
  /** Months of the year with any transactions (a partial year is flagged in the UI). */
  monthsWithData: number;
  categoryChanges: { categoryId: string | null; thisYear: Cents; lastYear: Cents; change: Cents }[];
  decisions: { made: number; reviewed: number; meanSatisfaction: number | null; wouldRepeat: number; lessons: { title: string; lesson: string }[] };
}

export function yearsWithData(lines: AnalysedTxn[]): number[] {
  return [...new Set(lines.map((l) => Number(l.date.slice(0, 4))))].sort((a, b) => b - a);
}

export function yearReview(lines: AnalysedTxn[], categories: Map<string, Category>, decisions: Decision[], year: number): YearReview {
  const range = (y: number) => ({ start: `${y}-01-01`, end: `${y}-12-31` });
  const prevLines = lines.some((l) => l.date.startsWith(String(year - 1)));
  const thisCats = new Map(spendingByCategory(lines, categories, range(year)).map((c) => [c.categoryId, c.total]));
  const lastCats = new Map(spendingByCategory(lines, categories, range(year - 1)).map((c) => [c.categoryId, c.total]));
  const keys = new Set([...thisCats.keys(), ...lastCats.keys()]);
  const categoryChanges = [...keys]
    .map((categoryId) => {
      const thisYear = thisCats.get(categoryId) ?? 0;
      const lastYear = lastCats.get(categoryId) ?? 0;
      return { categoryId, thisYear, lastYear, change: thisYear - lastYear };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const made = decisions.filter((d) => d.date.startsWith(String(year)) && d.snapshot);
  const reviewed = made.filter((d) => d.review);
  return {
    year,
    summary: summarise(lines, categories, range(year)),
    previous: prevLines ? summarise(lines, categories, range(year - 1)) : null,
    monthsWithData: new Set(lines.filter((l) => l.date.startsWith(String(year))).map((l) => l.date.slice(0, 7))).size,
    categoryChanges,
    decisions: {
      made: made.length,
      reviewed: reviewed.length,
      meanSatisfaction: reviewed.length ? reviewed.reduce((a, d) => a + d.review!.satisfaction, 0) / reviewed.length : null,
      wouldRepeat: reviewed.filter((d) => d.review!.wouldRepeat === 'yes').length,
      lessons: reviewed.filter((d) => d.review!.lessons.trim()).map((d) => ({ title: d.title, lesson: d.review!.lessons.trim() })),
    },
  };
}
