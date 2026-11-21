import { useMemo, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Button, Checkbox, Field, InfoTip, Notice, NumberInput, PercentInput, Segmented, Select, Spinner } from '@/ui/components';
import { ChartWithTable, SimpleTable, axisProps, moneyTick } from '@/ui/charts';
import type { MonteCarloConfig, ProjectionAssumptions, ScenarioVariant } from '@/domain/types';
import { DEFAULT_MONTE_CARLO, histogram } from '@/engine/montecarlo';
import { project } from '@/engine/projection';
import { useMonteCarlo } from '@/hooks/useMonteCarlo';
import { addMonths, formatMonth } from '@/domain/dates';
import { formatMoney, formatMoneyCompact, formatPercent } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';

export const DEFAULT_MC_CONFIG: MonteCarloConfig = { enabled: false, ...DEFAULT_MONTE_CARLO };

const PRESETS = [
  { label: 'Cash / term deposit', value: 0.005 },
  { label: 'Conservative fund', value: 0.05 },
  { label: 'Balanced fund', value: 0.09 },
  { label: 'Growth fund', value: 0.12 },
  { label: 'Aggressive / all shares', value: 0.16 },
];

type Variant = Pick<ScenarioVariant, 'id' | 'name' | 'oneOffs' | 'recurring' | 'contributionDelta'>;

