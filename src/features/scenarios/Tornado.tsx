import type { SensitivityDriver } from '@/engine/sensitivity';
import { formatMoney } from '@/domain/money';

/**
 * Tornado chart drawn with plain HTML so every value is also present as text.
 * Bars extend left/right from the base value for the low/high perturbation.
 */
export function Tornado({ drivers, valueLabel }: { drivers: SensitivityDriver[]; valueLabel: string }) {
  if (drivers.length === 0) return null;
  const base = drivers[0]!.base;
  const maxDev = Math.max(1, ...drivers.flatMap((d) => [Math.abs(d.low - base), Math.abs(d.high - base)]));
  const pct = (v: number) => `${(Math.abs(v - base) / maxDev) * 50}%`;
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-xs text-muted">
        Base case: <span className="font-medium text-ink tabular">{formatMoney(base)}</span> ({valueLabel}). Each row re-runs the projection with one assumption changed.
      </p>
      {drivers.map((d) => {
        const lowLeft = d.low < base;
        return (
          <div key={d.key} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:items-center">
            <span className="text-ink-2">{d.label}</span>
            <div>
              <div className="relative h-5 rounded bg-surface-2" aria-hidden>
                <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--axis)]" />
                <div
                  className="absolute inset-y-0.5 rounded-sm"
                  style={{ background: 'var(--series-8)', width: pct(d.low), [lowLeft ? 'right' : 'left']: '50%' }}
                />
                <div
                  className="absolute inset-y-0.5 rounded-sm"
                  style={{ background: 'var(--series-1)', width: pct(d.high), [d.high < base ? 'right' : 'left']: '50%', opacity: 0.85 }}
                />
              </div>
              <p className="mt-0.5 flex justify-between text-xs text-muted tabular">
                <span>
                  low ({d.lowLabel}): {formatMoney(d.low)}
                </span>
                <span>
                  high ({d.highLabel}): {formatMoney(d.high)}
                </span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
