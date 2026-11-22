/**
 * Shared domain entities. These types are persisted in IndexedDB (see src/data/db.ts) and
 * included in backups (see src/data/backup.ts). Changing a persisted shape requires a
 * Dexie version bump and a backup migration. See docs/DATA_MODEL.md.
 */
import type { Cents } from './money';
import type { DateFormat, IsoDate, MonthKey } from './dates';

export type Id = string;
/** ISO-8601 timestamp (instant), used for audit fields such as createdAt. */
export type Timestamp = string;

/** Where a displayed value came from. Shown in the UI so estimates are never mistaken for facts. */
export type Provenance = 'known' | 'estimated' | 'manual';

// ───────────────────────────── SpendLens ─────────────────────────────

export type AccountType = 'everyday' | 'savings' | 'credit' | 'investment' | 'cash' | 'other';

export interface Account {
  id: Id;
  name: string;
  institution?: string;
  type: AccountType;
  currency: 'NZD';
  /** Manually entered balance snapshot. A balance is never inferred as spendable. */
  balance?: { amount: Cents; asOf: IsoDate };
  /** Closing balance read from the most recent imported statement with a balance column. */
  statementBalance?: { amount: Cents; asOf: IsoDate; importId: Id };
  /** Whether the balance counts towards liquid funds in the flexibility estimate. */
  includeInLiquid: boolean;
  /** True for accounts created by the demonstration dataset. */
  isDemo?: boolean;
  createdAt: Timestamp;
}

/**
 * Category kind determines how transactions are treated in analytics:
 * - income:   counted as income (refunds/reversals of income are negative income)
 * - expense:  consumption spending; positive amounts (refunds) reduce spending
 * - transfer: movement between your own accounts; excluded from income and spending
 * - savings:  contributions to savings/investments held elsewhere; not consumption
 */
export type CategoryKind = 'income' | 'expense' | 'transfer' | 'savings';

export interface Category {
  id: Id;
  name: string;
  kind: CategoryKind;
  /** For expense categories: essential (needs) vs discretionary (wants). */
  essential: boolean;
  color: string;
  archived?: boolean;
  sortOrder: number;
}

export type CategorySource = 'rule' | 'memory' | 'manual' | 'none';

/** Part of a transaction allocated to a category. Split amounts must sum to the transaction amount. */
export interface TransactionSplit {
  id: Id;
  amount: Cents;
  categoryId: Id | null;
  note?: string;
}

