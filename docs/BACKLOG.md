# Backlog (prioritised)

Ordered by value to the core loop (understand → decide → simulate → learn). Each item lists the main design notes.

## Done in milestone 2 (“Uncertainty and reality”)

Monte Carlo simulation (Web Worker, seeded, common random numbers), linking transactions to decisions for measured actual costs, manual transactions, split transactions, custom period comparison.

## Done in milestone 3 (“Decide with less friction”)

Category budgets with pace tracking and suggestions, budgets in the flexibility estimate, AHP pairwise weighting with consistency ratio, cost-vs-preference chart with Pareto frontier, Scenario Lab ↔ decision conversion, goals as projection targets (with date check and account tracking), due-review badge and opt-in reminders.

## Next milestone (recommended): “Real-world data”

1. **Bank-specific CSV presets** for ANZ, ASB, BNZ, Westpac and Kiwibank, verified against real (anonymised) exports — the biggest remaining source of friction.
2. **Opening-balance reconstruction** from a statement balance column: account balance history and an automatically *known* current balance (instead of manual).
3. **Edit recurring series**: confirm, rename, set expected amount; an upcoming-bills calendar feeding “upcoming expenses”.
4. **Budget-aware pace for bills**: treat categories dominated by recurring payments as lump-sum (expected on their due date) rather than evenly spread.
5. **Component tests** for the import wizard and decision editor, plus an axe accessibility audit.

## Then

6. Monte Carlo extensions: historical bootstrap of returns, fat-tailed (Student-t) returns, uncertain inflation, sequence-of-returns stress tests.
7. Criterion-level preference insights: which criteria you weight highly vs which predicted satisfaction (needs ≥ 10 reviews).

## Later / optional

8. Optional automatic encrypted backups to a user-chosen folder (File System Access API on desktop).
9. Optional local passphrase lock with encryption at rest (requires key management UX; current guidance relies on device security).
10. Optional sync between devices (end-to-end encrypted, explicit opt-in).
11. Desktop packaging (Tauri) with SQLite storage.
12. Akahu (NZ open banking) integration — explicit consent, documented data flows; only if manual CSV becomes a real burden.

## Technical debt / quality

- Component tests for the import wizard and decision editor (add React Testing Library + jsdom when needed).
- Web Worker for heavy analytics if transaction counts grow large; virtualised transaction table.
- Accessibility audit with axe and screen-reader pass; keyboard reordering of rules.
- Rule performance: precompile and cache per import (currently fine for thousands of rows).
