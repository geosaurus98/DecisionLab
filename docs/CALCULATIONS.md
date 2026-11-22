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
- **Period comparison** (a month vs the three before it, or any two custom date ranges) normalises both periods to a 30.4375-day month.
- **Likely transfers**: an outflow and an equal inflow in different accounts within 3 days, neither already a transfer. Each outflow is paired with the *closest-dated* unused match. Suggestions are never applied automatically: in the Review tab you confirm pairs (both sides become Transfers) or reject them (remembered, not suggested again).

## Statement balances (`src/engine/balances.ts`)

- If a statement has a running-balance column, each transaction stores the printed `balanceAfter` and its row position.
- **File order**: oldest-first or newest-first, from the first and last dates; if every row has the same date, from which direction the printed balances agree with the amounts.
- **Summary balance**: some banks (e.g. Heartland) state the balance in summary lines above the table (“$X balance … as at <date>”). It is used as the closing balance when the file has no balance column and no transaction is dated after it. The preview also shows the *implied opening balance* (stated balance − Σ amounts); $0 means the file contains the account's complete history.
- **Closing balance** = the chronologically last printed balance (plus any later transactions without one). On import it becomes the account's *statement balance* (provenance **Known**) if it is at least as recent as the existing one; undoing that import recomputes it from the remaining transactions.
- **Current balance** used everywhere = the more recent of the statement balance and a manually entered balance (ties favour the statement).
- **Reconciliation**: between two consecutive printed balances, the transactions in between must sum exactly to the difference. Any mismatch is reported as a gap (date range, expected, printed, difference) — usually a missing statement period or a duplicated transaction.
- **Balance history**: end-of-day balance(d) = anchor − Σ amounts after d up to the anchor date (+ Σ amounts after the anchor date up to d), anchored on the current balance.

## Bank presets (`src/engine/csvPresets.ts`)

Header signatures pre-fill the mapping. Heartland Bank is verified against real exports; ASB, ANZ, BNZ, Westpac and Kiwibank are **unverified** (based on publicly described layouts) until checked against a real export — see [BANK_PRESETS.md](BANK_PRESETS.md). Every row is still validated, and failures are shown, not imported.

## Robust row handling

- Header detection skips summary lines; a line containing a money amount is never taken as the header.
- A blank description does not reject a transaction (that would break balance reconciliation); the reference/code column, or “(no description)”, is used instead.
- Merchant keys strip card numbers, dates, times (including fractional seconds and `12-NOV-26 10.15.32 AM` styles), embedded `YYYY:DD:MM` timestamps, stray years and long reference codes.

## Categorisation (`src/engine/categorise.ts`)

Precedence: manual (never overwritten) → merchant memory (from “apply to same merchant” corrections) → first matching enabled rule by priority → uncategorised.

## Review queue (`src/engine/review.ts`)

Uncategorised, unsplit transactions are grouped by merchant key (largest groups first, by count then |net amount|). Choosing a category for a group categorises every transaction in it and stores it as merchant memory, so future imports from that merchant are categorised too. Optionally a rule *merchant contains “first three words”* can be created from the same choice.

## Duplicate detection (`src/engine/dedupe.ts`)

Base key = `account|date|amount|DESCRIPTION` (case/whitespace normalised). Within a file, identical rows get occurrence numbers 1, 2, 3…; a row is a duplicate when the account already holds at least that many transactions with the same base key. Overlapping statements import only new rows; genuine identical purchases are kept.

## Recurring payments (`src/engine/recurring.ts`)

Group by (merchant key, direction); same-day payments are summed. Requires ≥ 3 dates. Median interval must match a cadence: weekly 7±1 d, fortnightly 14±2, monthly 30.44±4, quarterly 91.3±8, annual 365.25±12.

