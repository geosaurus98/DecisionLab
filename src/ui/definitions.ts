/** Plain-language definitions shown next to metrics. Keep in sync with src/engine/cashflow.ts. */
export const DEFINITIONS = {
  income:
    'Money in, categorised as Income (salary, interest…). Transfers between your own accounts and uncategorised inflows are not counted.',
  spending:
    'Money out in expense categories, net of refunds. Excludes transfers between your accounts and savings/investment contributions. Uncategorised outflows are included (conservatively) until you categorise them.',
  essential: 'Spending in categories marked essential (needs such as rent, groceries, utilities, transport). You choose which categories are essential in Settings.',
  discretionary: 'Spending in categories not marked essential, plus uncategorised outflows.',
  savingsContributions: 'Money moved to savings or investments held outside your tracked accounts (e.g. Sharesies, KiwiSaver voluntary contributions). Not consumption.',
  netCashFlow: 'Income − spending − savings contributions (+ uncategorised inflows). Roughly how much your tracked cash grew or shrank.',
  savingsRate: '(Income − spending) ÷ income. The share of income not consumed, including what you moved to savings. Undefined when income is zero.',
  availableNow:
    'Liquid balances you entered − emergency reserve − upcoming expenses within your horizon − money earmarked for goals. A positive bank balance is not automatically spendable.',
  monthlyCapacity:
    'Typical monthly income − recurring obligations − essential variable spending − your savings commitment. An estimate of what you could spend on discretionary things each month without dipping into savings.',
  recurring:
    'Detected from repeated payments to the same merchant at regular intervals (weekly, fortnightly, monthly, quarterly, annual). Confidence reflects how regular the timing and amounts are.',
  weightedScore:
    'Σ (normalised weight × normalised score) across your criteria, on a 0–100 scale. Only subjective and measured criteria are included — money is shown separately.',
  opportunityCost:
    'The difference in projected balance at the horizon between this option and the best financial option, using the stated return, fee, tax and inflation assumptions. Illustrative, not a forecast.',
  realValue: "Values adjusted for inflation, expressed in today's dollars (the projection's start month).",
  volatility:
    'The standard deviation of annual returns: how much a typical year differs from the average. Roughly, two years in three fall within ±1 volatility of the expected return. Diversified growth funds have historically been around 10–15%; cash under 1%.',
  mcDifference:
    'For each simulated path, both alternatives experience the same market returns, so the difference isolates the effect of the decision itself. Percentiles are taken across paths.',
  budget:
    'Your planned monthly spending per category (entered by you). Actual spending is net of refunds and counts split parts in their own categories. In the current month, the plan expects recurring bills on their due dates and the rest of the budget spread evenly; “ahead of pace” means spending is more than 10% above that.',
  criterionInsight:
    'Spearman rank correlation, across reviewed decisions that used this criterion, between how well the option you chose scored on it (normalised 0–1) and your satisfaction afterwards. +1: higher scores always went with higher satisfaction; 0: no relationship. With few decisions the number is very noisy, so readings appear only from 10 decisions; ≥ 0.3 is treated as a link.',
  crashRisk:
    'Adds occasional sudden falls on top of ordinary ups and downs: each month there is a small chance of the investment value dropping by the crash size. Ordinary returns are nudged up so the expected (average) outcome is unchanged — crashes widen the bad tail rather than lowering the average.',
  inflationVolatility:
    'How much inflation itself is uncertain. Each simulated year draws its own inflation rate around your assumption (floored at −10%), which changes real values and any costs that grow with inflation.',
  sequenceStress:
    'The same average assumptions, but with one sudden fall at different times. When you are adding money, an early fall is less harmful because later contributions buy in cheaply; when you are drawing money out, an early fall is worse.',
} as const;
