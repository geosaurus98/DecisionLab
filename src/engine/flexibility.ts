/**
 * Financial flexibility estimate: how much money is realistically available for
 * discretionary decisions. A positive bank balance is NOT treated as spendable: reserves,
 * upcoming expenses and earmarked goal funds are deducted first.
 *
 * Two separate figures are produced (they answer different questions):
 *  - availableNow: one-off capacity = liquid balances − emergency reserve − upcoming expenses
 *                  due within the horizon − earmarked goal funds.
 *  - monthlyCapacity: ongoing discretionary capacity per month = typical income
 *                  − recurring obligations − essential variable spending − savings commitment.
 *
 * Every line item carries provenance (known / estimated / manual) for display.
 */
import type { Cents } from '@/domain/money';
import { addDays, type IsoDate } from '@/domain/dates';
import type { Account, Budget, Category, FinancialProfile, Goal, Provenance } from '@/domain/types';
import type { MonthlySummary } from './cashflow';
import type { RecurringSeries } from './recurring';
import { median } from './stats';

export interface FlexLine {
  label: string;
  amount: Cents;
  provenance: Provenance;
  detail?: string;
}

export interface FlexibilityEstimate {
  availableNow: Cents | null;
  availableNowLines: FlexLine[];
  monthlyCapacity: Cents | null;
  monthlyLines: FlexLine[];
  warnings: string[];
  /** Number of complete months the estimate is based on. */
  monthsUsed: number;
  /** Sum of budgets for discretionary (non-essential) categories, if any budgets are set. */
  budgetedDiscretionary: Cents | null;
  /** Monthly capacity not yet allocated to discretionary budgets. */
  unallocatedCapacity: Cents | null;
}

export interface FlexibilityInput {
  accounts: Account[];
  goals: Goal[];
  profile: FinancialProfile;
  /** Complete months only, most recent last. */
  completeMonths: MonthlySummary[];
  recurring: RecurringSeries[];
  /** Used to exclude transfers/savings from obligations and to find essential recurring payments. */
  categories: Map<string, Category>;
  today: IsoDate;
  /** Optional category budgets; discretionary ones are compared with monthly capacity. */
  budgets?: Budget[];
}

