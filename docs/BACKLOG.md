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

## Done in milestone 6 (“Smarter categorisation and planning”)

Category suggestions in the review queue, budget history and rollover, balances rolled forward from any anchor (opening-balance prompt), decision templates and reused criteria.

## Done in milestone 7 (“Goals and the long view”)

Goal savings plans (required monthly, planned finish, probability), net worth over time, year in review, rule health.

## Next milestone (recommended): “Polish and everyday use”

1. **Quick-add from the phone**: a minimal “add cash transaction” and “note a decision” flow tuned for the installed Android app.
2. **Investment valuations over time** for accounts without transactions (KiwiSaver, Sharesies): a dated value history instead of one balance, feeding net worth.
3. **Rule fixes from rule health**: one-click “move above the shadowing rule”, “narrow this rule” or “disable”.
4. **Keyboard shortcuts and bulk edits** on the transactions table (select many → set category).
5. **Verify other bank presets** when you have exports.

## Then

6. Monte Carlo: historical bootstrap of returns once a reliable, licence-compatible NZ return series is chosen.

## Later / optional

7. Optional local passphrase lock with encryption at rest (requires key management UX; current guidance relies on device security).
8. Optional sync between devices (end-to-end encrypted, explicit opt-in).
9. Desktop packaging (Tauri) with SQLite storage.
10. Akahu (NZ open banking) integration — explicit consent, documented data flows; only if manual CSV becomes a real burden.

## Technical debt / quality

- More component tests (decision editor tabs, settings forms).
- Virtualised transaction table if paging 100 rows ever feels slow; analytics in a worker only if benchmarks on phones show a need.
- Manual screen-reader pass (NVDA/TalkBack); keyboard reordering of rules; axe audit of open dialogs.
- Rule performance: precompile and cache per import (currently fine for thousands of rows).
