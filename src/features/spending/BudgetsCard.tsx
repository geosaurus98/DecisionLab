import { useMemo, useState } from 'react';
import { Badge, Button, Card, CategoryDot, Checkbox, InfoTip, Modal, MoneyInput, Segmented, Select } from '@/ui/components';
import { useBudgets, type Analytics } from '@/hooks/useAppData';
import { applySuggestedBudgets, saveBudget, setBudgetRollover } from '@/data/budgets';
import { budgetHistory, budgetReport, suggestBudgets, type BudgetStatus } from '@/engine/budgets';
import { addMonths, formatMonth, monthKey, monthRange } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';
import { SimpleTable } from '@/ui/charts';
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
  const [view, setView] = useState<'month' | 'history'>('month');
  const historyMonths = useMemo(() => a.completeMonths.slice(-6).map((m) => m.month), [a.completeMonths]);
  const history = useMemo(() => (budgets ? budgetHistory(a.lines, a.categoryMap, budgets, historyMonths) : []), [a.lines, a.categoryMap, budgets, historyMonths]);
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
          {budgets.length > 0 && (
            <Segmented
              ariaLabel="Budget view"
              value={view}
              onChange={setView}
              options={[
                { value: 'month', label: 'Month' },
                { value: 'history', label: 'History' },
              ]}
            />
          )}
          {view === 'month' && (
          <Select aria-label="Budget month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-36">
            {monthRange(firstMonth < addMonths(current, -12) ? addMonths(current, -12) : firstMonth, current)
              .reverse()
              .map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
          </Select>
          )}
          <Button size="sm" onClick={() => setEditing(true)}>
            {budgets.length ? 'Edit budgets' : 'Set budgets'}
          </Button>
        </>
      }
    >
      {view === 'history' && budgets.length > 0 ? (
        <BudgetHistoryTable history={history} a={a} />
      ) : report.lines.length === 0 ? (
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
              const pct = Math.min(1, Number.isFinite(l.usedShare) ? l.usedShare : 1);
              return (
                <li key={l.categoryId} className="grid gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryDot color={c?.color} />
                    <span className="font-medium">{c?.name}</span>
                    {c?.essential && <span className="text-xs text-muted">essential</span>}
                    <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                    {l.carried !== 0 && (
                      <span className={`text-xs ${l.carried > 0 ? 'text-good' : 'text-bad'}`} title="Carried over from earlier months">
                        {formatMoney(l.carried, { whole: true, signed: true })} carried
                      </span>
                    )}
                    <span className="ml-auto tabular">
                      {formatMoney(l.actual, { whole: true })} of {formatMoney(l.available, { whole: true })}
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
                      <div aria-hidden className="absolute inset-y-[-2px] w-0.5 bg-[var(--ink-2)]" style={{ left: `${Math.min(1, l.available > 0 ? l.expectedByNow / l.available : 0) * 100}%` }} title="Expected by today" />
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
  const budgetMap = new Map((budgets ?? []).map((b) => [b.categoryId, b]));
  const expense = a.categories.filter((c) => c.kind === 'expense' && !c.archived);
  const total = (budgets ?? []).reduce((s, b) => s + b.monthlyAmount, 0);
  return (
    <Modal open={open} onClose={onClose} title="Monthly budgets" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p className="mb-3 text-sm text-ink-2">Changes save as you type. Leave blank for no budget. “Typical” is the median of your last three complete months.</p>
      <div className="grid gap-2">
        {expense.map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_8rem_6rem] items-center gap-x-2 gap-y-1 text-sm">
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
            {byCat.has(c.id) && (
              <div className="col-span-3 pl-5">
                <Checkbox
                  label="Roll over unspent or overspent amounts to next month"
                  checked={!!budgetMap.get(c.id)?.rollover}
                  onChange={(v) => setBudgetRollover(c.id, v, monthKey(a.today))}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm font-semibold">Total: {formatMoney(total, { whole: true })} per month</p>
    </Modal>
  );
}

function BudgetHistoryTable({ history, a }: { history: ReturnType<typeof budgetHistory>; a: Analytics }) {
  if (history.length === 0) return <p className="text-sm text-ink-2">History appears once you have complete months of transactions.</p>;
  const cats = history[0]!.cells.map((c) => c.categoryId);
  const cell = (budget: number, actual: number) => (
    <span className={actual > budget ? 'text-bad' : ''} title={`${formatMoney(actual)} of ${formatMoney(budget)}`}>
      {formatMoney(actual, { whole: true })}
      <span className="text-xs text-muted"> / {formatMoney(budget, { whole: true })}</span>
    </span>
  );
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs text-muted">Actual / budget for the last {history.length} complete months, using today’s budget amounts. Red means over budget.</p>
      <SimpleTable
        headers={['Category', ...history.map((h) => formatMonth(h.month, true))]}
        align={['left', ...history.map(() => 'right' as const)]}
        rows={[
          ...cats.map((id) => [a.categoryMap.get(id)?.name ?? id, ...history.map((h) => { const c = h.cells.find((x) => x.categoryId === id)!; return cell(c.budget, c.actual); })]),
          [<strong key="t">Total</strong>, ...history.map((h) => cell(h.totalBudget, h.totalActual))],
        ]}
      />
    </div>
  );
}