export function estimateFlexibility(input: FlexibilityInput): FlexibilityEstimate {
  const { accounts, goals, profile, recurring, today, categories } = input;
  const warnings: string[] = [];
  const months = input.completeMonths.slice(-Math.max(1, profile.lookbackMonths));

  // ── One-off capacity ──
  const availableNowLines: FlexLine[] = [];
  const liquid = accounts.filter((a) => a.includeInLiquid && a.balance);
  const missingBalances = accounts.filter((a) => a.includeInLiquid && !a.balance);
  let availableNow: Cents | null = null;
  if (liquid.length > 0) {
    let total = 0;
    for (const a of liquid) {
      total += a.balance!.amount;
      availableNowLines.push({
        label: `Balance: ${a.name}`,
        amount: a.balance!.amount,
        provenance: 'manual',
        detail: `Entered by you, as of ${a.balance!.asOf}`,
      });
    }
    availableNowLines.push({
      label: 'Emergency reserve target',
      amount: -profile.emergencyReserveTarget,
      provenance: 'manual',
    });
    total -= profile.emergencyReserveTarget;
    const horizonEnd = addDays(today, profile.upcomingHorizonDays);
    const upcoming = profile.upcomingExpenses.filter((e) => e.dueDate >= today && e.dueDate <= horizonEnd);
    for (const e of upcoming) {
      availableNowLines.push({ label: `Upcoming: ${e.label}`, amount: -e.amount, provenance: 'manual', detail: `Due ${e.dueDate}` });
      total -= e.amount;
    }
    for (const g of goals.filter((g) => g.earmarked)) {
      // A goal tracked by its own account only needs earmarking when that account's balance
      // is counted as liquid (otherwise it was never included in the total).
      const saved = goalSaved(g, accounts);
      if (saved <= 0) continue;
      if (g.accountId && !liquid.some((a) => a.id === g.accountId)) continue;
      availableNowLines.push({ label: `Earmarked for goal: ${g.name}`, amount: -saved, provenance: 'manual' });
      total -= saved;
    }
    availableNow = total;
    if (missingBalances.length > 0) {
      warnings.push(`No balance entered for ${missingBalances.map((a) => a.name).join(', ')}; excluded from available funds.`);
    }
    const stale = liquid.filter((a) => a.balance!.asOf < addDays(today, -31));
    if (stale.length > 0) warnings.push(`Balance for ${stale.map((a) => a.name).join(', ')} is more than a month old.`);
  } else {
    warnings.push('Enter at least one account balance (Settings → Accounts) to estimate money available now.');
  }

  // ── Monthly capacity ──
  const monthlyLines: FlexLine[] = [];
  let monthlyCapacity: Cents | null = null;
  if (months.length === 0 && profile.monthlyIncomeOverride === null) {
    warnings.push('Import at least one complete month of transactions to estimate monthly capacity.');
  } else {
    const activeRecurring = recurring.filter((r) => r.active);
    // Only consumption counts as an obligation: recurring transfers and savings contributions
    // are excluded (savings are represented by the explicit savings commitment instead).
    const recurringOut = activeRecurring.filter((r) => {
      if (r.direction !== 'out') return false;
      const kind = r.categoryId ? categories.get(r.categoryId)?.kind : undefined;
      return kind === undefined || kind === 'expense';
    });
    const recurringOutTotal = -recurringOut.reduce((a, r) => a + r.monthlyEquivalent, 0);

    const income =
      profile.monthlyIncomeOverride ?? Math.round(median(months.map((m) => m.income)));
    monthlyLines.push({
      label: 'Typical monthly income',
      amount: income,
      provenance: profile.monthlyIncomeOverride !== null ? 'manual' : 'estimated',
      detail:
        profile.monthlyIncomeOverride !== null
          ? 'Entered by you'
          : `Median of ${months.length} complete month${months.length === 1 ? '' : 's'}`,
    });

    const obligations = profile.monthlyObligationsOverride ?? recurringOutTotal;
    monthlyLines.push({
      label: 'Recurring obligations',
      amount: -obligations,
      provenance: profile.monthlyObligationsOverride !== null ? 'manual' : 'estimated',
      detail:
        profile.monthlyObligationsOverride !== null
          ? 'Entered by you'
          : `${recurringOut.length} detected recurring payment${recurringOut.length === 1 ? '' : 's'} (monthly equivalent)`,
    });

    // Essential variable spending = median monthly essential spending minus the recurring
    // payments in essential categories (already counted as obligations), floored at zero.
    const essentialMedian = months.length > 0 ? Math.round(median(months.map((m) => m.essentialSpending))) : 0;
    const essentialRecurring = -recurringOut
      .filter((r) => r.categoryId !== null && categories.get(r.categoryId)?.essential === true)
      .reduce((a, r) => a + r.monthlyEquivalent, 0);
    const essentialVariable = Math.max(0, essentialMedian - essentialRecurring);
    monthlyLines.push({
      label: 'Essential variable spending',
      amount: -essentialVariable,
      provenance: 'estimated',
      detail: 'Median essential spending, excluding recurring payments already counted',
    });

    monthlyLines.push({
      label: 'Savings commitment',
      amount: -profile.monthlySavingsCommitment,
      provenance: 'manual',
    });
    monthlyCapacity = income - obligations - essentialVariable - profile.monthlySavingsCommitment;
    if (months.length > 0 && months.length < 3) {
      warnings.push(`Monthly estimate is based on only ${months.length} complete month${months.length === 1 ? '' : 's'}; treat it as rough.`);
    }
    if (months.some((m) => m.uncategorisedOut > 0)) {
      warnings.push('Some spending is uncategorised; it is treated as discretionary until categorised.');
    }
  }
  const discretionaryBudgets = (input.budgets ?? []).filter((b) => {
    const c = categories.get(b.categoryId);
    return b.monthlyAmount > 0 && c?.kind === 'expense' && !c.essential && !c.archived;
  });
  const budgetedDiscretionary = discretionaryBudgets.length ? discretionaryBudgets.reduce((a, b) => a + b.monthlyAmount, 0) : null;
  const unallocatedCapacity = budgetedDiscretionary !== null && monthlyCapacity !== null ? monthlyCapacity - budgetedDiscretionary : null;
  if (unallocatedCapacity !== null && unallocatedCapacity < 0) {
    warnings.push(`Your discretionary budgets exceed estimated monthly capacity by ${(-unallocatedCapacity / 100).toFixed(2)} dollars.`);
  }
  return { availableNow, availableNowLines, monthlyCapacity, monthlyLines, warnings, monthsUsed: months.length, budgetedDiscretionary, unallocatedCapacity };
}

/** Amount saved towards a goal: its account's balance if linked, otherwise the manual amount. */
export function goalSaved(goal: Goal, accounts: Account[]): Cents {
  if (goal.accountId) {
    const acc = accounts.find((a) => a.id === goal.accountId);
    if (acc?.balance) return acc.balance.amount;
  }
  return goal.currentAmount;
}
