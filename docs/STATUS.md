# Implementation status

Last updated: November 2026 — milestone 1 (foundation + vertical slice) milestone 2 (“Uncertainty and reality”) and milestone 3 (“Decide with less friction”: budgets, pairwise weighting, cost-vs-preference chart, Scenario Lab ↔ decisions, goal targets, review reminders).

Legend: ✅ implemented and tested · 🟡 partial · ⬜ planned

## Phase 1 — Foundation

| Item | Status | Notes |
| --- | --- | --- |
| App shell, navigation (sidebar desktop, bottom bar mobile) | ✅ | 7 sections, skip link, focus management |
| Responsive layouts | ✅ | Checked at 412 px (Pixel 7) and 1360 px |
| Light/dark/system theme | ✅ | Token-based, no flash on load |
| Local persistence (Dexie/IndexedDB) | ✅ | Versioned schema, persistent-storage request |
| Shared domain models | ✅ | `src/domain/types.ts` |
| Synthetic demonstration dataset | ✅ | Seeded, loaded through the real import pipeline, labelled, removable |
| Testing infrastructure | ✅ | Vitest (147 tests) + Playwright E2E (20 steps) |
| Export/import (backup/restore), encrypted backup | ✅ | zod-validated, AES-GCM |
| PWA / offline | 🟡 | Manifest + service worker caching the app shell; install prompt UX not customised |

## Phase 2 — SpendLens

| Item | Status | Notes |
| --- | --- | --- |
| CSV import wizard with mapping, preview, NZ formats, debit/credit | ✅ | Header-row detection, saved mappings |
| Multiple accounts and imports, import history, undo | ✅ | |
| Duplicate detection | ✅ | Occurrence-aware |
| Original values kept for audit | ✅ | Visible in transaction details |
| Search, filters, editing (category, notes) | ✅ | |
| Manual transaction entry | ✅ | Dedupes against later imports; deletable |
| Split transactions | ✅ | Exact-cent validation; analytics use split parts |
| Editable categories (kind, essential, colour, archive) | ✅ | |
| Rule-based categorisation (create, reorder, enable/disable, regex, re-apply) | ✅ | |
| Learning from corrections (merchant memory) | ✅ | |
| Transfers / savings not double counted | ✅ | Plus likely-transfer pair suggestions |
| Income vs expenses, monthly cash flow, savings rate | ✅ | |
| Spending by category, trends, essential vs discretionary | ✅ | |
| Recurring payments | ✅ | Dismissable; editing a detected series ⬜ |
| Spending anomalies | ✅ | Robust z-score |
| Period comparison | ✅ | Month vs previous 3 months, or any two custom date ranges |
| Financial flexibility with provenance | ✅ | Shows discretionary budgets and unallocated capacity |
| Category budgets with variance tracking | ✅ | Pace-aware status, suggestions from median spending |

## Phase 3 — ChoiceLedger

| Item | Status | Notes |
| --- | --- | --- |
| Decision creation (all listed fields) | ✅ | Autosaved |
| Alternatives with costs, criteria with weights and direction | ✅ | |
| Weighted scoring with normalisation and full breakdown | ✅ | |
| Weight sensitivity and fragility warning | ✅ | |
| Cost–benefit (Pareto) indicator and cost-vs-preference chart | ✅ | |
| Pairwise comparison (AHP) for weights | ✅ | Consistency ratio; judgements stored on the decision |
| Decision journal with search/filter | ✅ | |
| Immutable snapshots, snapshot history on reopen | ✅ | |
| Outcome reviews with predicted vs actual | ✅ | |
| Preference insights / calibration with sample sizes | 🟡 | Cost (incl. how many measured from linked transactions), satisfaction, repeat rate, confidence; criterion-level over/under-valuation ⬜ |

## Phase 4 — FutureRegret

| Item | Status | Notes |
| --- | --- | --- |
| Scenario builder with templates and editable variants | ✅ | 5 templates |
| Compound growth, contributions, timing, fees, tax, inflation, nominal/real | ✅ | Closed-form tested |
| One-off and recurring flows (incl. inflation-indexed) | ✅ | |
| Goal progress (target reached month) | ✅ | Goals can be the target; date check badge; goals can track an account |
| Opportunity-cost comparison | ✅ | |
| Sensitivity (tornado) | ✅ | |
| Charts comparing scenarios | ✅ | With table view |
| Monte Carlo simulation | ✅ | Log-normal returns, seeded, Web Worker, fan chart, histogram, target/shortfall/loss probabilities, differences with common random numbers; summary frozen in decision snapshots |

## Phase 5 — Integration

| Item | Status |
| --- | --- |
| Flexibility estimate prefills new decisions and is compared with each option’s costs | ✅ |
| Decision options become projection scenarios | ✅ |
| Snapshot stores assumptions, projections and available funds | ✅ |
| Review dates surface on Overview | ✅ |
| Link a decision to actual transactions (actual cost from matched spending) | ✅ |
| Create a decision from a Scenario Lab set (and vice versa) | ✅ |
| Review reminders (nav badge, opt-in notifications on open) | ✅ |

## Phase 6 — Advanced

Anomalies, basic calibration and Monte Carlo are done. See [BACKLOG.md](BACKLOG.md).

## Known limitations

- Tax model is a flat rate on monthly returns with loss credits (PIE approximation).
- Multi-currency is not supported (NZD only).
- Large datasets (> ~50k transactions) are untested for UI performance.
- Recurring detection uses merchant keys; merchants whose description changes every month may be missed.
- Monte Carlo assumes independent monthly returns and fixed inflation (no crash clustering or fat tails).
- Split parts are categorised manually; rules do not create splits.
