import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Notice } from '@/ui/components';
import type { Decision } from '@/domain/types';
import { ahpWeights, CR_THRESHOLD, judgement, judgementToSlider, pairKey, sliderToJudgement } from '@/engine/ahp';
import { formatPercent } from '@/domain/money';

/** Saaty's verbal scale for judgements 1–9. */
const VERBAL = ['', 'equally important', 'slightly more important', 'moderately more important', 'moderately to strongly more important', 'strongly more important', 'strongly to very strongly more important', 'very strongly more important', 'very to extremely more important', 'extremely more important'];

function describe(v: number, a: string, b: string): string {
  if (v === 0) return `${a} and ${b} are equally important`;
  const j = sliderToJudgement(Math.abs(v));
  return `${v > 0 ? a : b} is ${VERBAL[j]} (${j}×)`;
}

/**
 * Derive criterion weights by comparing each pair (AHP). Judgements are stored on the decision
 * so they can be revisited; applying them overwrites the direct weights.
 */
export function PairwiseWeights({ open, onClose, decision: d, onApply }: {
  open: boolean;
  onClose: () => void;
  decision: Decision;
  onApply: (pairwise: Record<string, number>, weights: Record<string, number>) => void;
}) {
  const [pairwise, setPairwise] = useState<Record<string, number>>({});
  useEffect(() => {
    if (open) setPairwise({ ...(d.pairwise ?? {}) });
  }, [open, d.pairwise]);
  const ids = d.criteria.map((c) => c.id);
  const pairs = useMemo(() => ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b] as const)), [ids.join()]);
  const result = useMemo(() => ahpWeights(ids, pairwise), [ids.join(), pairwise]);
  const name = (id: string) => d.criteria.find((c) => c.id === id)?.name || 'Unnamed';

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Weights from pairwise comparisons"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={ids.length < 2}
            onClick={() => {
              // Store only the canonical orientation (a|b for a before b).
              const stored: Record<string, number> = {};
              for (const [a, b] of pairs) stored[pairKey(a, b)] = judgement(pairwise, a, b);
              onApply(stored, result.weights);
              onClose();
            }}
          >
            Use these weights
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-ink-2">
          Comparing two things at a time is often easier than assigning weights directly. For each pair, slide towards the criterion that matters more to you.
          DecisionLab converts your answers into weights (Analytic Hierarchy Process) and checks that they don’t contradict each other.
        </p>
        {ids.length < 2 ? (
          <Notice>Add at least two criteria first.</Notice>
        ) : (
          <>
            <ul className="grid gap-3">
              {pairs.map(([a, b]) => {
                const v = judgementToSlider(judgement(pairwise, a, b));
                return (
                  <li key={pairKey(a, b)} className="grid gap-1 rounded-lg border border-border p-3">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm font-medium">
                      <span className="truncate text-right">{name(a)}</span>
                      <input
                        type="range"
                        min={-8}
                        max={8}
                        step={1}
                        value={-v}
                        aria-label={`${name(a)} versus ${name(b)}`}
                        aria-valuetext={describe(v, name(a), name(b))}
                        onChange={(e) => setPairwise({ ...pairwise, [pairKey(a, b)]: sliderToJudgement(-Number(e.target.value)) })}
                        className="w-40 accent-[var(--accent)] sm:w-64"
                      />
                      <span className="truncate">{name(b)}</span>
                    </div>
                    <p className="text-center text-xs text-muted">{describe(v, name(a), name(b))}</p>
                  </li>
                );
              })}
            </ul>
            <div className="grid gap-2 rounded-lg bg-surface-2 p-3 text-sm">
              <p className="font-semibold">Resulting weights</p>
              <ul className="grid gap-1">
                {d.criteria.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <span className="w-40 truncate">{name(c.id)}</span>
                    <span className="h-2 flex-1 rounded bg-surface">
                      <span className="block h-2 rounded bg-accent" style={{ width: `${(result.weights[c.id] ?? 0) * 100}%` }} />
                    </span>
                    <span className="w-12 text-right tabular">{formatPercent(result.weights[c.id] ?? 0, 0)}</span>
                  </li>
                ))}
              </ul>
              {result.consistencyRatio !== null && (
                <p className={result.consistent ? 'text-good' : 'text-warn'}>
                  Consistency ratio {result.consistencyRatio.toFixed(2)}{' '}
                  {result.consistent
                    ? `(≤ ${CR_THRESHOLD}: your judgements hang together).`
                    : `(> ${CR_THRESHOLD}: some judgements contradict each other — e.g. A over B and B over C, but C over A. Revisit the strongest ones.)`}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
