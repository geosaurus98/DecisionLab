/**
 * Shared chart conventions: theme-aware colours via CSS variables, one y-axis per chart,
 * recessive grid, compact NZD ticks and a consistent tooltip. Every chart offers a table view.
 */
import { useState, type ReactNode } from 'react';
import { formatMoney, formatMoneyCompact } from '@/domain/money';
import { Segmented } from './components';

export const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--series-${n})`);
export const NEUTRAL = 'var(--series-neutral)';

export const axisProps = {
  tickLine: false,
  axisLine: { stroke: 'var(--axis)' },
  tick: { fill: 'var(--muted)', fontSize: 12 },
} as const;

export const moneyTick = (v: number) => formatMoneyCompact(v);

interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export function MoneyTooltip({ active, payload, label, labelFormatter }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  labelFormatter?: (l: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <p className="mb-1 font-semibold text-ink">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-ink-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-medium text-ink tabular">{typeof p.value === 'number' ? formatMoney(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Wraps a chart with a Chart / Table toggle so values are never available through colour alone. */
export function ChartWithTable({ chart, table, height = 280, label }: { chart: ReactNode; table: ReactNode; height?: number; label: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Segmented
          ariaLabel={`${label} view`}
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: 'Chart' },
            { value: 'table', label: 'Table' },
          ]}
        />
      </div>
      {view === 'chart' ? <div style={{ height }} className="w-full">{chart}</div> : <div className="max-h-[420px] overflow-auto">{table}</div>}
    </div>
  );
}

export function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span aria-hidden className="inline-block h-0.5 w-4" style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
      {label}
    </span>
  );
}

export function SimpleTable({ headers, rows, align }: { headers: string[]; rows: ReactNode[][]; align?: ('left' | 'right')[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-surface">
        <tr className="border-b border-border text-left text-xs text-muted">
          {headers.map((h, i) => (
            <th key={h || `col-${i}`} scope="col" className={`px-2 py-1.5 font-medium ${align?.[i] === 'right' ? 'text-right' : ''}`}>
              {h || <span className="sr-only">Actions</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/60 last:border-0">
            {r.map((c, j) => (
              <td key={j} className={`px-2 py-1.5 ${align?.[j] === 'right' ? 'text-right tabular' : ''}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
