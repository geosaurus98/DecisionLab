import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Badge, Button, Card, CategoryDot, EmptyState, InfoTip, Metric, PageHeader, Segmented, Select, Spinner } from '@/ui/components';
import { ChartWithTable, MoneyTooltip, SERIES, NEUTRAL, SimpleTable, axisProps, moneyTick } from '@/ui/charts';
import { useAnalytics } from '@/hooks/useAppData';
import { categoryTrend, comparePeriods, spendingByCategory, summarise } from '@/engine/cashflow';
import { findAnomalies } from '@/engine/anomalies';
import { addMonths, firstDayOfMonth, formatDate, formatMonth, lastDayOfMonth, monthRange } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { merchantLabel } from '@/engine/merchant';
import { DEFINITIONS } from '@/ui/definitions';
import { db } from '@/data/db';
import { SETTING_KEYS, getSetting, setSetting } from '@/data/settings';
import { useNavigate } from 'react-router-dom';

type Period = '3' | '6' | '12' | 'all';

export function SpendingPage() {
  const a = useAnalytics();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('6');
  const [compareMonth, setCompareMonth] = useState<string>('');

  const months = useMemo(() => {
    const complete = a.completeMonths;
    return period === 'all' ? complete : complete.slice(-Number(period));
  }, [a.completeMonths, period]);
  const range = months.length ? { start: firstDayOfMonth(months[0]!.month), end: lastDayOfMonth(months.at(-1)!.month) } : undefined;

  const totals = useMemo(() => (range ? summarise(a.lines, a.categoryMap, range) : undefined), [a.lines, a.categoryMap, range?.start, range?.end]);
  const byCategory = useMemo(() => (range ? spendingByCategory(a.lines, a.categoryMap, range) : []), [a.lines, a.categoryMap, range?.start, range?.end]);

  // Trend: top 6 categories by total, the rest folded into "Other categories".
  const trend = useMemo(() => {
    const top = byCategory.slice(0, 6).map((c) => c.categoryId ?? 'uncategorised');
    const rows = categoryTrend(a.lines, a.categoryMap, months.map((m) => m.month));
    return {
      keys: top,
      data: rows.map((r) => {
        const row: Record<string, number | string> = { month: r.month };
        let other = 0;
        for (const [k, v] of Object.entries(r.totals)) {
          if (top.includes(k)) row[k] = v;
          else other += v;
        }
        row.other = other;
        return row;
      }),
    };
  }, [byCategory, a.lines, a.categoryMap, months]);

  const target = compareMonth || a.lastComplete;
  const comparison = useMemo(() => {
    const baselineStart = addMonths(target, -3);
    return comparePeriods(
      a.lines,
      a.categoryMap,
      { start: firstDayOfMonth(baselineStart), end: lastDayOfMonth(addMonths(target, -1)) },
      { start: firstDayOfMonth(target), end: lastDayOfMonth(target) },
    );
  }, [a.lines, a.categoryMap, target]);

  const anomalies = useMemo(() => findAnomalies(a.lines, a.categoryMap, { since: range?.start }), [a.lines, a.categoryMap, range?.start]);
  const txnById = useMemo(() => new Map(a.transactions.map((t) => [t.id, t])), [a.transactions]);
  const catName = (id: string | null) => (id === null || id === 'uncategorised' ? 'Uncategorised' : a.categoryMap.get(id)?.name ?? 'Unknown');

  if (a.loading) return <Spinner />;
  if (a.transactions.length === 0) {
    return (
      <>
        <PageHeader title="Spending analysis" />
        <EmptyState title="Nothing to analyse yet" action={<Button variant="primary" onClick={() => navigate('/transactions')}>Import transactions</Button>}>
          Import at least one complete month of transactions to see cash flow, category trends and recurring payments.
        </EmptyState>
      </>
    );
  }

  const n = months.length;
  const recurringOut = a.recurring.filter((r) => r.direction === 'out');
  const recurringIn = a.recurring.filter((r) => r.direction === 'in');

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Spending analysis"
        description="Calculated from your imported transactions using complete calendar months only. Transfers between your accounts are excluded."
        actions={
          <Segmented
            ariaLabel="Analysis period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: '3', label: '3 mo' },
              { value: '6', label: '6 mo' },
              { value: '12', label: '12 mo' },
              { value: 'all', label: 'All' },
            ]}
          />
        }
      />
      {n === 0 || !totals ? (
        <EmptyState title="No complete months yet">Your data does not yet include a full calendar month before this one.</EmptyState>
      ) : (
        <>
          <p className="-mt-3 text-sm text-ink-2">
            {formatMonth(months[0]!.month)} – {formatMonth(months.at(-1)!.month)} · {n} month{n === 1 ? '' : 's'}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Avg monthly income" value={formatMoney(Math.round(totals.income / n), { whole: true })} definition={DEFINITIONS.income} provenance="known" />
            <Metric label="Avg monthly spending" value={formatMoney(Math.round(totals.spending / n), { whole: true })} definition={DEFINITIONS.spending} provenance="known" />
            <Metric
              label="Savings rate"
              value={totals.savingsRate === null ? '—' : formatPercent(totals.savingsRate)}
              tone={totals.savingsRate !== null && totals.savingsRate < 0 ? 'bad' : undefined}
              definition={DEFINITIONS.savingsRate}
              provenance="known"
            />
            <Metric
              label="Essential share"
              value={totals.spending > 0 ? formatPercent(totals.essentialSpending / totals.spending) : '—'}
              sub={`${formatMoney(Math.round(totals.essentialSpending / n), { whole: true })}/mo essential`}
              definition={DEFINITIONS.essential}
              provenance="known"
            />
          </div>
          {totals.uncategorisedOut > 0 && (
            <p className="text-sm text-warn">
              ⚠ {formatMoney(totals.uncategorisedOut)} of spending in this period is uncategorised and counted as discretionary.{' '}
              <button className="underline" onClick={() => navigate('/transactions')}>
                Review
              </button>
            </p>
          )}

          <Card title="Monthly cash flow" description="Income and spending per month; the line shows net cash flow (after savings contributions).">
            <ChartWithTable
              label="Monthly cash flow"
              chart={
                <ResponsiveContainer>
                  <ComposedChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m, true)} {...axisProps} />
                    <YAxis tickFormatter={moneyTick} width={56} {...axisProps} />
                    <Tooltip content={<MoneyTooltip labelFormatter={(l) => formatMonth(String(l))} />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" name="Income" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="spending" name="Spending" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Line dataKey="netCashFlow" name="Net cash flow" stroke="var(--ink-2)" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              }
              table={
                <SimpleTable
                  headers={['Month', 'Income', 'Spending', 'Savings contrib.', 'Net cash flow', 'Savings rate']}
                  align={['left', 'right', 'right', 'right', 'right', 'right']}
                  rows={months.map((m) => [
                    formatMonth(m.month),
                    formatMoney(m.income),
                    formatMoney(m.spending),
                    formatMoney(m.savingsContributions),
                    formatMoney(m.netCashFlow),
                    m.savingsRate === null ? '—' : formatPercent(m.savingsRate),
                  ])}
                />
              }
            />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Spending by category" description={`Net of refunds, ${n}-month total.`}>
              <ChartWithTable
                label="Spending by category"
                height={Math.max(220, byCategory.length * 30)}
                chart={
                  <ResponsiveContainer>
                    <BarChart data={byCategory.map((c) => ({ ...c, name: catName(c.categoryId) }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickFormatter={moneyTick} {...axisProps} />
                      <YAxis type="category" dataKey="name" width={120} {...axisProps} />
                      <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
                      <Bar dataKey="total" name="Spent" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                }
                table={
                  <SimpleTable
                    headers={['Category', 'Total', 'Per month', 'Share', 'Count']}
                    align={['left', 'right', 'right', 'right', 'right']}
                    rows={byCategory.map((c) => [
                      <span key="n" className="inline-flex items-center gap-2">
                        <CategoryDot color={c.categoryId ? a.categoryMap.get(c.categoryId)?.color : undefined} />
                        {catName(c.categoryId)}
                      </span>,
                      formatMoney(c.total),
                      formatMoney(Math.round(c.total / n)),
                      formatPercent(c.share),
                      c.count,
                    ])}
                  />
                }
              />
            </Card>

            <Card title="Category trends" description="Top six categories per month; the rest are grouped.">
              <ChartWithTable
                label="Category trends"
                chart={
                  <ResponsiveContainer>
                    <BarChart data={trend.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m, true)} {...axisProps} />
                      <YAxis tickFormatter={moneyTick} width={56} {...axisProps} />
                      <Tooltip content={<MoneyTooltip labelFormatter={(l) => formatMonth(String(l))} />} cursor={{ fill: 'var(--surface-2)' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {trend.keys.map((k, i) => (
                        <Bar key={k} dataKey={k} name={catName(k)} stackId="s" fill={SERIES[i]} stroke="var(--surface)" strokeWidth={1} maxBarSize={36} />
                      ))}
                      <Bar dataKey="other" name="Other categories" stackId="s" fill={NEUTRAL} stroke="var(--surface)" strokeWidth={1} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                }
                table={
                  <SimpleTable
                    headers={['Month', ...trend.keys.map(catName), 'Other']}
                    align={['left', ...trend.keys.map(() => 'right' as const), 'right']}
                    rows={trend.data.map((r) => [formatMonth(String(r.month)), ...trend.keys.map((k) => formatMoney(Number(r[k] ?? 0))), formatMoney(Number(r.other))])}
                  />
                }
              />
            </Card>
          </div>

          <Card
            title="What changed?"
            description="Spending in the selected month vs the average of the three months before it (both normalised to a 30.4-day month)."
            actions={
              <Select aria-label="Month to compare" value={target} onChange={(e) => setCompareMonth(e.target.value)} className="w-40">
                {monthRange(a.completeMonths[0]?.month ?? a.lastComplete, a.lastComplete)
                  .reverse()
                  .map((m) => (
                    <option key={m} value={m}>
                      {formatMonth(m)}
                    </option>
                  ))}
              </Select>
            }
          >
            <SimpleTable
              headers={['Category', '3-month baseline', formatMonth(target), 'Change']}
              align={['left', 'right', 'right', 'right']}
              rows={comparison.slice(0, 10).map((c) => [
                catName(c.categoryId),
                formatMoney(c.a),
                formatMoney(c.b),
                <span key="c" className={c.change > 0 ? 'text-bad' : c.change < 0 ? 'text-good' : ''}>
                  {formatMoney(c.change, { signed: true })}
                  {c.relative !== null && Math.abs(c.relative) >= 0.25 && Math.abs(c.change) >= 5000 && (
                    <Badge tone={c.change > 0 ? 'bad' : 'good'}>{c.change > 0 ? '▲' : '▼'} {formatPercent(Math.abs(c.relative), 0)}</Badge>
                  )}
                </span>,
              ])}
            />
          </Card>
        </>
      )}

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            Recurring payments <InfoTip>{DEFINITIONS.recurring}</InfoTip>
          </span>
        }
        description="Detected automatically — check them. Dismiss anything that isn't really recurring."
      >
        {a.recurring.length === 0 ? (
          <p className="text-sm text-ink-2">No regular payments detected yet (needs at least three occurrences).</p>
        ) : (
          <div className="overflow-x-auto">
            <SimpleTable
              headers={['Merchant', 'Cadence', 'Typical', 'Per month', 'Next expected', 'Confidence', '']}
              align={['left', 'left', 'right', 'right', 'left', 'right', 'right']}
              rows={[...recurringOut, ...recurringIn].map((r) => [
                <span key="m">
                  {merchantLabel(r.merchant)} {!r.active && <Badge>Possibly ended</Badge>} {r.direction === 'in' && <Badge tone="good">Income</Badge>}
                </span>,
                r.cadence,
                formatMoney(r.typicalAmount),
                formatMoney(r.monthlyEquivalent),
                r.active ? formatDate(r.nextExpected) : '—',
                `${Math.round(r.confidence * 100)}%`,
                <Button
                  key="d"
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const current = await getSetting<string[]>(SETTING_KEYS.dismissedRecurring, []);
                    await setSetting(SETTING_KEYS.dismissedRecurring, [...current, r.key]);
                  }}
                >
                  Dismiss
                </Button>,
              ])}
            />
            <p className="mt-2 text-xs text-muted">
              Active recurring outgoings total {formatMoney(-recurringOut.filter((r) => r.active).reduce((s, r) => s + r.monthlyEquivalent, 0))} per month (monthly equivalent).
              {' '}
              <button
                className="underline"
                onClick={async () => {
                  await db.settings.delete(SETTING_KEYS.dismissedRecurring);
                }}
              >
                Restore dismissed
              </button>
            </p>
          </div>
        )}
      </Card>

      <Card title="Unusually large transactions" description="Purchases far above what is typical for their category (robust z-score > 3.5, categories with ≥ 8 transactions).">
        {anomalies.length === 0 ? (
          <p className="text-sm text-ink-2">Nothing unusual in this period.</p>
        ) : (
          <SimpleTable
            headers={['Date', 'Description', 'Category', 'Amount', 'Typical in category']}
            align={['left', 'left', 'left', 'right', 'right']}
            rows={anomalies.slice(0, 10).map((x) => {
              const t = txnById.get(x.id.split(':')[0]!)!;
              return [formatDate(t.date), merchantLabel(t.merchant), catName(x.categoryId), formatMoney(x.amount), `${formatMoney(x.typical)} (n=${x.sampleSize})`];
            })}
          />
        )}
      </Card>
    </div>
  );
}
