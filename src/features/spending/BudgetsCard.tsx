import { useMemo, useState } from 'react';
import { Badge, Button, Card, CategoryDot, InfoTip, Modal, MoneyInput, Select } from '@/ui/components';
import { useBudgets, type Analytics } from '@/hooks/useAppData';
import { applySuggestedBudgets, saveBudget } from '@/data/budgets';
import { budgetReport, suggestBudgets, type BudgetStatus } from '@/engine/budgets';
import { addMonths, formatMonth, monthKey, monthRange } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';
import { useToast } from '@/ui/toast';

const STATUS: Record<BudgetStatus, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  onTrack: { label: 'On track', tone: 'good' },
  atRisk: { label: 'Ahead of pace', tone: 'warn' },
  over: { label: 'Over budget', tone: 'bad' },
};

export function BudgetsCard({ a }: { a: Analytics }) {
  const budgets = useBudgets();
  const toast = useToast();
  const current = monthKey(a.today);
  const [month, setMonth] = useState(current);
  const [editing, setEditing] = useState(false);
  const report = useMemo(() => (budgets ? budgetReport(a.lines, a.categoryMap, budgets, month, a.today, a.recurring) : null), [a.lines, a.categoryMap, budgets, month, a.today, a.recurring]);
  const suggestionMonths = a.completeMonths.slice(-3).map((m) => m.month);
  const suggestions = useMemo(() => suggestBudgets(a.lines, a.categoryMap, suggestionMonths), [a.lines, a.categoryMap, suggestionMonths.join()]);
  const firstMonth = a.months[0]?.month ?? current;
  if (!budgets || !report) return null;
  const cat = (id: string) => a.categoryMap.get(id);

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          Budgets <InfoTip>{DEFINITIONS.budget}</InfoTip>
        </span>
      }
      description={
        month === current
          ? `${formatMonth(month)} so far: ${formatPercent(report.elapsed, 0)} of the month has passed.`
          : `${formatMonth(month)} (complete month).`
      }
      actions={
        <>
          <Select aria-label="Budget month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-36">
            {monthRange(firstMonth < addMonths(current, -12) ? addMonths(current, -12) : firstMonth, current)
              .reverse()
              .map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
          </Select>
          <Button size="sm" onClick={() => setEditing(true)}>
            {budgets.length ? 'Edit budgets' : 'Set budgets'}
          </Button>
        </>
      }
    >
      {report.lines.length === 0 ? (
        <div className="text-sm text-ink-2">
          <p>No budgets yet. Budgets turn your monthly capacity into a plan and show, as the month goes, whether spending is on pace.</p>
          {suggestions.size > 0 && (
            <Button
              size="sm"
              variant="primary"
              className="mt-3"
              onClick={async () => {
                const n = await applySuggestedBudgets(suggestions, { overwrite: false });
                toast({ message: `Set ${n} budgets from your typical spending. Adjust them to match your plan.`, tone: 'good' });
              }}
            >
              Start from typical spending ({suggestionMonths.length} month median)
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          <ul className="grid gap-2">
            {report.lines.map((l) => {
              const c = cat(l.categoryId);
              const pct = Math.min(1, l.usedShare);
              return (
                <li key={l.categoryId} className="grid gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryDot color={c?.color} />
                    <span className="font-medium">{c?.name}</span>
                    {c?.essential && <span className="text-xs text-muted">essential</span>}
                    <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                    <span className="ml-auto tabular">
                      {formatMoney(l.actual, { whole: true })} of {formatMoney(l.budget, { whole: true })}
                    </span>
                    <span className={`w-28 text-right text-xs tabular ${l.remaining < 0 ? 'text-bad' : 'text-ink-2'}`}>
                      {l.remaining >= 0 ? `${formatMoney(l.remaining, { whole: true })} left` : `${formatMoney(-l.remaining, { whole: true })} over`}
                    </span>
                  </div>
                  <div
                    className="relative h-2 rounded bg-surface-2"
                    role="progressbar"
                    aria-label={`${c?.name} budget used`}
                    aria-valuenow={Math.round(l.usedShare * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="h-2 rounded" style={{ width: `${pct * 100}%`, background: l.status === 'over' ? 'var(--series-8)' : l.status === 'atRisk' ? 'var(--series-4)' : 'var(--series-1)' }} />
                    {month === current && (
                      <div aria-hidden className="absolute inset-y-[-2px] w-0.5 bg-[var(--ink-2)]" style={{ left: `${Math.min(1, l.expectedByNow / l.budget) * 100}%` }} title="Expected by today" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">
            Budgeted {formatMoney(report.totalBudget, { whole: true })} ({formatMoney(report.essentialBudget, { whole: true })} essential,{' '}
            {formatMoney(report.discretionaryBudget, { whole: true })} discretionary); spent {formatMoney(report.totalActual, { whole: true })} in budgeted categories and{' '}
            {formatMoney(report.unbudgetedActual, { whole: true })} elsewhere.{month === current && ' The vertical mark shows what the plan expects by today: recurring bills on their due dates, the rest spread evenly.'}
          </p>
        </div>
      )}
      <BudgetEditor open={editing} onClose={() => setEditing(false)} a={a} suggestions={suggestions} />
    </Card>
  );
}

function BudgetEditor({ open, onClose, a, suggestions }: { open: boolean; onClose: () => void; a: Analytics; suggestions: Map<string, number> }) {
  const budgets = useBudgets();
  const byCat = new Map((budgets ?? []).map((b) => [b.categoryId, b.monthlyAmount]));
  const expense = a.categories.filter((c) => c.kind === 'expense' && !c.archived);
  const total = (budgets ?? []).reduce((s, b) => s + b.monthlyAmount, 0);
  return (
    <Modal open={open} onClose={onClose} title="Monthly budgets" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p className="mb-3 text-sm text-ink-2">Changes save as you type. Leave blank for no budget. “Typical” is the median of your last three complete months.</p>
      <div className="grid gap-2">
        {expense.map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_8rem_6rem] items-center gap-2 text-sm">
            <label htmlFor={`bud-${c.id}`} className="flex items-center gap-2">
              <CategoryDot color={c.color} />
              {c.name}
              {c.essential && <span className="text-xs text-muted">essential</span>}
            </label>
            <MoneyInput id={`bud-${c.id}`} value={byCat.get(c.id) ?? null} onChange={(v) => saveBudget(c.id, v)} />
            <button
              className="text-right text-xs text-accent underline disabled:text-muted disabled:no-underline"
              disabled={!suggestions.has(c.id)}
              onClick={() => saveBudget(c.id, suggestions.get(c.id) ?? null)}
              title="Use typical spending"
            >
              {suggestions.has(c.id) ? `typical ${formatMoney(suggestions.get(c.id)!, { whole: true })}` : 'no history'}
            </button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm font-semibold">Total: {formatMoney(total, { whole: true })} per month</p>
    </Modal>
  );
}
