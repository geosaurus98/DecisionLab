/**
 * Synthetic demonstration dataset: a fictional Wellington-based graduate engineer.
 * Every value is generated from a fixed seed — none of it is real financial data.
 *
 * The output is CSV text in a typical NZ bank export layout, so loading the demo exercises
 * the same import pipeline (parsing → mapping → dedupe → categorisation) as real files.
 */
import { addDays, addMonths, daysInMonth, monthKey, monthRange, toDayNumber, type IsoDate } from '@/domain/dates';
import { mulberry32, pick, randInt, type Rng } from '@/engine/random';
import { toCsv } from '@/engine/csv';

export const DEMO_SEED = 20261120;
/** Opening balances (cents) at the start of the demo period. */
export const DEMO_OPENING = { everyday: 120_000, savings: 400_000 };

interface Row {
  date: IsoDate;
  amount: number; // cents
  payee: string;
  particulars: string;
  code: string;
  reference: string;
}

function fmtDate(d: IsoDate): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function fmtAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

function cents(rng: Rng, min: number, max: number): number {
  return Math.round((min + rng() * (max - min)) * 100);
}

function dateIn(month: string, day: number): IsoDate {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, '0')}`;
}

export interface DemoData {
  everydayCsv: string;
  savingsCsv: string;
  start: IsoDate;
  end: IsoDate;
}

export function generateDemoData(today: IsoDate, seed = DEMO_SEED): DemoData {
  const rng = mulberry32(seed);
  const endMonth = monthKey(today);
  const startMonth = addMonths(endMonth, -12);
  const start = `${startMonth}-01`;
  const everyday: Row[] = [];
  const savings: Row[] = [];
  const add = (list: Row[], date: IsoDate, amount: number, payee: string, particulars = '', code = '', reference = '') => {
    if (date >= start && date <= today) list.push({ date, amount, payee, particulars, code, reference });
  };
  const months = monthRange(startMonth, endMonth);

  // Fortnightly salary (Thursdays), weekly rent, fortnightly gym.
  let d = start;
  while (toDayNumber(d) % 7 !== 0) d = addDays(d, 1); // 1970-01-01 was a Thursday → day % 7 === 0
  for (let i = 0; d <= today; i++, d = addDays(d, 7)) {
    if (i % 2 === 0) add(everyday, d, 215_000, 'ACME ENGINEERING LTD', 'SALARY', 'GRAD ENG', 'PAYROLL');
    add(everyday, addDays(d, 1), -31_000, 'AP RENT KELBURN FLAT', 'RENT', 'FLAT 2', '');
    if (i % 2 === 1) add(everyday, addDays(d, 4), -3_600, 'LES MILLS WELLINGTON', 'MEMBERSHIP', '', '');
  }

  months.forEach((month, mi) => {
    const recent = mi >= months.length - 4; // eating-out creep in the last few months
    // Groceries: about weekly, mixed supermarkets
    for (let w = 0; w < 4 + (rng() < 0.4 ? 1 : 0); w++) {
      const store = pick(rng, ['COUNTDOWN KELBURN', 'NEW WORLD THORNDON', "PAK'NSAVE KILBIRNIE", 'COUNTDOWN CABLE CAR LANE']);
      add(everyday, dateIn(month, 2 + w * 7 + randInt(rng, 0, 2)), -cents(rng, 55, 145), `EFTPOS ${store}`, '', '', `${randInt(rng, 1000, 9999)}`);
    }
    // Eating out
    const meals = recent ? randInt(rng, 9, 13) : randInt(rng, 5, 8);
    for (let k = 0; k < meals; k++) {
      const place = pick(rng, ['MEMPHIS BELLE CAFE', 'UBER *EATS', 'SUSHI BI', 'LITTLE PENANG', 'FIDELS CAFE', 'BURGER LIQUOR', 'HOME OF THE BRAVE PIZZA']);
      add(everyday, dateIn(month, randInt(rng, 1, 28)), -cents(rng, 6, recent ? 48 : 38), place);
    }
    // Transport
    for (let k = 0; k < 3; k++) add(everyday, dateIn(month, 3 + k * 9), -2_000, 'SNAPPER TOPUP', 'BUS', '', '');
    if (rng() < 0.5) add(everyday, dateIn(month, randInt(rng, 5, 25)), -cents(rng, 40, 75), 'Z ENERGY TE ARO');
    // Utilities (power is seasonal: higher in NZ winter, Jun–Aug)
    const m = Number(month.slice(5));
    const winter = m >= 6 && m <= 8;
    add(everyday, dateIn(month, 12), -cents(rng, winter ? 115 : 62, winter ? 150 : 88), 'DD ELECTRIC KIWI', 'POWER', '', '');
    add(everyday, dateIn(month, 18), -8_500, 'DD SPARK NZ', 'BROADBAND', '', '');
    add(everyday, dateIn(month, 22), -3_500, 'ONE NZ', 'MOBILE', '', '');
    // Subscriptions
    add(everyday, dateIn(month, 7), -1_849, 'NETFLIX.COM', '', '', '');
    add(everyday, dateIn(month, 14), -1_699, 'SPOTIFY P2A1B2C3', '', '', '');
    // Monthly savings: internal transfer + investment platform
    add(everyday, dateIn(month, 2), -40_000, 'TRANSFER TO SAVINGS', '', '', 'AUTO');
    add(savings, dateIn(month, 2), 40_000, 'TRANSFER FROM EVERYDAY', '', '', 'AUTO');
    add(everyday, dateIn(month, 3), -10_000, 'SHARESIES LIMITED', 'INVEST', '', '');
    add(savings, dateIn(month, 28), Math.round(4_500 + mi * 120), 'INTEREST CREDIT', '', '', '');
    // Occasional shopping and entertainment
    if (rng() < 0.7) add(everyday, dateIn(month, randInt(rng, 1, 28)), -cents(rng, 15, 120), pick(rng, ['THE WAREHOUSE', 'KMART PETONE', 'MIGHTY APE', 'BUNNINGS PETONE']));
    if (rng() < 0.3) add(everyday, dateIn(month, randInt(rng, 1, 28)), -cents(rng, 60, 320), 'PB TECH WELLINGTON');
    if (rng() < 0.5) add(everyday, dateIn(month, randInt(rng, 1, 28)), -cents(rng, 18, 30), pick(rng, ['EVENT CINEMAS', 'STEAM GAMES']));
    // Uncategorised local purchases (no default rule matches) to demonstrate review
    if (rng() < 0.6) add(everyday, dateIn(month, randInt(rng, 1, 28)), -cents(rng, 4, 15), 'KELBURN DAIRY');
  });

  // One-off events
  const tripMonth = months[Math.max(0, months.length - 7)]!;
  add(everyday, dateIn(tripMonth, 4), -38_900, 'AIR NEW ZEALAND', 'AKL-WLG RTN', '', '');
  add(everyday, dateIn(tripMonth, 6), -42_000, 'AIRBNB * HM4ZK', '', '', '');
  const repairMonth = months[Math.max(0, months.length - 4)]!;
  add(everyday, dateIn(repairMonth, 15), -68_000, 'AA AUTO SERVICE NEWTOWN', 'REPAIR', '', '');
  const refundMonth = months[Math.max(0, months.length - 3)]!;
  add(everyday, dateIn(refundMonth, 10), 4_999, 'KMART PETONE', 'REFUND', '', '');

  // Statements include a running balance column (oldest first), like many NZ bank exports.
  const toFile = (rows: Row[], opening: number) => {
    let balance = opening;
    return toCsv(
      ['Date', 'Amount', 'Payee', 'Particulars', 'Code', 'Reference', 'Balance'],
      rows
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => {
          balance += r.amount;
          return [fmtDate(r.date), fmtAmount(r.amount), r.payee, r.particulars, r.code, r.reference, fmtAmount(balance)];
        }),
    );
  };
  return { everydayCsv: toFile(everyday, DEMO_OPENING.everyday), savingsCsv: toFile(savings, DEMO_OPENING.savings), start, end: today };
}
