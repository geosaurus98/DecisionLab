import { Link } from 'react-router-dom';
import { InfoTip, ProvenanceBadge, cx } from '@/ui/components';
import { formatMoney } from '@/domain/money';
import type { FlexibilityEstimate, FlexLine } from '@/engine/flexibility';
import { DEFINITIONS } from '@/ui/definitions';

function Lines({ lines, total, totalLabel }: { lines: FlexLine[]; total: number | null; totalLabel: string }) {
  return (
    <dl className="text-sm">
      {lines.map((l) => (
        <div key={l.label} className="flex items-center gap-2 border-b border-border/60 py-1.5">
          <dt className="min-w-0 flex-1">
            <span className="block truncate">{l.label}</span>
            {l.detail && <span className="block truncate text-xs text-muted">{l.detail}</span>}
          </dt>
          <ProvenanceBadge provenance={l.provenance} />
          <dd className={cx('w-28 text-right tabular', l.amount < 0 && 'text-ink-2')}>{formatMoney(l.amount)}</dd>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-2 font-semibold">
        <dt className="flex-1">{totalLabel}</dt>
        <dd className={cx('text-right tabular', total !== null && total < 0 && 'text-bad')}>{total === null ? '—' : formatMoney(total)}</dd>
      </div>
    </dl>
  );
}

export function FlexibilityPanel({ estimate, compact }: { estimate: FlexibilityEstimate; compact?: boolean }) {
  return (
    <div className={cx('grid gap-5', !compact && 'lg:grid-cols-2')}>
      <div>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          Available for a one-off decision now <InfoTip>{DEFINITIONS.availableNow}</InfoTip>
        </h3>
        {estimate.availableNowLines.length > 0 ? (
          <Lines lines={estimate.availableNowLines} total={estimate.availableNow} totalLabel="Available now" />
        ) : (
          <p className="text-sm text-ink-2">
            Enter your account balances in <Link className="text-accent underline" to="/settings">Settings</Link> to estimate this.
          </p>
        )}
      </div>
      <div>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          Monthly discretionary capacity <InfoTip>{DEFINITIONS.monthlyCapacity}</InfoTip>
        </h3>
        {estimate.monthlyLines.length > 0 ? (
          <Lines lines={estimate.monthlyLines} total={estimate.monthlyCapacity} totalLabel="Per month" />
        ) : (
          <p className="text-sm text-ink-2">Import at least one complete month of transactions.</p>
        )}
      </div>
      {estimate.warnings.length > 0 && (
        <ul className={cx('grid gap-1 text-xs text-warn', !compact && 'lg:col-span-2')}>
          {estimate.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
