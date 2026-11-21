import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Card, EmptyState, Metric, Notice, PageHeader, Spinner } from '@/ui/components';
import { SimpleTable } from '@/ui/charts';
import { db } from '@/data/db';
import { calibrate, MIN_SAMPLE_FOR_PATTERN } from '@/engine/insights';
import { formatPercent } from '@/domain/money';
import { useAnalytics } from '@/hooks/useAppData';
import { comparePeriods } from '@/engine/cashflow';
import { addMonths, firstDayOfMonth, formatMonth, lastDayOfMonth } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { CATEGORY_LABEL } from '../decisions/labels';

export function InsightsPage() {
  const decisions = useLiveQuery(() => db.decisions.toArray(), []);
  const a = useAnalytics();
  const cal = useMemo(() => (decisions ? calibrate(decisions) : null), [decisions]);
  const behaviour = useMemo(() => {
    if (a.completeMonths.length < 6) return null;
    const end = a.lastComplete;
    return comparePeriods(
      a.lines,
      a.categoryMap,
      { start: firstDayOfMonth(addMonths(end, -5)), end: lastDayOfMonth(addMonths(end, -3)) },
      { start: firstDayOfMonth(addMonths(end, -2)), end: lastDayOfMonth(end) },
    ).filter((c) => Math.abs(c.change) >= 2_000 && c.relative !== null && Math.abs(c.relative) >= 0.15);
  }, [a]);

  if (!decisions || !cal || a.loading) return <Spinner />;
  const small = cal.reviewed < MIN_SAMPLE_FOR_PATTERN;
  const lessons = decisions.filter((d) => d.review?.lessons).sort((x, y) => (y.review!.reviewedAt > x.review!.reviewedAt ? 1 : -1));
  const best = decisions.filter((d) => d.review && d.review.satisfaction >= 8);

  return (
    <div className="grid gap-5">
      <PageHeader title="Insights" description="Patterns in how your predictions compare with reality. Every figure shows how many decisions it is based on." />

      {cal.reviewed === 0 ? (
        <EmptyState title="No reviewed decisions yet">
          Record a choice on a decision, set a review date, and come back to enter what actually happened. Insights appear as reviews accumulate.
        </EmptyState>
      ) : (
        <>
          {small && (
            <Notice tone="warn" title={`Based on only ${cal.reviewed} reviewed decision${cal.reviewed === 1 ? '' : 's'}`}>
              These are observations, not patterns. At least {MIN_SAMPLE_FOR_PATTERN} reviews are needed before treating any tendency as meaningful — and even
              then, a handful of decisions can mislead.
            </Notice>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Cost estimates"
              value={cal.medianCostError === null ? '—' : `${cal.medianCostError > 0 ? '+' : ''}${formatPercent(cal.medianCostError, 0)}`}
              sub={`median actual vs predicted · n=${cal.costSample} (${cal.linkedCostSample} measured from linked transactions)`}
              definition="Median of (actual cost − predicted cost) ÷ predicted cost. Positive means costs were higher than you expected."
            />
            <Metric
              label="Underestimated costs"
              value={cal.underestimatedShare === null ? '—' : formatPercent(cal.underestimatedShare, 0)}
              sub={`of decisions, >5% over · n=${cal.costSample}`}
              definition="Share of reviewed decisions where the actual cost exceeded the prediction by more than 5%."
            />
            <Metric
              label="Satisfaction vs prediction"
              value={cal.meanSatisfactionGap === null ? '—' : `${cal.meanSatisfactionGap > 0 ? '+' : ''}${cal.meanSatisfactionGap.toFixed(1)}`}
              sub={`points on a 10-point scale · n=${cal.satisfactionSample}`}
              definition="Mean of (actual satisfaction − predicted satisfaction). Negative means you tend to be over-optimistic."
            />
            <Metric
              label="Would choose again"
              value={cal.wouldRepeatShare === null ? '—' : formatPercent(cal.wouldRepeatShare, 0)}
              sub={`n=${cal.reviewed}`}
              definition="Share of reviewed decisions where you said you would make the same choice again."
            />
          </div>
          {!small && cal.underestimatedShare !== null && cal.underestimatedShare >= 0.6 && (
            <Notice tone="info" title="Possible pattern: costs tend to run over">
              In {formatPercent(cal.underestimatedShare, 0)} of {cal.costSample} decisions the real cost exceeded your estimate. Consider adding a contingency
              (e.g. {formatPercent(Math.max(0.05, cal.medianCostError ?? 0), 0)}) to future estimates.
            </Notice>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="By decision category">
              <SimpleTable
                headers={['Category', 'Reviewed', 'Median cost error', 'Avg satisfaction']}
                align={['left', 'right', 'right', 'right']}
                rows={cal.byCategory.map((c) => [
                  CATEGORY_LABEL[c.category],
                  c.n,
                  c.medianCostError === null ? '—' : `${c.medianCostError > 0 ? '+' : ''}${formatPercent(c.medianCostError, 0)}`,
                  `${c.meanSatisfaction.toFixed(1)}/10`,
                ])}
              />
            </Card>
            <Card title="Confidence vs outcome" description="Were you right to be confident? Share who would choose the same again, by confidence when deciding.">
              <SimpleTable
                headers={['Confidence', 'Decisions', 'Would repeat']}
                align={['left', 'right', 'right']}
                rows={cal.confidenceCalibration.map((c) => [`${c.confidence}/5`, c.n, formatPercent(c.wouldRepeatShare, 0)])}
              />
            </Card>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Highest satisfaction">
              {best.length === 0 ? (
                <p className="text-sm text-ink-2">No decisions rated 8/10 or higher yet.</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {best.map((d) => (
                    <li key={d.id}>
                      <Link to={`/decisions/${d.id}`} className="text-accent hover:underline">
                        {d.title}
                      </Link>{' '}
                      <Badge tone="good">{d.review!.satisfaction}/10</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Lessons you recorded">
              <ul className="grid gap-2 text-sm">
                {lessons.slice(0, 8).map((d) => (
                  <li key={d.id}>
                    <span className="text-ink">“{d.review!.lessons}”</span> <span className="text-xs text-muted">— {d.title}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}

      <Card title="Spending behaviour changes" description="Categories whose monthly spending changed by at least 15% and $20 between the last three complete months and the three before.">
        {behaviour === null ? (
          <p className="text-sm text-ink-2">Needs at least six complete months of transactions.</p>
        ) : behaviour.length === 0 ? (
          <p className="text-sm text-ink-2">No notable changes.</p>
        ) : (
          <SimpleTable
            headers={['Category', `${formatMonth(addMonths(a.lastComplete, -5), true)}–${formatMonth(addMonths(a.lastComplete, -3), true)} /mo`, `${formatMonth(addMonths(a.lastComplete, -2), true)}–${formatMonth(a.lastComplete, true)} /mo`, 'Change']}
            align={['left', 'right', 'right', 'right']}
            rows={behaviour.map((c) => [
              c.categoryId ? a.categoryMap.get(c.categoryId)?.name ?? '—' : 'Uncategorised',
              formatMoney(c.a),
              formatMoney(c.b),
              <span key="c" className={c.change > 0 ? 'text-bad' : 'text-good'}>
                {formatMoney(c.change, { signed: true })} ({c.relative! > 0 ? '+' : ''}
                {formatPercent(c.relative!, 0)})
              </span>,
            ])}
          />
        )}
      </Card>
    </div>
  );
}
