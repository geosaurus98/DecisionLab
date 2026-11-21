# Calculations and definitions

Every number DecisionLab shows is defined here. Code references point to the implementing module; all are covered by unit tests.

## Money and parsing (`src/domain/money.ts`)

- Amounts are parsed from text **without floating-point multiplication** (`"1.15"` → `115`, not `114.999…`). Accepted: `1,234.56`, `$1,234.56`, `NZ$12`, `-$5`, `(45.00)`, `45.00 DR` / `CR`, trailing minus, unicode minus. More than two decimals round half away from zero.
- Display: `Intl.NumberFormat('en-NZ', NZD)`.

## Transaction classification (`src/engine/cashflow.ts`)

| Class | Rule |
| --- | --- |
| Income | Amounts in `income` categories (net of reversals) |
| Spending | −(amounts in `expense` categories). Refunds (positive) reduce spending. Uncategorised outflows are **included** (conservative) and reported separately |
| Essential / discretionary | By the category's `essential` flag; uncategorised outflows count as discretionary |
| Savings contributions | −(amounts in `savings` categories): money moved to savings/investments outside tracked accounts |
| Transfers | `transfer` categories: excluded from income and spending |
| Uncategorised inflows | Reported separately; **not** counted as income |

- **Net cash flow** = income + uncategorised inflows − spending − savings contributions.
- **Savings rate** = (income − spending) / income; undefined (shown “—”) when income ≤ 0.
- **Complete months only**: monthly analytics and estimates exclude the current, partial month.
- **Period comparison** normalises both periods to a 30.4375-day month.
- **Likely transfers**: an outflow and an equal inflow in different accounts within 3 days, neither already a transfer — suggested, never applied automatically.

## Categorisation (`src/engine/categorise.ts`)

Precedence: manual (never overwritten) → merchant memory (from “apply to same merchant” corrections) → first matching enabled rule by priority → uncategorised.

## Duplicate detection (`src/engine/dedupe.ts`)

Base key = `account|date|amount|DESCRIPTION` (case/whitespace normalised). Within a file, identical rows get occurrence numbers 1, 2, 3…; a row is a duplicate when the account already holds at least that many transactions with the same base key. Overlapping statements import only new rows; genuine identical purchases are kept.

## Recurring payments (`src/engine/recurring.ts`)

Group by (merchant key, direction); same-day payments are summed. Requires ≥ 3 dates. Median interval must match a cadence: weekly 7±1 d, fortnightly 14±2, monthly 30.44±4, quarterly 91.3±8, annual 365.25±12.

- Regularity = share of intervals within 1.5× tolerance.
- Amount stability = 1 − min(CV, 1), CV = sample standard deviation / mean.
- Confidence = regularity × (0.6 + 0.4 × stability); series below 0.5 are dropped.
- Monthly equivalent = median amount × occurrences per month (weekly 52/12, fortnightly 26/12, quarterly 1/3, annual 1/12).
- **Active** if the last payment is within 1.5 periods + tolerance of today.

## Financial flexibility (`src/engine/flexibility.ts`)

**Available now** (one-off) = Σ manual balances of liquid accounts − emergency reserve target − upcoming expenses due within the horizon (default 90 days) − earmarked goal savings. Shown only if at least one balance is entered; can be negative.

**Monthly discretionary capacity** = typical income − recurring obligations − essential variable spending − savings commitment, where:

- typical income = median monthly income over the last *N* complete months (default 6), or your override;
- recurring obligations = Σ monthly equivalents of active recurring **outflows in expense (or uncategorised) categories** — recurring transfers and savings are excluded (they are covered by the savings commitment) — or your override;
- essential variable spending = max(0, median monthly essential spending − recurring obligations in essential categories), avoiding double counting.

Provenance: balances, reserve, upcoming expenses, goals, commitment and overrides are *Manual*; income/obligation/essential estimates are *Estimated*.

## Decision scoring (`src/engine/scoring.ts`)

1. Weights normalised: wᵢ = rawᵢ / Σ raw (all zero → equal weights).
2. Normalised score nᵢ ∈ [0,1]:
   - rating (0–10 scale): x/10, or (10 − x)/10 when lower is better (clamped to 0–10);
   - measure: min–max across options, direction-aware; if all options are equal, n = 1 for all.
