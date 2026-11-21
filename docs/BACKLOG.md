# Backlog (prioritised)

Ordered by value to the core loop (understand → decide → simulate → learn). Each item lists the main design notes.

## Done in milestone 2 (“Uncertainty and reality”)

Monte Carlo simulation (Web Worker, seeded, common random numbers), linking transactions to decisions for measured actual costs, manual transactions, split transactions, custom period comparison.

## Done in milestone 3 (“Decide with less friction”)

Category budgets with pace tracking and suggestions, budgets in the flexibility estimate, AHP pairwise weighting with consistency ratio, cost-vs-preference chart with Pareto frontier, Scenario Lab ↔ decision conversion, goals as projection targets (with date check and account tracking), due-review badge and opt-in reminders.

## Done in milestone 4 (“Real-world data”)

Bank CSV presets with header detection (unverified), statement balance reading with reconciliation and balance history, editable recurring payments (confirm/rename/amount/dismiss), upcoming bills, bills before next pay in the flexibility estimate, bill-aware budget pace, component tests and an automated axe audit.

## Next milestone (recommended): “Verify and learn”

1. **Verify bank presets** with your real exports (needs your input — see BANK_PRESETS.md).
2. **Criterion-level preference insights**: which criteria and weights best predicted satisfaction (shown only with ≥ 10 reviews, with uncertainty).
3. **Monte Carlo extensions**: historical bootstrap / fat-tailed returns, uncertain inflation, sequence-of-returns stress test.
4. **Automatic encrypted backups** to a user-chosen folder (File System Access API on desktop) with reminders.
5. **Performance**: virtualised transaction table and analytics in a worker for 50k+ transactions.

## Then

6. Category-level budget history (planned vs actual by month) and budget rollover.
7. Opening-balance prompt for accounts without a balance column, to enable balance history everywhere.

## Later / optional

8. Optional local passphrase lock with encryption at rest (requires key management UX; current guidance relies on device security).
9. Optional sync between devices (end-to-end encrypted, explicit opt-in).
10. Desktop packaging (Tauri) with SQLite storage.
11. Akahu (NZ open banking) integration — explicit consent, documented data flows; only if manual CSV becomes a real burden.

## Technical debt / quality

- More component tests (decision editor tabs, settings forms).
- Web Worker for heavy analytics if transaction counts grow large; virtualised transaction table.
- Manual screen-reader pass (NVDA/TalkBack); keyboard reordering of rules; axe audit of open dialogs.
- Rule performance: precompile and cache per import (currently fine for thousands of rows).
