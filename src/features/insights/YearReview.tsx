import { useMemo, useState } from 'react';
import { Card, Metric, Notice, Select } from '@/ui/components';
import { SimpleTable } from '@/ui/charts';
import type { Analytics } from '@/hooks/useAppData';
import type { Decision } from '@/domain/types';
import { yearReview, yearsWithData } from '@/engine/annual';
import { formatMoney, formatPercent } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';

export function YearReviewCard({ a, decisions }: { a: Analytics; decisions: Decision[] }) {
  const years = useMemo(() => yearsWithData(a.lines), [a.lines]);
  const [year, setYear] = useState<number | null>(null);
  const y = year ?? years[0];
  const r = useMemo(() => (y ? yearReview(a.lines, a.categoryMap, decisions, y) : null), [a.lines, a.categoryMap, decisions, y]);
  if (!r || !y) return null;
  const s = r.summary;
  const p = r.previous;
  const vs = (cur: number, prev?: number) => (prev === undefined ? undefined : `${formatMoney(cur - prev, { whole: true, signed: true })} vs ${y - 1}`);
  const name = (id: string | null) => (id ? a.categoryMap.get(id)?.name ?? 'Unknown' : 'Uncategorised');
  return (
    <Card
      title="Year in review"
      description="A calendar year compared with the one before, using the same definitions as everywhere else."
      actions={
        <Select aria-label="Year" value={y} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
          {years.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
      }
    >
      {r.monthsWithData < 12 && (
        <div className="mb-3">
          <Notice tone="info">
            {y} has transactions in {r.monthsWithData} of 12 months, so totals cover part of the year{p ? '; the comparison with last year is not like for like' : ''}.
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Income" value={formatMoney(s.income, { whole: true })} sub={vs(s.income, p?.income)} definition={DEFINITIONS.income} provenance="known" />
        <Metric label="Spending" value={formatMoney(s.spending, { whole: true })} sub={vs(s.spending, p?.spending)} definition={DEFINITIONS.spending} provenance="known" />
        <Metric label="Savings rate" value={s.savingsRate === null ? '—' : formatPercent(s.savingsRate)} sub={p?.savingsRate != null ? `${formatPercent(p.savingsRate)} in ${y - 1}` : undefined} definition={DEFINITIONS.savingsRate} provenance="known" />
        <Metric label="Decisions made" value={String(r.decisions.made)} sub={`${r.decisions.reviewed} reviewed${r.decisions.meanSatisfaction !== null ? ` · avg satisfaction ${r.decisions.meanSatisfaction.toFixed(1)}/10` : ''}`} />
      </div>
      {p && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold">Biggest changes in spending</h3>
          <SimpleTable
            headers={['Category', String(y - 1), String(y), 'Change']}
            align={['left', 'right', 'right', 'right']}
            rows={r.categoryChanges.slice(0, 6).map((c) => [
              name(c.categoryId),
              formatMoney(c.lastYear, { whole: true }),
              formatMoney(c.thisYear, { whole: true }),
              <span key="c" className={c.change > 0 ? 'text-bad' : c.change < 0 ? 'text-good' : ''}>
                {formatMoney(c.change, { whole: true, signed: true })}
              </span>,
            ])}
          />
        </div>
      )}
      {r.decisions.lessons.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold">Lessons you recorded in {y}</h3>
          <ul className="grid gap-1 text-sm">
            {r.decisions.lessons.map((l) => (
              <li key={l.title}>
                “{l.lesson}” <span className="text-xs text-muted">— {l.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
