import { Field, InfoTip, Input, MoneyInput, NumberInput, PercentInput, Select } from '@/ui/components';
import type { ProjectionAssumptions } from '@/domain/types';

export function AssumptionsEditor({ value, onChange, idPrefix, disabled }: {
  value: ProjectionAssumptions;
  onChange: (a: ProjectionAssumptions) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<ProjectionAssumptions>) => onChange({ ...value, ...patch });
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Start month" htmlFor={id('start')}>
        <Input id={id('start')} type="month" value={value.startMonth} onChange={(e) => e.target.value && set({ startMonth: e.target.value })} />
      </Field>
      <Field label="Horizon (months)" htmlFor={id('horizon')} hint={`${(value.horizonMonths / 12).toFixed(1)} years`}>
        <NumberInput id={id('horizon')} min={1} max={600} value={value.horizonMonths} onChange={(v) => v !== null && set({ horizonMonths: Math.round(v) })} />
      </Field>
      <Field label="Starting balance" htmlFor={id('initial')} hint="Savings/investments the options draw on">
        <MoneyInput id={id('initial')} value={value.initialBalance} onChange={(v) => set({ initialBalance: v ?? 0 })} />
      </Field>
      <Field label="Monthly contribution" htmlFor={id('contrib')}>
        <MoneyInput id={id('contrib')} value={value.monthlyContribution} onChange={(v) => set({ monthlyContribution: v ?? 0 })} />
      </Field>
      <Field
        label={
          <span className="inline-flex items-center gap-1">
            Expected annual return <InfoTip>An assumption, not a promise. Diversified growth funds have historically averaged roughly 5–8% nominal per year, with large year-to-year swings. A savings account might pay 3–5%.</InfoTip>
          </span>
        }
        htmlFor={id('return')}
      >
        <PercentInput id={id('return')} min={-50} max={50} value={value.annualReturn} onChange={(v) => set({ annualReturn: v })} />
      </Field>
      <Field label="Annual fees" htmlFor={id('fee')} hint="% of balance per year">
        <PercentInput id={id('fee')} min={0} max={10} step={0.05} value={value.annualFee} onChange={(v) => set({ annualFee: v })} />
      </Field>
      <Field
        label={
          <span className="inline-flex items-center gap-1">
            Tax on returns <InfoTip>Simplified: this rate is applied to positive monthly gains. NZ PIE funds tax at your prescribed investor rate (10.5%, 17.5% or 28%); FIF rules differ. Use 0% for illustrative pre-tax figures.</InfoTip>
          </span>
        }
        htmlFor={id('tax')}
      >
        <PercentInput id={id('tax')} min={0} max={60} step={0.5} value={value.taxRateOnReturns} onChange={(v) => set({ taxRateOnReturns: v })} />
      </Field>
      <Field label="Inflation" htmlFor={id('infl')} hint="RBNZ target band is 1–3%">
        <PercentInput id={id('infl')} min={-10} max={30} value={value.annualInflation} onChange={(v) => set({ annualInflation: v })} />
      </Field>
      <Field label="Cash-flow timing" htmlFor={id('timing')}>
        <Select id={id('timing')} value={value.timing} onChange={(e) => set({ timing: e.target.value as ProjectionAssumptions['timing'] })}>
          <option value="end">End of month (after growth)</option>
          <option value="start">Start of month (before growth)</option>
        </Select>
      </Field>
      <Field label="Savings target (optional)" htmlFor={id('target')}>
        <MoneyInput id={id('target')} value={value.targetAmount ?? null} onChange={(v) => set({ targetAmount: v ?? undefined })} />
      </Field>
    </fieldset>
  );
}
