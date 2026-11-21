/// <reference lib="webworker" />
/**
 * Runs Monte Carlo simulations off the main thread so the interface stays responsive.
 * Receives {id, assumptions, variants, settings}; replies {id, result} or {id, error}.
 */
import { simulate } from '@/engine/montecarlo';
import type { MonteCarloRequest } from '@/hooks/useMonteCarlo';

self.onmessage = (e: MessageEvent<MonteCarloRequest>) => {
  const { id, assumptions, variants, settings } = e.data;
  try {
    const started = performance.now();
    const result = simulate(assumptions, variants, settings);
    self.postMessage({ id, result, ms: performance.now() - started });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
