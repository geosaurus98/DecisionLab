import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { ChartWithTable, MoneyTooltip, SERIES, SimpleTable, axisProps, moneyTick } from '@/ui/charts';
import { Segmented } from '@/ui/components';
import type { ProjectionResult } from '@/engine/projection';
import { formatMonth } from '@/domain/dates';
import { formatMoney } from '@/domain/money';

export function ProjectionChart({ series, target }: { series: { id: string; name: string; result: ProjectionResult }[]; target?: number }) {
  const [basis, setBasis] = useState<'real' | 'nominal'>('real');
  const length = Math.max(0, ...series.map((s) => s.result.points.length));
  const data = Array.from({ length }, (_, t) => {
    const row: Record<string, number | string> = { month: series[0]?.result.points[t]?.month ?? '' };
    for (const s of series) {
      const p = s.result.points[t];
      if (p) row[s.id] = basis === 'real' ? p.real : p.nominal;
    }
    return row;
  });
  const step = Math.max(1, Math.round(length / 12));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Value basis"
          value={basis}
          onChange={setBasis}
          options={[
            { value: 'real', label: "Today's dollars" },
            { value: 'nominal', label: 'Nominal' },
          ]}
        />
        <span className="text-xs text-muted">{basis === 'real' ? 'Adjusted for inflation to start-month dollars.' : 'Future dollars, not adjusted for inflation.'}</span>
      </div>
      <ChartWithTable
        label="Projection"
        height={300}
        chart={
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickFormatter={(m) => formatMonth(String(m), true)} interval={step - 1} {...axisProps} />
              <YAxis tickFormatter={moneyTick} width={60} {...axisProps} />
              <Tooltip content={<MoneyTooltip labelFormatter={(l) => `End of ${formatMonth(String(l))}`} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              {target !== undefined && basis === 'nominal' && (
                <ReferenceLine y={target} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'Target', fill: 'var(--muted)', fontSize: 11, position: 'insideTopLeft' }} />
              )}
              {series.map((s, i) => (
                <Line key={s.id} dataKey={s.id} name={s.name} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        }
        table={
          <SimpleTable
            headers={['Month', ...series.map((s) => s.name)]}
            align={['left', ...series.map(() => 'right' as const)]}
            rows={data.filter((_, i) => i % step === step - 1 || i === data.length - 1).map((r) => [formatMonth(String(r.month)), ...series.map((s) => formatMoney(Number(r[s.id] ?? 0)))])}
          />
        }
      />
    </div>
  );
}
