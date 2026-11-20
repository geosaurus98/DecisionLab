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
} as const;
