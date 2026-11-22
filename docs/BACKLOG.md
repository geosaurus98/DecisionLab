# Backlog (prioritised)

Ordered by value to the core loop (understand → decide → simulate → learn). Each item lists the main design notes.

## Done in milestone 2 (“Uncertainty and reality”)

Monte Carlo simulation (Web Worker, seeded, common random numbers), linking transactions to decisions for measured actual costs, manual transactions, split transactions, custom period comparison.

## Done in milestone 3 (“Decide with less friction”)

Category budgets with pace tracking and suggestions, budgets in the flexibility estimate, AHP pairwise weighting with consistency ratio, cost-vs-preference chart with Pareto frontier, Scenario Lab ↔ decision conversion, goals as projection targets (with date check and account tracking), due-review badge and opt-in reminders.

## Done in milestone 4 (“Real-world data”)

Bank CSV presets with header detection (unverified), statement balance reading with reconciliation and balance history, editable recurring payments (confirm/rename/amount/dismiss), upcoming bills, bills before next pay in the flexibility estimate, bill-aware budget pace, component tests and an automated axe audit.

## Done in milestone 5 (“Verify and learn”)

Review queue (categorise by merchant; confirm/reject transfer pairs), criterion-level insights, Monte Carlo crash risk and uncertain inflation, sequence-of-returns stress test, backup reminders with one-click encrypted backups and optional backup folder, performance benchmark and guard at 50k transactions.

## Next milestone (recommended): “Smarter categorisation and planning”

1. **Category suggestions in the review queue** from similar merchants you have already categorised (token overlap), shown as one-click suggestions — never applied silently.
2. **Budget history**: planned vs actual per category by month, with optional rollover of unspent discretionary budget.
3. **Opening balance prompt** for accounts without statement balances, so balance history works everywhere.
4. **Verify other bank presets** when you have exports from ASB, ANZ, BNZ, Westpac or Kiwibank.
5. **Decision templates** (e.g. “big purchase”, “trip”, “job offer”) with suggested criteria, built from your own past decisions.

## Then

6. Monte Carlo: historical bootstrap of returns once a reliable, licence-compatible NZ return series is chosen.
7. Goal-based savings plans (required monthly contribution to reach a goal by its date, deterministic and with Monte Carlo probability).

## Later / optional

8. Optional local passphrase lock with encryption at rest (requires key management UX; current guidance relies on device security).
9. Optional sync between devices (end-to-end encrypted, explicit opt-in).
10. Desktop packaging (Tauri) with SQLite storage.
11. Akahu (NZ open banking) integration — explicit consent, documented data flows; only if manual CSV becomes a real burden.

## Technical debt / quality

- More component tests (decision editor tabs, settings forms).
- Virtualised transaction table if paging 100 rows ever feels slow; analytics in a worker only if benchmarks on phones show a need.
- Manual screen-reader pass (NVDA/TalkBack); keyboard reordering of rules; axe audit of open dialogs.
- Rule performance: precompile and cache per import (currently fine for thousands of rows).
