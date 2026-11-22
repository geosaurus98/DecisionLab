import { useEffect, useRef, useState } from 'react';
import type { MonteCarloConfig, ProjectionAssumptions, ScenarioVariant } from '@/domain/types';
import { simulate, validateMonteCarlo, type MonteCarloResult } from '@/engine/montecarlo';
import { validateAssumptions } from '@/engine/projection';

export interface MonteCarloRequest {
  id: number;
  assumptions: ProjectionAssumptions;
  variants: Pick<ScenarioVariant, 'id' | 'name' | 'oneOffs' | 'recurring' | 'contributionDelta'>[];
  settings: Omit<MonteCarloConfig, 'enabled'>;
}

interface State {
  result: MonteCarloResult | null;
  running: boolean;
  error: string | null;
  ms: number | null;
}

/**
 * Runs the simulation in a Web Worker (falling back to the main thread where workers are
 * unavailable), debounced so editing assumptions does not queue many runs. Stale results
 * from superseded requests are ignored.
 */
export function useMonteCarlo(
  assumptions: ProjectionAssumptions,
  variants: MonteCarloRequest['variants'],
  config: MonteCarloConfig | undefined,
): State {
  const [state, setState] = useState<State>({ result: null, running: false, error: null, ms: null });
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const key = JSON.stringify({ assumptions, variants, config });

  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    if (!config?.enabled) {
      setState({ result: null, running: false, error: null, ms: null });
      return;
    }
    const { enabled: _enabled, ...settings } = config;
    void _enabled;
    const errors = [...validateAssumptions(assumptions), ...validateMonteCarlo(settings)];
    if (variants.length === 0) errors.push('Add at least one alternative.');
    if (errors.length) {
      setState({ result: null, running: false, error: errors.join(' '), ms: null });
      return;
    }
    const id = ++requestId.current;
    setState((s) => ({ ...s, running: true, error: null }));
    const timer = setTimeout(() => {
      const request: MonteCarloRequest = { id, assumptions, variants, settings };
      if (typeof Worker === 'undefined') {
        try {
          const started = performance.now();
          const result = simulate(assumptions, variants, settings);
          if (id === requestId.current) setState({ result, running: false, error: null, ms: performance.now() - started });
        } catch (e) {
          if (id === requestId.current) setState({ result: null, running: false, error: e instanceof Error ? e.message : String(e), ms: null });
        }
        return;
      }
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../workers/montecarlo.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current.onmessage = (e: MessageEvent<{ id: number; result?: MonteCarloResult; error?: string; ms?: number }>) => {
          if (e.data.id !== requestId.current) return;
          setState({ result: e.data.result ?? null, running: false, error: e.data.error ?? null, ms: e.data.ms ?? null });
        };
      }
      workerRef.current.postMessage(request);
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures all inputs
  }, [key]);

  return state;
}
