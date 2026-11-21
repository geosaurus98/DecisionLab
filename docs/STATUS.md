# Implementation status

Last updated: November 2026 (milestone 1: foundation + end-to-end vertical slice).

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
| Testing infrastructure | ✅ | Vitest (114 tests) + Playwright E2E |
| Export/import (backup/restore), encrypted backup | ✅ | zod-validated, AES-GCM |
| PWA / offline | 🟡 | Manifest + service worker caching the app shell; install prompt UX not customised |

## Phase 2 — SpendLens

| Item | Status | Notes |
| --- | --- | --- |
| CSV import wizard with mapping, preview, NZ formats, debit/credit | ✅ | Header-row detection, saved mappings |
| Multiple accounts and imports, import history, undo | ✅ | |
| Duplicate detection | ✅ | Occurrence-aware |
| Original values kept for audit | ✅ | Visible in transaction details |
| Search, filters, editing (category, notes) | ✅ | Manual transaction entry ⬜ |
| Editable categories (kind, essential, colour, archive) | ✅ | |
| Rule-based categorisation (create, reorder, enable/disable, regex, re-apply) | ✅ | |
| Learning from corrections (merchant memory) | ✅ | |
| Transfers / savings not double counted | ✅ | Plus likely-transfer pair suggestions |
| Income vs expenses, monthly cash flow, savings rate | ✅ | |
| Spending by category, trends, essential vs discretionary | ✅ | |
| Recurring payments | ✅ | Dismissable; editing a detected series ⬜ |
| Spending anomalies | ✅ | Robust z-score |
| Period comparison | ✅ | Month vs previous 3 months; arbitrary custom ranges ⬜ |
| Financial flexibility with provenance | ✅ | |

## Phase 3 — ChoiceLedger

| Item | Status | Notes |
| --- | --- | --- |
| Decision creation (all listed fields) | ✅ | Autosaved |
| Alternatives with costs, criteria with weights and direction | ✅ | |
| Weighted scoring with normalisation and full breakdown | ✅ | |
| Weight sensitivity and fragility warning | ✅ | |
| Cost–benefit (Pareto) indicator | ✅ | Scatter chart ⬜ |
| Pairwise comparison (AHP) for weights | ⬜ | Backlog |
| Decision journal with search/filter | ✅ | |
| Immutable snapshots, snapshot history on reopen | ✅ | |
| Outcome reviews with predicted vs actual | ✅ | |
| Preference insights / calibration with sample sizes | 🟡 | Cost, satisfaction, repeat rate, confidence; criterion-level over/under-valuation ⬜ |

## Phase 4 — FutureRegret

| Item | Status | Notes |
| --- | --- | --- |
| Scenario builder with templates and editable variants | ✅ | 5 templates |
| Compound growth, contributions, timing, fees, tax, inflation, nominal/real | ✅ | Closed-form tested |
| One-off and recurring flows (incl. inflation-indexed) | ✅ | |
| Goal progress (target reached month) | ✅ | Linked to Goals entity ⬜ |
| Opportunity-cost comparison | ✅ | |
| Sensitivity (tornado) | ✅ | |
| Charts comparing scenarios | ✅ | With table view |
| Monte Carlo simulation | ⬜ | Next milestone; seeded PRNG already in place |

## Phase 5 — Integration

| Item | Status |
| --- | --- |
| Flexibility estimate prefills new decisions and is compared with each option’s costs | ✅ |
| Decision options become projection scenarios | ✅ |
| Snapshot stores assumptions, projections and available funds | ✅ |
| Review dates surface on Overview | ✅ |
| Link a decision to actual transactions (actual cost from matched spending) | ⬜ |
| Create a decision from a Scenario Lab set (and vice versa) | ⬜ |

## Phase 6 — Advanced

Not started beyond anomalies and basic calibration. See [BACKLOG.md](BACKLOG.md).

## Known limitations

- Tax model is a flat rate on monthly returns with loss credits (PIE approximation).
- Multi-currency is not supported (NZD only).
- Large datasets (> ~50k transactions) are untested for UI performance.
- Recurring detection uses merchant keys; merchants whose description changes every month may be missed.
