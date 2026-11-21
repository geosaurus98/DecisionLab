# Backlog (prioritised)

Ordered by value to the core loop (understand → decide → simulate → learn). Each item lists the main design notes.

## Done in milestone 2 (“Uncertainty and reality”)

Monte Carlo simulation (Web Worker, seeded, common random numbers), linking transactions to decisions for measured actual costs, manual transactions, split transactions, custom period comparison.

## Next milestone (recommended): “Decide with less friction”

1. **Category budgets / targets** with variance tracking per month, feeding monthly capacity (planned vs actual discretionary spending).
2. **Cost–benefit scatter** (score vs total cost) with the Pareto frontier, and **pairwise (AHP) weighting** with a consistency ratio as an alternative to direct weights.
3. **Create a decision from a Scenario Lab set** (and open a decision’s alternatives in the Lab).
4. **Goals linked to projections**: pick a Goal as the target; progress from an account balance.
5. **Review reminders** in the installed PWA (local notifications), and a “due for review” badge in navigation.

## Then

6. Monte Carlo extensions: historical bootstrap of returns, fat-tailed (Student-t) returns, uncertain inflation, sequence-of-returns stress tests.
7. Criterion-level preference insights: which criteria you weight highly vs which predicted satisfaction (needs ≥ 10 reviews).
8. Edit recurring series (confirm, rename, set expected amount), and upcoming-bill calendar.
9. Bank-specific CSV presets for major NZ banks (ANZ, ASB, BNZ, Westpac, Kiwibank) once verified against real exports — profiles are already supported.
10. Opening-balance reconstruction from a statement balance column to show account balance history.

## Later / optional

11. Optional automatic encrypted backups to a user-chosen folder (File System Access API on desktop).
12. Optional local passphrase lock with encryption at rest (requires key management UX; current guidance relies on device security).
13. Optional sync between devices (end-to-end encrypted, explicit opt-in).
14. Desktop packaging (Tauri) with SQLite storage.
15. Akahu (NZ open banking) integration — explicit consent, documented data flows; only if manual CSV becomes a real burden.

## Technical debt / quality

- Component tests for the import wizard and decision editor (add React Testing Library + jsdom when needed).
- Web Worker for heavy analytics if transaction counts grow large; virtualised transaction table.
- Accessibility audit with axe and screen-reader pass; keyboard reordering of rules.
- Rule performance: precompile and cache per import (currently fine for thousands of rows).