- Regularity = share of intervals within 1.5× tolerance.
- Amount stability = 1 − min(CV, 1), CV = sample standard deviation / mean.
- Confidence = regularity × (0.6 + 0.4 × stability); series below 0.5 are dropped.
- Monthly equivalent = median amount × occurrences per month (weekly 52/12, fortnightly 26/12, quarterly 1/3, annual 1/12).
- **Active** if the last payment is within 1.5 periods + tolerance of today.
- **Calendar stepping**: weekly/fortnightly step 7/14 days; monthly, quarterly and annual step calendar months keeping the day of month, clamped to the month length (31 Jan → 28/29 Feb → 31 Mar). Next expected = last payment + one period.
- **Your edits** (stored per series key): *confirm*, *rename*, set an *expected amount* (replaces the detected median; monthly equivalent recomputed), or *dismiss* (excluded everywhere). Edits survive re-detection.
- **Upcoming bills** = projected occurrences of active outgoing series after their last payment, within the window (default 30 days), excluding transfer/savings categories. Shown as **Estimated**.

## Financial flexibility (`src/engine/flexibility.ts`)

**Available now** (one-off) = Σ current balances of liquid accounts − emergency reserve target − upcoming expenses due within the horizon (default 90 days) − bills due before the next pay − earmarked goal savings. Shown only if at least one balance is entered; can be negative.

**Monthly discretionary capacity** = typical income − recurring obligations − essential variable spending − savings commitment, where:

- typical income = median monthly income over the last *N* complete months (default 6), or your override;
- recurring obligations = Σ monthly equivalents of active recurring **outflows in expense (or uncategorised) categories** — recurring transfers and savings are excluded (they are covered by the savings commitment) — or your override;
- essential variable spending = max(0, median monthly essential spending − recurring obligations in essential categories), avoiding double counting.

- **Bills due before your next pay** (estimated): when an active recurring income exists, projected consumption bills from today until the day before the next expected income are deducted from *available now* — money in the account that is already spoken for.

Provenance: statement balances are *Known*; entered balances, reserve, upcoming expenses, goals, commitment and overrides are *Manual*; income/obligation/essential estimates and bills before pay are *Estimated*.

## Budgets (`src/engine/budgets.ts`)

