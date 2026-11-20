# Backlog (prioritised)

Ordered by value to the core loop (understand → decide → simulate → learn). Each item lists the main design notes.

## Next milestone (recommended): “Uncertainty and reality”

1. **Monte Carlo simulation** (Scenario Lab + decision Financial tab, optional toggle).
   Monthly log-normal returns from annual mean/volatility (convert arithmetic ↔ geometric explicitly), seeded `mulberry32` + Box–Muller (already in `src/engine/random.ts`), fees/tax/inflation identical to the deterministic engine, percentiles (type 7) P10/P25/P50/P75/P90, probability of reaching a target, fan chart + histogram. Run in a Web Worker for ≥ 10k paths. Tests: zero volatility equals deterministic result, seed reproducibility, percentile correctness, convergence of mean. UI copy: “a distribution of outcomes under these assumptions, not a probability forecast”.
2. **Link decisions to actual transactions**: tag transactions to a decision (or match by date range/merchant) so a review’s actual cost is computed from data (*Known*) instead of typed (*Manual*).
3. **Manual transaction entry and split transactions** (e.g. split a supermarket shop into groceries + household).
4. **Custom period comparison** (any two date ranges) and a month detail drill-down from charts.

## Then

5. Pairwise (AHP) weighting as an alternative to direct weights, with consistency ratio.
6. Cost–benefit scatter chart (score vs total cost) with the Pareto frontier.
7. Criterion-level preference insights: which criteria you weight highly vs which predicted satisfaction (needs ≥ 10 reviews).
8. Create a decision from a Scenario Lab set; open a decision’s alternatives in the Lab.
9. Goals linked to projections (target from a Goal, progress from an account balance).
10. Budget/target per category with variance tracking.
11. Edit recurring series (confirm, rename, set expected amount), and upcoming-bill calendar.
12. Review reminders (local notifications in the installed PWA).
13. Bank-specific CSV presets for major NZ banks (ANZ, ASB, BNZ, Westpac, Kiwibank) once verified against real exports — profiles are already supported.
14. Opening-balance reconstruction from a statement balance column to show account balance history.

## Later / optional

15. Optional automatic encrypted backups to a user-chosen folder (File System Access API on desktop).
16. Optional local passphrase lock with encryption at rest (requires key management UX; current guidance relies on device security).
17. Optional sync between devices (end-to-end encrypted, explicit opt-in).
18. Desktop packaging (Tauri) with SQLite storage.
19. Akahu (NZ open banking) integration — explicit consent, documented data flows; only if manual CSV becomes a real burden.

## Technical debt / quality

- Component tests for the import wizard and decision editor (add React Testing Library + jsdom when needed).
- Web Worker for heavy analytics if transaction counts grow large; virtualised transaction table.
- Accessibility audit with axe and screen-reader pass; keyboard reordering of rules.
- Rule performance: precompile and cache per import (currently fine for thousands of rows).
