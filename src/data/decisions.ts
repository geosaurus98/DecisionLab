/** Decision persistence, including immutable snapshots taken when a choice is recorded. */
import { db } from './db';
import type { Decision, DecisionSnapshot, OutcomeReview, ScenarioSet } from '@/domain/types';
import { newId, nowTimestamp } from '@/domain/ids';
import { todayIso } from '@/domain/dates';
import { scoreOptions } from '@/engine/scoring';
import { compareVariants, optionToVariant, totalOptionCost, variantToOption } from '@/engine/projection';
import { simulate } from '@/engine/montecarlo';

export function blankDecision(assumptions: Decision['assumptions']): Decision {
  const now = nowTimestamp();
  const optA = newId('opt');
  const optB = newId('opt');
  return {
    id: newId('dec'),
    title: '',
    description: '',
    category: 'purchase',
    date: todayIso(),
    status: 'considering',
    options: [
      { id: optA, name: 'Option A', upfrontCost: 0, costMonth: 0, monthlyCost: 0 },
      { id: optB, name: 'Option B', upfrontCost: 0, costMonth: 0, monthlyCost: 0 },
    ],
    criteria: [],
    scores: { [optA]: {}, [optB]: {} },
    assumptions,
    notes: '',
    links: [],
    selectedOptionId: null,
    reasoning: '',
    predictedSatisfaction: null,
    confidence: null,
    reviewDate: null,
    snapshot: null,
    review: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function validateDecision(d: Decision): string[] {
  const errors: string[] = [];
  if (!d.title.trim()) errors.push('Give the decision a title.');
  if (d.options.length < 2) errors.push('Add at least two alternatives.');
  if (d.options.some((o) => !o.name.trim())) errors.push('Every alternative needs a name.');
  if (d.options.some((o) => o.upfrontCost < 0)) errors.push('Upfront costs cannot be negative (model savings as a separate alternative).');
  if (d.criteria.some((c) => !c.name.trim())) errors.push('Every criterion needs a name.');
  if (d.criteria.some((c) => !(c.weight >= 0))) errors.push('Criterion weights must be zero or more.');
  return errors;
}

export async function saveDecision(d: Decision): Promise<void> {
  await db.decisions.put({ ...d, updatedAt: nowTimestamp() });
}

/** Delete a decision; transactions linked to it are unlinked (never deleted). */
export async function deleteDecision(id: string): Promise<void> {
  await db.transaction('rw', db.decisions, db.transactions, async () => {
    const linked = await db.transactions.where('decisionId').equals(id).toArray();
    await Promise.all(linked.map((t) => db.transactions.update(t.id, { decisionId: undefined })));
    await db.decisions.delete(id);
  });
}

/** Build the immutable snapshot of a decision at the moment the choice is recorded. */
export function buildSnapshot(d: Decision, selectedOptionId: string, availableNow?: number | null): DecisionSnapshot {
  const scoring = scoreOptions(d.options, d.criteria, d.scores);
  const comparison = compareVariants(d.assumptions, d.options.map(optionToVariant));
  const selected = d.options.find((o) => o.id === selectedOptionId);
  if (!selected) throw new Error('Selected option not found');
  // Deep copy via structuredClone so later edits never mutate the snapshot.
  return structuredClone({
    capturedAt: nowTimestamp(),
    options: d.options,
    criteria: d.criteria,
    scores: d.scores,
    selectedOptionId,
    reasoning: d.reasoning,
    ranking: scoring.results.map((r) => ({ optionId: r.optionId, score: r.score, rank: r.rank })),
    assumptions: d.assumptions,
    financials: comparison.map((c) => ({
      optionId: c.variantId,
      finalNominal: c.result.finalNominal,
      finalReal: c.result.finalReal,
      differenceVsBest: c.vsBestReal,
    })),
    availableNow: availableNow ?? undefined,
    predictedSatisfaction: d.predictedSatisfaction,
    predictedCost: totalOptionCost(selected, d.assumptions.horizonMonths, d.assumptions.annualInflation),
    confidence: d.confidence,
    monteCarlo: monteCarloSummary(d),
  });
}

/** Percentiles of each option's final real balance, if Monte Carlo is enabled for the decision. */
function monteCarloSummary(d: Decision): DecisionSnapshot['monteCarlo'] {
  if (!d.monteCarlo?.enabled) return undefined;
  const { enabled: _enabled, ...settings } = d.monteCarlo;
  void _enabled;
  const res = simulate(d.assumptions, d.options.map(optionToVariant), settings);
  return {
    settings,
    options: res.variants.map((v) => ({ optionId: v.variantId, p10: v.finalReal.p10, p50: v.finalReal.p50, p90: v.finalReal.p90 })),
  };
}

/** Record the chosen option. The snapshot is written once and never regenerated. */
export async function recordChoice(d: Decision, selectedOptionId: string, availableNow?: number | null): Promise<Decision> {
  if (d.snapshot) throw new Error('This decision already has a recorded choice. Reopen it to change the choice.');
  const updated: Decision = {
    ...d,
    selectedOptionId,
    status: 'decided',
    snapshot: buildSnapshot(d, selectedOptionId, availableNow),
    updatedAt: nowTimestamp(),
  };
  await db.decisions.put(updated);
  return updated;
}

/**
 * Reopen a decided (but not yet reviewed) decision so the choice can be changed. The current
 * snapshot is moved to `snapshotHistory`, so the earlier reasoning is never lost.
 */
export async function reopenDecision(d: Decision): Promise<Decision> {
  if (d.review) throw new Error('Reviewed decisions cannot be reopened; duplicate it instead.');
  const updated: Decision = {
    ...d,
    status: 'considering',
    selectedOptionId: null,
    snapshot: null,
    snapshotHistory: d.snapshot ? [...(d.snapshotHistory ?? []), d.snapshot] : d.snapshotHistory,
    updatedAt: nowTimestamp(),
  };
  await db.decisions.put(updated);
  return updated;
}

export async function saveReview(d: Decision, review: OutcomeReview): Promise<Decision> {
  if (!d.snapshot) throw new Error('Record a choice before reviewing the outcome.');
  const updated: Decision = { ...d, review, status: 'reviewed', updatedAt: nowTimestamp() };
  await db.decisions.put(updated);
  return updated;
}

export function duplicateDecision(d: Decision): Decision {
  const copy = structuredClone(d);
  const now = nowTimestamp();
  return {
    ...copy,
    id: newId('dec'),
    title: `${d.title} (copy)`,
    status: 'considering',
    selectedOptionId: null,
    snapshot: null,
    review: null,
    snapshotHistory: [],
    createdAt: now,
    updatedAt: now,
    isDemo: false,
  };
}

/**
 * Start a decision from a Scenario Lab set: each variant becomes an alternative with the
 * same cash flows, and the set's assumptions and Monte Carlo settings are copied (not linked).
 */
export function decisionFromScenario(set: ScenarioSet): Decision {
  const d = blankDecision(structuredClone(set.base));
  const options = set.variants.map((v) => ({ ...variantToOption(structuredClone(v)), id: newId('opt') }));
  return {
    ...d,
    title: set.name,
    description: set.description ?? '',
    category: 'financial',
    options,
    scores: Object.fromEntries(options.map((o) => [o.id, {}])),
    monteCarlo: set.monteCarlo ? { ...set.monteCarlo } : undefined,
  };
}

/** Open a decision's alternatives in the Scenario Lab as a new, independent scenario set. */
export function scenarioFromDecision(d: Decision): ScenarioSet {
  const now = nowTimestamp();
  return {
    id: newId('scn'),
    name: d.title ? `${d.title} (from decision)` : 'Scenario from decision',
    description: d.description,
    base: structuredClone(d.assumptions),
    variants: d.options.map((o) => ({ ...optionToVariant(structuredClone(o)), id: newId('var') })),
    monteCarlo: d.monteCarlo ? { ...d.monteCarlo } : undefined,
    createdAt: now,
    updatedAt: now,
  };
}
