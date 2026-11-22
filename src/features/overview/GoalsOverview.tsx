import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from '@/ui/components';
import { db } from '@/data/db';
import { goalSaved } from '@/engine/flexibility';
import { useAccounts, type Analytics } from '@/hooks/useAppData';
import { formatMoney } from '@/domain/money';
import { formatDate } from '@/domain/dates';
import { GoalPlanLine } from '../settings/GoalPlan';

export function GoalsOverview({ a }: { a: Analytics }) {
  const goals = useLiveQuery(() => db.goals.toArray(), []);
  const accounts = useAccounts();
  if (!goals || !accounts || goals.length === 0) return null;
  return (
    <Card title="Goals" actions={<Link to="/settings" className="text-sm text-accent underline">Edit goals</Link>}>
      <ul className="grid gap-3">
        {goals.map((g) => {
          const saved = goalSaved(g, accounts, a.transactions);
          const progress = g.targetAmount > 0 ? Math.min(1, Math.max(0, saved / g.targetAmount)) : 0;
          return (
            <li key={g.id} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{g.name}</span>
                {g.targetDate && <span className="text-xs text-muted">by {formatDate(g.targetDate)}</span>}
                <span className="ml-auto tabular">
                  {formatMoney(saved, { whole: true })} / {formatMoney(g.targetAmount, { whole: true })}
                </span>
              </div>
              <div className="mt-1 h-2 rounded bg-surface-2" role="progressbar" aria-label={`${g.name} progress`} aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-2 rounded bg-accent" style={{ width: `${progress * 100}%` }} />
              </div>
              <GoalPlanLine goal={g} saved={saved} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