3. Score = 100 × Σ wᵢ nᵢ. Missing scores contribute 0 and flag the option *incomplete*. Ties share a rank.
4. **Pareto efficiency**: an option is *dominated* if another has a score ≥ and total cost ≤ with at least one strict.

**Weight sensitivity** — for each criterion, its weight share w is varied over [0,1] (steps of 0.005) with other weights scaled proportionally by (1 − w). Reported: the stable range where the leader stays first and the smallest shift that changes the leader.
**Fragile ranking** warning when the top-two margin is < 5 points or any single-weight shift ≤ 15 percentage points changes the leader. The leader under equal weights is also compared.

With two options, min–max normalisation of a measured criterion always yields 0 vs 1; the UI warns about this.

## Deterministic projection (`src/engine/projection.ts`)

Monthly time step; month 0 = `startMonth`; balances are reported at the **end** of each month.

- Monthly return: r_m = (1 + r_annual)^(1/12) − 1 (geometric, so 12 months compound exactly to the annual rate).
- Monthly fee: f_m = 1 − (1 − fee_annual)^(1/12), applied to the balance.
- Each month, with timing **start**: (1) apply cash flows; (2) gain = max(B,0)·r_m; (3) tax = gain·tax rate (a negative return produces a tax credit); (4) fee = max(B,0)·f_m. With timing **end**, cash flows are applied after steps 2–4 (ordinary annuity).
- Cash flows = monthly contribution (+ variant contribution change) + recurring flows active in that month + one-offs in that month. Inflation-indexed recurring flows grow at the monthly inflation rate from their start.
- Negative balances earn nothing and pay no fee (no borrowing cost is modelled); months ending negative are flagged as **shortfalls**.
- **Real values** (today's dollars) = nominal / (1 + inflation)^((t + 1)/12), i.e. deflated to the start of month 0.
- Values are computed in fractional cents and rounded only in outputs. Identity: final = initial + flows + growth − tax − fees (± rounding).
- **Tax** is a simplification: a flat rate on each month's return, with losses producing a credit (approximates NZ PIE taxation at your PIR, where fund losses generate tax credits; does not model FIF rules or KiwiSaver specifics). Taxing only gains would create an artificial drag under volatile returns. Set 0% for pre-tax results.
- Validated against the closed-form future value of an annuity in tests (start and end timing).

**Decision alternatives → cash flows**: upfront cost becomes a one-off of −cost in `costMonth`; monthly cost becomes a recurring flow of −cost from `costMonth` for `monthlyCostMonths` (or to the horizon). **Total cost** = undiscounted sum within the horizon.

**Opportunity cost** = final real balance of an alternative − the best alternative's final real balance.

## Sensitivity analysis (`src/engine/sensitivity.ts`)

One-at-a-time: each assumption is perturbed down and up while others stay fixed, and the projection is **re-run** with the changed assumption: return ±2 pp, inflation ±1 pp, fees ±0.5 pp, contribution ±20%, horizon ±25%. The metric is either one variant's final real balance or the difference between two variants. Results are sorted by swing (tornado).

## Anomalies (`src/engine/anomalies.ts`)

Per expense category with ≥ 8 outflows: robust z = (x − median) / (1.4826 × MAD). Flagged if z > 3.5 **and** x ≥ 2 × median **and** x ≥ $100.

## Insights (`src/engine/insights.ts`)

From decisions with both a snapshot and a review:

- cost error = (actual − predicted) / predicted; median reported; “underestimated” = error > 5%;
- satisfaction gap = actual − predicted (mean);
- would-repeat share, per category and per confidence level.

Every figure shows n. Below 5 reviewed decisions the page explicitly says results are observations, not patterns.

## Statistics (`src/engine/stats.ts`)

Percentiles use linear interpolation between closest ranks (Hyndman–Fan type 7, as NumPy's default). Standard deviation is the sample (n − 1) version.

## Random numbers (`src/engine/random.ts`)

`mulberry32` seeded PRNG (32-bit integer arithmetic, platform-independent) and Box–Muller normals; used for the reproducible demo dataset and reserved for Monte Carlo simulation.
