import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Card, Notice, ProvenanceBadge, Select } from '@/ui/components';
import { ChartWithTable, MoneyTooltip, SERIES, SimpleTable, axisProps, moneyTick } from '@/ui/charts';
import { useAccounts, type Analytics } from '@/hooks/useAppData';
import { balanceGaps, balanceSeries } from '@/engine/balances';
import { currentBalance } from '@/engine/flexibility';
import { formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';

/**
 * Balance history per account, reconstructed from its most recent balance (statement or
 * manual) and the transactions; plus places where printed statement balances don't reconcile.
 */
export function BalancesCard({ a }: { a: Analytics }) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState('');
  const withBalance = (accounts ?? []).filter((acc) => currentBalance(acc));
  const account = withBalance.find((x) => x.id === accountId) ?? withBalance[0];
  const data = useMemo(() => {
    if (!account) return null;
    const anchor = currentBalance(account)!;
    const txns = a.transactions.filter((t) => t.accountId === account.id);
    return { anchor, series: balanceSeries(txns, anchor), gaps: balanceGaps(txns) };
  }, [account, a.transactions]);
  if (!accounts || withBalance.length === 0 || !account || !data) return null;
  const min = Math.min(...data.series.map((p) => p.balance));
  return (
    <Card
      title="Account balances"
      description="End-of-day balance, reconstructed from the account’s latest balance and its transactions."
      actions={
        withBalance.length > 1 && (
          <Select aria-label="Account" value={account.id} onChange={(e) => setAccountId(e.target.value)} className="w-48">
            {withBalance.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        )
      }
    >
      <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        Latest: <strong className="tabular">{formatMoney(data.anchor.amount)}</strong> on {formatDate(data.anchor.asOf)}
        <ProvenanceBadge provenance={data.anchor.source === 'statement' ? 'known' : 'manual'} />
        {data.anchor.source === 'manual' && <span className="text-xs text-muted">Earlier balances are only as accurate as the balance you entered and the transactions imported.</span>}
      </p>
      <ChartWithTable
        label="Account balances"
        height={240}
        chart={
          <ResponsiveContainer>
            <LineChart data={data.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => formatDate(String(d)).replace(/ \d{4}$/, '')} minTickGap={40} {...axisProps} />
              <YAxis tickFormatter={moneyTick} width={60} {...axisProps} />
              <Tooltip content={<MoneyTooltip labelFormatter={(l) => formatDate(String(l))} />} />
              {min < 0 && <ReferenceLine y={0} stroke="var(--bad)" strokeDasharray="4 4" />}
              <Line type="stepAfter" dataKey="balance" name="Balance" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        }
        table={<SimpleTable headers={['Date', 'Balance']} align={['left', 'right']} rows={data.series.map((p) => [formatDate(p.date), formatMoney(p.balance)])} />}
      />
      {data.gaps.length > 0 ? (
        <div className="mt-3">
          <Notice tone="warn" title={`${data.gaps.length} place${data.gaps.length === 1 ? '' : 's'} where the statement balance doesn’t reconcile`}>
            {data.gaps.slice(0, 5).map((g) => (
              <span key={`${g.from}-${g.to}`} className="block">
                {formatDate(g.from)} → {formatDate(g.to)}: {formatMoney(g.difference, { signed: true })} unexplained
              </span>
            ))}
            Usually a statement period that hasn’t been imported, or a transaction entered twice.
          </Notice>
        </div>
      ) : (
        a.transactions.some((t) => t.accountId === account.id && t.balanceAfter !== undefined) && (
          <p className="mt-2 text-xs text-good">
            <Badge tone="good">✓</Badge> Every printed statement balance reconciles with the imported transactions.
          </p>
        )
      )}
    </Card>
  );
}