export function MonteCarloPanel({ assumptions, variants, config, onChange, idPrefix }: {
  assumptions: ProjectionAssumptions;
  variants: Variant[];
  config: MonteCarloConfig | undefined;
  onChange: (c: MonteCarloConfig) => void;
  idPrefix: string;
}) {
  const cfg = config ?? DEFAULT_MC_CONFIG;
  const { result, running, error, ms } = useMonteCarlo(assumptions, variants, cfg);
  const [focus, setFocus] = useState('');
  const [basis, setBasis] = useState<'real' | 'nominal'>('real');
  const set = (patch: Partial<MonteCarloConfig>) => onChange({ ...cfg, ...patch });
  const focused = result?.variants.find((v) => v.variantId === focus) ?? result?.variants[0];
  const deterministic = useMemo(() => {
    const v = variants.find((x) => x.id === focused?.variantId);
    try {
      return v ? project(assumptions, v) : null;
    } catch {
      return null;
    }
  }, [variants, focused?.variantId, assumptions]);
  const name = (id: string) => variants.find((v) => v.id === id)?.name ?? '';

  const fanData = useMemo(
    () =>
      (focused?.fan ?? []).map((p) => {
        const s = p[basis];
        const det = deterministic?.points[p.t];
        return {
          month: addMonths(assumptions.startMonth, p.t),
          outer: [s.p10, s.p90] as [number, number],
          inner: [s.p25, s.p75] as [number, number],
          p50: s.p50,
          deterministic: det ? (basis === 'real' ? det.real : det.nominal) : undefined,
        };
      }),
    [focused, basis, deterministic, assumptions.startMonth],
  );
  const hist = useMemo(() => (focused ? histogram(focused.finalRealSorted, 30) : []), [focused]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-end pb-2 lg:col-span-4">
          <Checkbox
            label="Simulate uncertain investment returns (Monte Carlo)"
            hint="Repeats the projection thousands of times with randomly varying returns around your expected return."
            checked={cfg.enabled}
            onChange={(v) => set({ enabled: v })}
          />
        </div>
        {cfg.enabled && (
          <>
            <Field
              label={
                <span className="inline-flex items-center gap-1">
                  Annual volatility <InfoTip>{DEFINITIONS.volatility}</InfoTip>
                </span>
              }
              htmlFor={`${idPrefix}-vol`}
            >
              <PercentInput id={`${idPrefix}-vol`} min={0} max={60} step={0.5} value={cfg.annualVolatility} onChange={(v) => set({ annualVolatility: v })} />
            </Field>
            <Field label="Typical volatility (rough)" htmlFor={`${idPrefix}-preset`}>
              <Select
                id={`${idPrefix}-preset`}
                value={PRESETS.find((p) => Math.abs(p.value - cfg.annualVolatility) < 1e-9)?.value ?? ''}
                onChange={(e) => e.target.value && set({ annualVolatility: Number(e.target.value) })}
              >
                <option value="">Custom</option>
                {PRESETS.map((p) => (
                  <option key={p.label} value={p.value}>
                    {p.label} · {formatPercent(p.value, 1)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Simulation runs" htmlFor={`${idPrefix}-runs`}>
              <Select id={`${idPrefix}-runs`} value={cfg.runs} onChange={(e) => set({ runs: Number(e.target.value) })}>
                {[1000, 2000, 5000, 10000, 20000].map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Random seed" htmlFor={`${idPrefix}-seed`} hint="Same seed ⇒ identical results">
              <div className="flex gap-2">
                <NumberInput id={`${idPrefix}-seed`} min={0} max={4294967295} value={cfg.seed} onChange={(v) => v !== null && set({ seed: Math.round(v) })} />
                <Button size="sm" className="h-10" onClick={() => set({ seed: Math.floor(Math.random() * 4294967295) })}>
                  New
                </Button>
              </div>
            </Field>
          </>
        )}
      </div>

      {cfg.enabled && (
        <>
          <Notice tone="warn" title="Illustrative, not a forecast">
            These ranges show how outcomes vary <em>if</em> returns behave like independent random draws with the mean and volatility above. Real markets
            have crashes, long slumps and regime changes this model does not capture. More runs make the percentiles more precise for this model — not more
            likely to be right.
          </Notice>
          {error && <Notice tone="bad">{error}</Notice>}
          {running && !result && <Spinner label="Simulating" />}
          {result && focused && (
            <div className={running ? 'opacity-60 transition-opacity' : ''} aria-busy={running}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Select aria-label="Alternative to chart" value={focused.variantId} onChange={(e) => setFocus(e.target.value)} className="h-8 w-52">
                  {result.variants.map((v) => (
                    <option key={v.variantId} value={v.variantId}>
                      {v.name}
                    </option>
                  ))}
                </Select>
                <Segmented
                  ariaLabel="Value basis"
                  value={basis}
                  onChange={setBasis}
                  options={[
                    { value: 'real', label: "Today's dollars" },
                    { value: 'nominal', label: 'Nominal' },
                  ]}
                />
              </div>
              <ChartWithTable
                label="Simulated range"
                height={300}
                chart={
                  <ResponsiveContainer>
                    <ComposedChart data={fanData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="month" tickFormatter={(m) => formatMonth(String(m), true)} minTickGap={24} {...axisProps} />
                      <YAxis tickFormatter={moneyTick} width={60} {...axisProps} />
                      <Tooltip content={<FanTooltip />} />
                      <ReferenceLine y={0} stroke="var(--axis)" />
                      <Area dataKey="outer" name="10th–90th percentile" stroke="none" fill="var(--series-1)" fillOpacity={0.15} isAnimationActive={false} />
                      <Area dataKey="inner" name="25th–75th percentile" stroke="none" fill="var(--series-1)" fillOpacity={0.3} isAnimationActive={false} />
                      <Line dataKey="p50" name="Median" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line dataKey="deterministic" name="Deterministic projection" stroke="var(--ink-2)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                }
                table={
                  <SimpleTable
                    headers={['Month', 'P10', 'P25', 'Median', 'P75', 'P90']}
                    align={['left', 'right', 'right', 'right', 'right', 'right']}
                    rows={fanData.map((r) => [formatMonth(r.month), formatMoney(r.outer[0]), formatMoney(r.inner[0]), formatMoney(r.p50), formatMoney(r.inner[1]), formatMoney(r.outer[1])])}
                  />
                }
              />
              <div className="mt-1 flex flex-wrap gap-4 text-xs text-ink-2">
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-4 rounded-sm bg-[var(--series-1)] opacity-30" />25th–75th</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-4 rounded-sm bg-[var(--series-1)] opacity-15" />10th–90th</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 bg-[var(--series-1)]" />Median</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="w-4 border-t-2 border-dashed border-[var(--ink-2)]" />Deterministic</span>
              </div>

              <h3 className="mb-1 mt-5 text-sm font-semibold">Outcomes at the horizon (today’s dollars)</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-2 py-1.5 font-medium">Alternative</th>
                      <th className="px-2 py-1.5 text-right font-medium">Pessimistic (P10)</th>
                      <th className="px-2 py-1.5 text-right font-medium">Median</th>
                      <th className="px-2 py-1.5 text-right font-medium">Optimistic (P90)</th>
                      {assumptions.targetAmount !== undefined && <th className="px-2 py-1.5 text-right font-medium">Reaches target</th>}
                      <th className="px-2 py-1.5 text-right font-medium">Ends below money put in</th>
                      <th className="px-2 py-1.5 text-right font-medium">Ever negative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.variants.map((v) => (
                      <tr key={v.variantId} className="border-b border-border/60">
                        <td className="px-2 py-1.5">{v.name}</td>
                        <td className="px-2 py-1.5 text-right tabular">{formatMoney(v.finalReal.p10, { whole: true })}</td>
                        <td className="px-2 py-1.5 text-right font-medium tabular">{formatMoney(v.finalReal.p50, { whole: true })}</td>
                        <td className="px-2 py-1.5 text-right tabular">{formatMoney(v.finalReal.p90, { whole: true })}</td>
                        {assumptions.targetAmount !== undefined && <td className="px-2 py-1.5 text-right tabular">{formatPercent(v.probTargetAtEnd ?? 0, 0)}</td>}
                        <td className="px-2 py-1.5 text-right tabular">{formatPercent(v.probLoss, 0)}</td>
                        <td className="px-2 py-1.5 text-right tabular">{v.probShortfall > 0 ? <Badge tone="bad">{formatPercent(v.probShortfall, 0)}</Badge> : '0%'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.differences.length > 0 && (
                <>
                  <h3 className="mb-1 mt-5 flex items-center gap-1.5 text-sm font-semibold">
                    Difference between alternatives (today’s dollars) <InfoTip>{DEFINITIONS.mcDifference}</InfoTip>
                  </h3>
                  <SimpleTable
                    headers={['Comparison', 'P10', 'Median', 'P90', 'First ends ahead in']}
                    align={['left', 'right', 'right', 'right', 'right']}
                    rows={result.differences.map((d) => [
                      `${name(d.aId)} − ${name(d.bId)}`,
                      formatMoney(d.diff.p10, { whole: true }),
                      formatMoney(d.diff.p50, { whole: true }),
                      formatMoney(d.diff.p90, { whole: true }),
                      `${formatPercent(d.probAAhead, 0)} of runs`,
                    ])}
                  />
                </>
              )}

              <h3 className="mb-1 mt-5 text-sm font-semibold">Distribution of final balance: {focused.name}</h3>
              <ChartWithTable
                label="Distribution"
                height={200}
                chart={
                  <ResponsiveContainer>
                    <BarChart data={hist.map((h) => ({ ...h, mid: (h.from + h.to) / 2, share: h.count / result.runs }))} barCategoryGap={1}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="mid" tickFormatter={(v) => formatMoneyCompact(Number(v))} minTickGap={30} {...axisProps} />
                      <YAxis tickFormatter={(v) => formatPercent(Number(v), 0)} width={44} {...axisProps} />
                      <Tooltip
                        content={({ active, payload }) => {
                          const p = payload?.[0]?.payload as { from: number; to: number; share: number } | undefined;
                          if (!active || !p) return null;
                          return (
                            <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
                              {formatMoney(p.from, { whole: true })} – {formatMoney(p.to, { whole: true })}: {formatPercent(p.share, 1)} of runs
                            </div>
                          );
                        }}
                        cursor={{ fill: 'var(--surface-2)' }}
                      />
                      <Bar dataKey="share" fill="var(--series-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                }
                table={
                  <SimpleTable
                    headers={['From', 'To', 'Share of runs']}
                    align={['right', 'right', 'right']}
                    rows={hist.map((h) => [formatMoney(h.from, { whole: true }), formatMoney(h.to, { whole: true }), formatPercent(h.count / result.runs, 1)])}
                  />
                }
              />
              <p className="mt-2 text-xs text-muted">
                {result.runs.toLocaleString()} runs · seed {result.settings.seed} · expected return {formatPercent(assumptions.annualReturn)} ± {formatPercent(result.settings.annualVolatility)} a year
                {ms !== null && ` · computed in ${Math.round(ms)} ms`}. The extreme 0.5% at each end is trimmed from the histogram.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FanTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: { outer: [number, number]; inner: [number, number]; p50: number; deterministic?: number } }[]; label?: string }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const row = (k: string, v: number) => (
    <p className="flex justify-between gap-4 text-ink-2">
      <span>{k}</span>
      <span className="font-medium text-ink tabular">{formatMoney(v, { whole: true })}</span>
    </p>
  );
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold">End of {label ? formatMonth(label) : ''}</p>
      {row('90th percentile', p.outer[1])}
      {row('75th percentile', p.inner[1])}
      {row('Median', p.p50)}
      {row('25th percentile', p.inner[0])}
      {row('10th percentile', p.outer[0])}
      {p.deterministic !== undefined && row('Deterministic', p.deterministic)}
    </div>
  );
}

