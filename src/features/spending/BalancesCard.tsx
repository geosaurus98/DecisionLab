import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Button, Card, MoneyInput, Notice, ProvenanceBadge, Select } from '@/ui/components';
import { saveAccount } from '@/data/transactions';
import { useToast } from '@/ui/toast';
import type { Account } from '@/domain/types';
import { ChartWithTable, MoneyTooltip, SERIES, SimpleTable, axisProps, moneyTick } from '@/ui/charts';
import { useAccounts, type Analytics } from '@/hooks/useAppData';
import { balanceGaps, balanceSeries } from '@/engine/balances';
import { currentBalance } from '@/engine/flexibility';
import { addDays, formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';

/**
 * Balance history per account, reconstructed from its most recent balance (statement or
 * manual) and the transactions; plus places where printed statement balances don't reconcile.
 */
export function BalancesCard({ a }: { a: Analytics }) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState('');
  const withBalance = (accounts ?? []).filter((acc) => acc.balance || acc.statementBalance);
  const without = (accounts ?? []).filter((acc) => !acc.balance && !acc.statementBalance && a.transactions.some((t) => t.accountId === acc.id));
  const account = withBalance.find((x) => x.id === accountId) ?? withBalance[0];
  const data = useMemo(() => {
    if (!account) return null;
    const current = currentBalance(account, a.transactions)!;
    const txns = a.transactions.filter((t) => t.accountId === account.id);
    return { current, series: balanceSeries(txns, current.anchor), gaps: balanceGaps(txns) };
  }, [account, a.transactions]);
  if (!accounts || (withBalance.length === 0 && without.length === 0)) return null;
  if (!account || !data) {
    return (
      <Card title="Account balances" description="Enter one balance per account to see its balance history.">
        <OpeningBalancePrompt accounts={without} a={a} />
      </Card>
    );
  }
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
        Latest: <strong className="tabular">{formatMoney(data.current.amount)}</strong> on {formatDate(data.current.asOf)}
        <ProvenanceBadge provenance={data.current.source === 'statement' ? 'known' : 'manual'} />
        <span className="text-xs text-muted">
          {data.current.source === 'statement' ? 'From a statement' : 'From the balance you entered'} on {formatDate(data.current.anchor.asOf)}
          {data.current.rolledForward > 0 && `, plus ${data.current.rolledForward} later transaction${data.current.rolledForward === 1 ? '' : 's'}`}.
        </span>
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
      {without.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <OpeningBalancePrompt accounts={without} a={a} />
        </div>
      )}
    </Card>
  );
}

/**
 * Accounts with transactions but no balance: ask for one balance on any date. It is rolled
 * forward (and backward, for history) through the transactions.
 */
function OpeningBalancePrompt({ accounts, a }: { accounts: Account[]; a: Analytics }) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, { amount: number | null; mode: 'today' | 'opening' }>>({});
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-ink-2">No balance yet for these accounts. Enter today’s balance, or the balance before the first imported transaction:</p>
      {accounts.map((acc) => {
        const first = a.transactions.filter((t) => t.accountId === acc.id).map((t) => t.date).sort()[0]!;
        const v = values[acc.id] ?? { amount: null, mode: 'today' as const };
        const asOf = v.mode === 'today' ? a.today : addDays(first, -1);
        return (
          <div key={acc.id} className="flex flex-wrap items-center gap-2">
            <span className="w-40 truncate font-medium">{acc.name}</span>
            <Select aria-label={`Which balance for ${acc.name}`} value={v.mode} onChange={(e) => setValues({ ...values, [acc.id]: { ...v, mode: e.target.value as 'today' | 'opening' } })} className="h-9 w-56">
              <option value="today">Balance today</option>
              <option value="opening">Opening balance (before {formatDate(first)})</option>
            </Select>
            <MoneyInput ariaLabel={`Balance for ${acc.name}`} allowNegative value={v.amount} onChange={(x) => setValues({ ...values, [acc.id]: { ...v, amount: x } })} className="w-36" />
            <Button
              size="sm"
              disabled={v.amount === null}
              onClick={async () => {
                await saveAccount({ ...acc, balance: { amount: v.amount!, asOf } });
                toast({ message: `Balance saved for ${acc.name}.`, tone: 'good' });
              }}
            >
              Save
            </Button>
          </div>
        );
      })}
    </div>
  );
}