export interface Transaction {
  id: Id;
  accountId: Id;
  /** Import batch that created this transaction, or null for manual entries. */
  importId: Id | null;
  date: IsoDate;
  /** Signed amount in cents: negative = money out, positive = money in. */
  amount: Cents;
  description: string;
  /** Normalised merchant key derived from the description (used by rules and memory). */
  merchant: string;
  reference?: string;
  categoryId: Id | null;
  categorySource: CategorySource;
  ruleId?: Id;
  notes?: string;
  /**
   * Optional allocation across several categories (e.g. a supermarket shop that is part
   * groceries, part household). When present, analytics use the splits instead of categoryId.
   */
  splits?: TransactionSplit[];
  /** Decision this transaction belongs to (used to measure a decision's actual cost). */
  decisionId?: Id;
  /** Deduplication key: account|date|amount|normalised description|occurrence index. */
  fingerprint: string;
  /** Original CSV row values, kept unchanged for auditing. */
  original?: Record<string, string>;
  /** Account balance after this transaction, as printed on the statement (if it had a balance column). */
  balanceAfter?: Cents;
  /** 0-based position of the row in its source file (orders same-day transactions). */
  rowIndex?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type RuleField = 'description' | 'merchant';
export type RuleOperator = 'contains' | 'startsWith' | 'equals' | 'regex';

export interface CategoryRule {
  id: Id;
  name: string;
  field: RuleField;
  operator: RuleOperator;
  pattern: string;
  caseSensitive: boolean;
  /** Restrict to money in, money out, or either. */
  direction: 'any' | 'in' | 'out';
  accountId?: Id;
  categoryId: Id;
  enabled: boolean;
  /** Lower numbers run first. */
  priority: number;
  createdAt: Timestamp;
}

/**
 * User edits to a detected recurring series (keyed by the detector's series key, e.g.
 * "out:SPARK NZ"). Overrides survive re-detection because keys are stable.
 */
export interface RecurringOverride {
  key: string;
  status: 'confirmed' | 'dismissed';
  label?: string;
  /** Expected amount per occurrence (positive cents); replaces the detected typical amount. */
  expectedAmount?: Cents;
  updatedAt: Timestamp;
}

/** Learned from manual corrections: transactions with this merchant key get this category. */
export interface MerchantMemory {
  merchant: string;
  categoryId: Id;
  updatedAt: Timestamp;
}

export type AmountMode = 'signed' | 'debitCredit';

export interface CsvMapping {
  dateColumn: string;
  dateFormat: DateFormat;
  amountMode: AmountMode;
  /** Signed amount column (amountMode = 'signed'). */
  amountColumn?: string;
  /** Flip signs when the bank reports spending as positive numbers. */
  invertSign?: boolean;
  /** Money-out column (amountMode = 'debitCredit'); values may be positive or negative. */
  debitColumn?: string;
  /** Money-in column (amountMode = 'debitCredit'). */
  creditColumn?: string;
  /** One or more columns joined with " " to form the description. */
  descriptionColumns: string[];
  referenceColumn?: string;
  /** Running balance column, if the statement has one. */
  balanceColumn?: string;
}

export interface ImportBatch {
  id: Id;
  accountId: Id;
  fileName: string;
  importedAt: Timestamp;
  mapping: CsvMapping;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  dateRange?: { start: IsoDate; end: IsoDate };
  status: 'active' | 'undone';
  undoneAt?: Timestamp;
  /** Closing balance stated by this file (balance column or summary lines), if any. */
  statementBalance?: { amount: Cents; asOf: IsoDate };
  isDemo?: boolean;
}

export interface ImportProfile {
  id: Id;
  name: string;
  mapping: CsvMapping;
  createdAt: Timestamp;
}

// ─────────────────────────── Planning / flexibility ───────────────────────────

export interface UpcomingExpense {
  id: Id;
  label: string;
  amount: Cents;
  dueDate: IsoDate;
}

export interface Goal {
  id: Id;
  name: string;
  targetAmount: Cents;
  targetDate?: IsoDate;
  /** Amount already set aside for this goal (manual). */
  currentAmount: Cents;
  /** If true, the current amount is excluded from funds available for other decisions. */
  earmarked: boolean;
  /** Optional account whose (manual) balance is the amount saved so far, instead of currentAmount. */
  accountId?: Id;
  createdAt: Timestamp;
}

/** Planned monthly spending for an expense category (manual). */
export interface Budget {
  categoryId: Id;
  monthlyAmount: Cents;
  updatedAt: Timestamp;
  /** Carry each month's unspent (or overspent) amount into the next, starting at rolloverFrom. */
  rollover?: boolean;
  rolloverFrom?: MonthKey;
}

/** User-entered planning inputs for the flexibility estimate. Values are manual by definition. */
export interface FinancialProfile {
  emergencyReserveTarget: Cents;
  monthlySavingsCommitment: Cents;
  /** Optional manual overrides of estimated recurring values (null = use estimate). */
  monthlyIncomeOverride: Cents | null;
  monthlyObligationsOverride: Cents | null;
  /** Number of complete months used for estimates. */
  lookbackMonths: number;
  upcomingExpenses: UpcomingExpense[];
  /** Horizon (days) for counting upcoming expenses against current funds. */
  upcomingHorizonDays: number;
}

// ───────────────────────────── Scenarios ─────────────────────────────

export type CashFlowTiming = 'start' | 'end';

/** A one-off cash flow in a projection. Negative = money leaves the modelled balance. */
export interface OneOffFlow {
  id: Id;
  label: string;
  /** Month offset from the projection start (0 = first month). */
  month: number;
  amount: Cents;
}

/** A recurring monthly cash flow. Negative = expense, positive = additional income/saving. */
export interface RecurringFlow {
  id: Id;
  label: string;
  startMonth: number;
  /** Inclusive end month offset; undefined = until horizon. */
  endMonth?: number;
  monthlyAmount: Cents;
  /** If true, the amount grows with inflation each year (e.g. a subscription price). */
  inflationIndexed: boolean;
}

/**
 * Assumptions for the deterministic projection engine. Rates are annual decimals
 * (0.06 = 6%). See docs/CALCULATIONS.md for exact conventions.
 */
export interface ProjectionAssumptions {
  startMonth: MonthKey;
  horizonMonths: number;
  /** Starting balance of the modelled pool (savings/investments), in cents. */
  initialBalance: Cents;
  monthlyContribution: Cents;
  timing: CashFlowTiming;
  /** Expected annual nominal return before fees and tax (illustrative, not guaranteed). */
  annualReturn: number;
  /** Annual management fee as a fraction of balance. */
  annualFee: number;
  /** Simplified tax rate applied to positive monthly investment returns. */
  taxRateOnReturns: number;
  annualInflation: number;
  /** Optional goal for progress tracking. */
  targetAmount?: Cents;
  /** Goal the target was taken from (its target date is used to check “reached in time”). */
  goalId?: Id;
}

/** Changes applied on top of base assumptions to form one alternative. */
export interface ScenarioVariant {
  id: Id;
  name: string;
  oneOffs: OneOffFlow[];
  recurring: RecurringFlow[];
  /** Added to the base monthly contribution (may be negative). */
  contributionDelta: Cents;
}

/** Monte Carlo configuration stored with a scenario set or decision. */
export interface MonteCarloConfig {
  enabled: boolean;
  /** Annual standard deviation of returns (0.12 = 12%). */
  annualVolatility: number;
  runs: number;
  seed: number;
  /** Annual probability of a market crash (0 = off). The expected return is kept unchanged. */
  crashProbability?: number;
  /** Size of a crash as a fraction of the balance's investment value (e.g. 0.3 = −30%). */
  crashSize?: number;
  /** Annual standard deviation of inflation (0 = fixed inflation). Drawn once per simulated year. */
  inflationVolatility?: number;
}

export interface ScenarioSet {
  id: Id;
  name: string;
  description?: string;
  base: ProjectionAssumptions;
  variants: ScenarioVariant[];
  monteCarlo?: MonteCarloConfig;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ───────────────────────────── ChoiceLedger ─────────────────────────────

export type DecisionStatus = 'considering' | 'decided' | 'completed' | 'reviewed';
export type DecisionCategory =
  | 'purchase'
  | 'travel'
  | 'financial'
  | 'equipment'
  | 'career'
  | 'lifestyle'
  | 'experience'
  | 'other';

/**
 * rating:  a subjective 0–10 score, normalised against the fixed 0–10 scale.
 * measure: an objective measured value (kg, hours, km…), normalised min–max across options.
 */
export type CriterionType = 'rating' | 'measure';

export interface Criterion {
  id: Id;
  name: string;
  type: CriterionType;
  direction: 'higher' | 'lower';
  /** Relative importance (any non-negative number); normalised to sum to 1. */
  weight: number;
  unit?: string;
}

export interface DecisionOption {
  id: Id;
  name: string;
  description?: string;
  /** One-off cost paid at `costMonth` (cents, positive = cost). */
  upfrontCost: Cents;
  /** Month offset when the upfront cost is paid (0 = now). */
  costMonth: number;
  /** Ongoing monthly cost (positive = cost); negative represents ongoing savings/income. */
  monthlyCost: Cents;
  /** How many months the monthly cost lasts (undefined = whole horizon). */
  monthlyCostMonths?: number;
  expectedBenefits?: string;
  risks?: string;
  /**
   * Additional cash flows beyond the simple upfront/monthly costs, e.g. when the option was
   * created from a Scenario Lab variant. Same sign convention as scenarios (negative = money out).
   */
  extraFlows?: { oneOffs: OneOffFlow[]; recurring: RecurringFlow[]; contributionDelta: Cents };
}

export interface OutcomeReview {
  reviewedAt: Timestamp;
  actualCost: Cents | null;
  /** 'linked' = computed from transactions linked to the decision; 'manual' = typed in. */
  actualCostSource?: 'manual' | 'linked';
  actualBenefits: string;
  /** 1–10 */
  satisfaction: number;
  expectationsMet: 'exceeded' | 'met' | 'partly' | 'not';
  wouldRepeat: 'yes' | 'no' | 'unsure';
  unexpected: string;
  lessons: string;
}

/** Immutable record of the decision as it stood when the choice was made. */
export interface DecisionSnapshot {
  capturedAt: Timestamp;
  options: DecisionOption[];
  criteria: Criterion[];
  scores: ScoreMatrix;
  selectedOptionId: Id;
  reasoning: string;
  /** Weighted scores (0–100) computed at the time. */
  ranking: { optionId: Id; score: number; rank: number }[];
  assumptions: ProjectionAssumptions;
  /** Key projected financial results per option at the time of the decision. */
  financials: { optionId: Id; finalNominal: Cents; finalReal: Cents; differenceVsBest: Cents }[];
  /** Flexibility estimate shown at the time (if available). */
  availableNow?: Cents;
  predictedSatisfaction: number | null;
  predictedCost: Cents;
  confidence: number | null;
  /** Monte Carlo summary at the time, if simulation was enabled. */
  monteCarlo?: {
    settings: Omit<MonteCarloConfig, 'enabled'>;
    options: { optionId: Id; p10: Cents; p50: Cents; p90: Cents }[];
  };
}

/** scores[optionId][criterionId] = value (rating 0–10, or measured value). */
export type ScoreMatrix = Record<Id, Record<Id, number | null>>;

export interface Decision {
  id: Id;
  title: string;
  description: string;
  category: DecisionCategory;
  date: IsoDate;
  status: DecisionStatus;
  options: DecisionOption[];
  criteria: Criterion[];
  scores: ScoreMatrix;
  /**
   * Optional pairwise importance judgements used to derive weights (AHP), keyed
   * "criterionA|criterionB" with the Saaty value of A relative to B (1/9 … 9).
   */
  pairwise?: Record<string, number>;
  /** Assumptions used to project the financial consequences of each option. */
  assumptions: ProjectionAssumptions;
  monteCarlo?: MonteCarloConfig;
  notes: string;
  links: string[];
  selectedOptionId: Id | null;
  reasoning: string;
  /** Predicted satisfaction with the chosen option, 1–10. */
  predictedSatisfaction: number | null;
  /** Confidence in the decision, 1–5. */
  confidence: number | null;
  reviewDate: IsoDate | null;
  snapshot: DecisionSnapshot | null;
  /** Earlier snapshots, kept when a decided choice is reopened. */
  snapshotHistory?: DecisionSnapshot[];
  review: OutcomeReview | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isDemo?: boolean;
}

export interface AppSettingRecord<T = unknown> {
  key: string;
  value: T;
}
