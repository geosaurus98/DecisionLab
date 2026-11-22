import { useMemo, useState } from 'react';
import { Card, Field, InfoTip, PercentInput } from '@/ui/components';
import { SimpleTable } from '@/ui/charts';
import type { ProjectionAssumptions, ScenarioVariant } from '@/domain/types';
import { sequenceStress, validateAssumptions } from '@/engine/projection';
import { formatMoney } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';

type Variant = Pick<ScenarioVariant, 'id' | 'name' | 'oneOffs' | 'recurring' | 'contributionDelta'>;

/** Deterministic stress test: one market fall in the first, middle or final year. */
export function SequenceStressCard({ assumptions, variants }: { assumptions: ProjectionAssumptions; variants: Variant[] }) {
  const [crash, setCrash] = useState(0.3);
  const rows = useMemo(() => {
    if (validateAssumptions(assumptions).length || !(crash > 0 && crash < 1)) return [];
    return variants.map((v) => ({ v, r: sequenceStress(assumptions, v, crash) }));
  }, [assumptions, variants, crash]);
  if (rows.length === 0) return null;
  const years = (assumptions.horizonMonths / 12).toFixed(1);
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          Sequence-of-returns stress test <InfoTip>{DEFINITIONS.sequenceStress}</InfoTip>
        </span>
      }
      description={`Final balance in today’s dollars if one ${Math.round(crash * 100)}% fall happens early, midway or late in the ${years}-year horizon, with returns otherwise as assumed.`}
      actions={
        <Field label="Size of the fall" htmlFor="seq-crash" className="w-36">
          <PercentInput id="seq-crash" min={5} max={90} step={5} value={crash} onChange={setCrash} />
        </Field>
      }
    >
      <SimpleTable
        headers={['Alternative', 'No fall', 'Fall in first month', 'Fall midway', 'Fall in last month']}
        align={['left', 'right', 'right', 'right', 'right']}
        rows={rows.map(({ v, r }) => {
          const by = Object.fromEntries(r.map((x) => [x.timing, x.finalReal]));
          const cell = (k: 'early' | 'middle' | 'late') => (
            <span key={k}>
              {formatMoney(by[k]!, { whole: true })} <span className="text-xs text-muted">({formatMoney(by[k]! - by.none!, { whole: true, signed: true })})</span>
            </span>
          );
          return [v.name, formatMoney(by.none!, { whole: true }), cell('early'), cell('middle'), cell('late')];
        })}
      />
    </Card>
  );
}