- A budget is a manual monthly amount for an **expense** category (transfers, savings and income cannot be budgeted).
- Actual = net spending in that category for the calendar month (refunds reduce it; split parts count in their own categories).
- Elapsed share = day of month ÷ days in month for the current month; 1 for past months.
- Expected by today (current month) = recurring bills in the category already due this month (on their dates, from the recurring calendar) + (budget − all of the month's recurring bills in the category, floored at 0) × elapsed share; capped at the budget.
- Status: **over** if actual > budget; **ahead of pace** if, in the current month, actual > expected by today × 1.1; otherwise **on track**.
- Suggested budget = median monthly net spending over the last three complete months, rounded **up** to the next $10.
- In the flexibility estimate, *planned in discretionary budgets* = Σ budgets of non-essential categories; *not yet allocated* = monthly capacity − that sum (a warning appears if negative). Budgets do not change the capacity estimate itself.

## Decision scoring (`src/engine/scoring.ts`)

1. Weights normalised: wᵢ = rawᵢ / Σ raw (all zero → equal weights).
2. Normalised score nᵢ ∈ [0,1]:
   - rating (0–10 scale): x/10, or (10 − x)/10 when lower is better (clamped to 0–10);
   - measure: min–max across options, direction-aware; if all options are equal, n = 1 for all.
3. Score = 100 × Σ wᵢ nᵢ. Missing scores contribute 0 and flag the option *incomplete*. Ties share a rank.
4. **Pareto efficiency**: an option is *dominated* if another has a score ≥ and total cost ≤ with at least one strict.

**Weight sensitivity** — for each criterion, its weight share w is varied over [0,1] (steps of 0.005) with other weights scaled proportionally by (1 − w). Reported: the stable range where the leader stays first and the smallest shift that changes the leader.
**Pairwise weights (AHP, `src/engine/ahp.ts`)** — optional. For each pair of criteria the user gives a Saaty judgement (1 = equal … 9 = extremely more important; reciprocal for the reverse). Weights = normalised geometric means of the rows of the reciprocal matrix. Consistency: λmax = mean((A·w)ᵢ / wᵢ), CI = (λmax − n)/(n − 1), CR = CI / RI(n) with Saaty's random indices (n = 3: 0.58, 4: 0.90, 5: 1.12, …). CR ≤ 0.10 is acceptable; above it the UI asks the user to revisit contradictory judgements. Applied weights are stored as percentages (one decimal), and the judgements are kept on the decision.

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

**Decision alternatives → cash flows**: upfront cost becomes a one-off of −cost in `costMonth`; monthly cost becomes a recurring flow of −cost from `costMonth` for `monthlyCostMonths` (or to the horizon). Alternatives created from a Scenario Lab variant may also carry *extra flows* (any one-offs, recurring flows and a contribution change), so the projection is identical to the variant's.

**Total cost** = −(sum of the alternative's cash flows within the horizon), undiscounted: money out is cost and money in (e.g. resale) reduces it. Inflation-indexed flows grow at the inflation assumption. Contribution changes are saving decisions, not costs, and are excluded.

**Goals as targets**: choosing a goal sets the projection target to the goal amount. If the goal has a target date, a badge shows whether the balance reaches the target by the end of that month. Goals can track an account's manual balance as their saved amount.

**Opportunity cost** = final real balance of an alternative − the best alternative's final real balance.

## Monte Carlo simulation (`src/engine/montecarlo.ts`)

Optional. Repeats the projection many times with random monthly returns; everything else (cash flows, timing, fees, tax, inflation) is identical to the deterministic engine, which it calls one month at a time (`stepMonth`).

- **Return model**: annual gross return 1 + R is log-normal with arithmetic mean μ (*expected annual return*) and standard deviation σ (*annual volatility*):
  s² = ln(1 + σ²/(1 + μ)²), m = ln(1 + μ) − s²/2. Monthly log returns are independent N(m/12, s²/12), so 12 months compound to that annual distribution. The monthly return is exp(x) − 1.
- **Consistency checks (tested)**: with σ = 0 every path equals the deterministic projection exactly; for a lump sum without fees or tax the *mean* outcome converges to the deterministic value, while the *median* is lower (volatility drag: compounding of uncertain returns).
- **Common random numbers**: within a run, all alternatives experience the same return path. Differences between alternatives (P10/median/P90 of A − B, and the share of runs where A ends ahead) therefore isolate the decision itself.
- **Reported**: percentiles P10, P25, P50, P75, P90 and the mean, at up to ~60 sampled months (always including the final month); probability of ending at or above the target, of reaching it at any month-end, of the balance ever going negative, and of ending below starting balance + net cash flows ("below money put in"). Real values use the fixed inflation assumption.
- **Percentiles**: linear interpolation between closest ranks (type 7).
- **Randomness**: `mulberry32` seeded PRNG + Box–Muller normals; same inputs and seed ⇒ identical results on every platform. Runs: 100–20,000 (default 2,000), computed in a Web Worker.
- **Limitations** (stated in the UI): independent returns (no crashes clustering, momentum, mean reversion, fat tails or regime changes), fixed inflation, no sequence of fee changes. More runs make the percentiles more precise *for this model*, not more accurate as forecasts.
- **Crash risk** (optional): with annual probability *p* (monthly p_m = 1 − (1 − p)^(1/12)) the month's log return gets an extra ln(1 − C) for crash size C. The normal part's mean is raised by −ln(1 − p_m·C), so the *expected* gross return is unchanged (tested): crashes fatten the downside rather than lowering the average. (A Student-t model was rejected because, compounded, its expected value is infinite.)
- **Uncertain inflation** (optional): each simulated year draws inflation ~ N(π, σ_π), floored at −10%. Real values use each path's own price index; inflation-indexed recurring flows grow with that path's inflation. With σ_π = 0 results equal the fixed-inflation model exactly.
- Volatility presets are rough guides only: cash ≈ 0.5%, conservative ≈ 5%, balanced ≈ 9%, growth ≈ 12%, aggressive ≈ 16% per year.
- When enabled on a decision, P10/median/P90 of each option's final real balance are frozen in the snapshot when the choice is recorded.

## Split transactions (`src/engine/splits.ts`)

A transaction can be allocated to several categories. Parts must be non-zero, share the transaction's direction and sum **exactly** (in cents) to its amount, so totals never change. All category analytics run on *analysis lines* (one per split part, or one per unsplit transaction). The transaction's displayed category is the largest part's category; rules never override a split.

## Manual transactions

Entered with the same base key as imports (`account|date|amount|DESCRIPTION`), so importing a statement that contains the same transaction later marks it as a duplicate. Only manual transactions can be deleted individually; imported ones are removed by undoing their import.

## Decision actual cost from linked transactions (`src/engine/decisionLink.ts`)

- Actual cost = −Σ amounts of transactions linked to the decision (payments add, refunds/resale subtract). Shown as **Known**; a typed-in actual cost is **Manual**, and the review records which was used (`actualCostSource`).
- Suggestions: outflows from 7 days before the decision to 180 days after, not linked elsewhere, scored by words (≥ 4 letters) shared with the decision title or chosen option, and by an amount within 25% of the expected cost. Manual search covers a year either side.

## Sequence-of-returns stress test (`sequenceStress` in `src/engine/projection.ts`)

Deterministic: the projection is re-run with one month's return replaced by a fall of the chosen size (default −30%) in the first month, the middle month or the last month, and compared with no fall. Same timing, fee and tax conventions as the projection. With no cash flows the timing cannot matter (multiplication commutes — tested); with contributions an early fall hurts less, with withdrawals or a spend early in the horizon the result depends on what is invested when the fall hits.

## Sensitivity analysis (`src/engine/sensitivity.ts`)

One-at-a-time: each assumption is perturbed down and up while others stay fixed, and the projection is **re-run** with the changed assumption: return ±2 pp, inflation ±1 pp, fees ±0.5 pp, contribution ±20%, horizon ±25%. The metric is either one variant's final real balance or the difference between two variants. Results are sorted by swing (tornado).

## Anomalies (`src/engine/anomalies.ts`)

Per expense category with ≥ 8 outflows: robust z = (x − median) / (1.4826 × MAD). Flagged if z > 3.5 **and** x ≥ 2 × median **and** x ≥ $100.

## Insights (`src/engine/insights.ts`)

From decisions with both a snapshot and a review:

- cost error = (actual − predicted) / predicted; median reported; “underestimated” = error > 5%; the number of costs measured from linked transactions is shown;
- satisfaction gap = actual − predicted (mean);
- would-repeat share, per category and per confidence level.

Every figure shows n. Below 5 reviewed decisions the page explicitly says results are observations, not patterns.

**Criterion-level insights**: for each criterion name reused across reviewed decisions (case-insensitive), the Spearman rank correlation ρ between the chosen option's normalised score on that criterion and actual satisfaction, plus the mean weight share you gave it. Readings appear only from **10** decisions: ρ ≥ 0.3 → “went with satisfaction” (or “worth more weight?” if its mean weight is under 15%); otherwise “no clear link”, or “weighted heavily but didn't track satisfaction” if its mean weight is 30%+. These are associations, not causes, and remain noisy at tens of decisions.

## Statistics (`src/engine/stats.ts`)

Percentiles use linear interpolation between closest ranks (Hyndman–Fan type 7, as NumPy's default). Standard deviation is the sample (n − 1) version. Spearman correlation = Pearson correlation of tie-averaged ranks (null for constant inputs or n < 3).

## Random numbers (`src/engine/random.ts`)

`mulberry32` seeded PRNG (32-bit integer arithmetic, platform-independent) and Box–Muller normals; used for the reproducible demo dataset and Monte Carlo simulation.
