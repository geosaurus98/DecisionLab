import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, EmptyState, Input, PageHeader, Select, Spinner } from '@/ui/components';
import { db } from '@/data/db';
import { formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import type { DecisionStatus } from '@/domain/types';
import { CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE } from './labels';

export function DecisionsPage() {
  const navigate = useNavigate();
  const decisions = useLiveQuery(() => db.decisions.orderBy('date').reverse().toArray(), []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | DecisionStatus>('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (decisions ?? []).filter(
      (d) =>
        (!status || d.status === status) &&
        (!s || [d.title, d.description, d.reasoning, d.notes, ...d.options.map((o) => o.name), d.review?.lessons ?? ''].some((x) => x.toLowerCase().includes(s))),
    );
  }, [decisions, q, status]);

  if (!decisions) return <Spinner />;
  return (
    <div>
      <PageHeader
        title="Decisions"
        description="Your decision journal: options, criteria, the reasoning at the time, and what actually happened."
        actions={
          <Button variant="primary" onClick={() => navigate('/decisions/new')}>
            New decision
          </Button>
        }
      />
      {decisions.length === 0 ? (
        <EmptyState title="No decisions yet" action={<Button variant="primary" onClick={() => navigate('/decisions/new')}>Create your first decision</Button>}>
          Start with something real you are weighing up — a purchase, a trip, or a change to your savings.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <Input aria-label="Search decisions" placeholder="Search titles, options, reasoning, lessons" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as '' | DecisionStatus)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <ul className="grid gap-2">
            {filtered.map((d) => {
              const chosen = d.options.find((o) => o.id === d.selectedOptionId);
              return (
                <li key={d.id}>
                  <Link to={`/decisions/${d.id}`} className="block rounded-xl border border-border bg-surface p-4 hover:border-accent">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{d.title || 'Untitled decision'}</span>
                      <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                      <Badge>{CATEGORY_LABEL[d.category]}</Badge>
                      {d.isDemo && <Badge tone="warn">Demo</Badge>}
                      <span className="ml-auto text-xs text-muted">{formatDate(d.date)}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-2">
                      {d.options.map((o) => o.name).join(' vs ')}
                      {chosen && (
                        <>
                          {' '}
                          → <strong className="text-ink">{chosen.name}</strong>
                          {chosen.upfrontCost > 0 && ` (${formatMoney(chosen.upfrontCost, { whole: true })})`}
                        </>
                      )}
                    </p>
                    {d.review && (
                      <p className="mt-1 text-xs text-muted">
                        Reviewed: satisfaction {d.review.satisfaction}/10
                        {d.snapshot?.predictedSatisfaction ? ` (predicted ${d.snapshot.predictedSatisfaction}/10)` : ''}
                        {d.review.lessons ? ` · Lesson: ${d.review.lessons}` : ''}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 && <p className="text-sm text-ink-2">No decisions match.</p>}
        </div>
      )}
    </div>
  );
}
