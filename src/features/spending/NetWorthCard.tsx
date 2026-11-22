import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, InfoTip, Segmented } from '@/ui/components';
import { ChartWithTable, MoneyTooltip, SERIES, SimpleTable, axisProps, moneyTick } from '@/ui/charts';
import { useAccounts, type Analytics } from '@/hooks/useAppData';
import { netWorthSeries } from '@/engine/networth';
import { addMonths, formatMonth, monthKey, monthRange } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';

export function NetWorthCard({ a }: { a: Analytics }) {
  const accounts = useAccounts();
  const [span, setSpan] = useState<'12' | '24' | '60'>('24');
  const current = monthKey(a.today);
  const data = useMemo(() => {
    if (!accounts) return null;
    return netWorthSeries(accounts, a.transactions, monthRange(addMonths(current, -Number(span) + 1), current));
  }, [accounts, a.transactions, current, span]);
  if (!accounts || !data || accounts.length === 0) return null;
  const points = data.points.filter((p) => p.accounts > 0);
  if (points.length === 0) return null;
  const first = points[0]!;
  const last = points.at(-1)!;
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          Net worth <InfoTip>{DEFINITIONS.netWorth}</InfoTip>
        </span>
      }
      description={`Month-end total across ${last.accounts} account${last.accounts === 1 ? '' : 's'}: ${formatMoney(last.total, { whole: true })} (${formatMoney(last.total - first.total, { whole: true, signed: true })} since ${formatMonth(first.month)}).`}
      actions={
        <Segmented
          ariaLabel="Net worth period"
          value={span}
          onChange={setSpan}
          options={[
            { value: '12', label: '1 yr' },
            { value: '24', label: '2 yr' },
            { value: '60', label: '5 yr' },
          ]}
        />
      }
    >
      <ChartWithTable
        label="Net worth"
        height={240}
        chart={
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickFormatter={(m) => formatMonth(String(m), true)} minTickGap={24} {...axisProps} />
              <YAxis tickFormatter={moneyTick} width={60} {...axisProps} />
              <Tooltip content={<MoneyTooltip labelFormatter={(l) => `End of ${formatMonth(String(l))}`} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="total" name="Net worth" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="liquid" name="Liquid accounts" stroke={SERIES[2]} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        }
        table={
          <SimpleTable
            headers={['Month', ...accounts.filter((x) => !data.excluded.includes(x)).map((x) => x.name), 'Total']}
            align={['left', ...accounts.filter((x) => !data.excluded.includes(x)).map(() => 'right' as const), 'right']}
            rows={points.map((p) => [
              formatMonth(p.month),
              ...accounts.filter((x) => !data.excluded.includes(x)).map((x) => (p.byAccount[x.id] === undefined ? '—' : formatMoney(p.byAccount[x.id]!, { whole: true }))),
              formatMoney(p.total, { whole: true }),
            ])}
          />
        }
      />
      {data.excluded.length > 0 && (
        <p className="mt-2 text-xs text-muted">Not included (no balance yet): {data.excluded.map((x) => x.name).join(', ')}. Add a balance under Account balances or Settings.</p>
      )}
      {points.some((p) => p.accounts < last.accounts) && (
        <p className="mt-1 text-xs text-muted">Earlier months include fewer accounts, because some accounts’ history starts later — jumps can reflect that rather than real changes.</p>
      )}
    </Card>
  );
}
