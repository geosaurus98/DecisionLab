import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, Card, Metric, PageHeader, Spinner } from '@/ui/components';
import { useAnalytics, useFlexibility } from '@/hooks/useAppData';
import { db } from '@/data/db';
import { loadDemoData } from '@/data/demo/load';
import { addMonths, formatDate, formatMonth } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';
import { useToast } from '@/ui/toast';
import { FlexibilityPanel } from './FlexibilityPanel';
import { STATUS_LABEL } from '../decisions/labels';

export function OverviewPage() {
  const a = useAnalytics();
  const flex = useFlexibility(a);
  const navigate = useNavigate();
  const toast = useToast();
  const decisions = useLiveQuery(() => db.decisions.orderBy('updatedAt').reverse().toArray(), []);

  if (a.loading || !decisions) return <Spinner />;

  const hasData = a.transactions.length > 0;
  const last = a.completeMonths.at(-1);
  const prev = a.completeMonths.find((m) => m.month === addMonths(last?.month ?? '', -1));
  const dueReviews = decisions.filter((d) => (d.status === 'decided' || d.status === 'completed') && d.reviewDate && d.reviewDate <= a.today);
  const open = decisions.filter((d) => d.status === 'considering');

  const delta = (cur: number, before?: number) =>
    before === undefined ? undefined : `${formatMoney(cur - before, { signed: true, whole: true })} vs ${formatMonth(addMonths(last!.month, -1), true)}`;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Overview"
        description="Understand your past → decide better today → explore possible futures → learn from outcomes."
        actions={
          <>
            <Button onClick={() => navigate('/transactions')}>Import transactions</Button>
            <Button variant="primary" onClick={() => navigate('/decisions/new')}>
              New decision
            </Button>
          </>
        }
      />

      {!hasData && (
        <Card title="Get started">
          <ol className="grid gap-3 text-sm sm:grid-cols-3">
            <li className="rounded-lg border border-border p-3">
              <p className="font-semibold">1 · Bring in your history</p>
              <p className="mt-1 text-ink-2">Import a CSV statement from your bank. Files are processed in this browser and never uploaded.</p>
              <Button className="mt-3" size="sm" variant="primary" onClick={() => navigate('/transactions')}>
                Import CSV
              </Button>
            </li>
            <li className="rounded-lg border border-border p-3">
              <p className="font-semibold">…or explore with demo data</p>
              <p className="mt-1 text-ink-2">A synthetic year for a fictional Wellington graduate engineer, clearly labelled and removable in one click.</p>
              <Button
                className="mt-3"
                size="sm"
                onClick={async () => {
                  await loadDemoData();
                  toast({ message: 'Synthetic demonstration data loaded.', tone: 'good' });
                }}
              >
                Load demo data
              </Button>
            </li>
            <li className="rounded-lg border border-border p-3">
              <p className="font-semibold">2 · Make a decision</p>
              <p className="mt-1 text-ink-2">Compare alternatives on your own criteria, see the financial consequences, and record your choice to review later.</p>
              <Button className="mt-3" size="sm" onClick={() => navigate('/decisions/new')}>
                New decision
              </Button>
            </li>
          </ol>
        </Card>
      )}

      {hasData && last && (
        <section aria-labelledby="last-month">
          <h2 id="last-month" className="mb-2 text-sm font-semibold text-ink-2">
            {formatMonth(last.month)} (last complete month)
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Income" value={formatMoney(last.income, { whole: true })} sub={delta(last.income, prev?.income)} definition={DEFINITIONS.income} provenance="known" />
            <Metric label="Spending" value={formatMoney(last.spending, { whole: true })} sub={delta(last.spending, prev?.spending)} definition={DEFINITIONS.spending} provenance="known" />
            <Metric
              label="Net cash flow"
              value={formatMoney(last.netCashFlow, { whole: true })}
              tone={last.netCashFlow < 0 ? 'bad' : undefined}
              definition={DEFINITIONS.netCashFlow}
              provenance="known"
            />
            <Metric label="Savings rate" value={last.savingsRate === null ? '—' : formatPercent(last.savingsRate)} definition={DEFINITIONS.savingsRate} provenance="known" />
          </div>
        </section>
      )}

      {hasData && flex && (
        <Card
          title="Financial flexibility"
          description="How much money is realistically available for discretionary decisions. Each line shows whether it is known, estimated or entered by you."
          actions={
            <Button size="sm" onClick={() => navigate('/settings')}>
              Edit balances & plan
            </Button>
          }
        >
          <FlexibilityPanel estimate={flex} />
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Decisions due for review" description="Compare what you expected with what actually happened.">
          {dueReviews.length === 0 ? (
            <p className="text-sm text-ink-2">Nothing due. Set a review date when you record a choice.</p>
          ) : (
            <ul className="grid gap-2">
              {dueReviews.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link to={`/decisions/${d.id}`} className="font-medium text-accent hover:underline">
                    {d.title}
                  </Link>
                  <span className="text-xs text-muted">due {formatDate(d.reviewDate!)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Open decisions" actions={<Button size="sm" onClick={() => navigate('/decisions')}>All decisions</Button>}>
          {open.length === 0 ? (
            <p className="text-sm text-ink-2">No decisions under consideration.</p>
          ) : (
            <ul className="grid gap-2">
              {open.slice(0, 5).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link to={`/decisions/${d.id}`} className="font-medium text-accent hover:underline">
                    {d.title || 'Untitled decision'}
                  </Link>
                  <Badge>{STATUS_LABEL[d.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
