/**
 * End-to-end test of the core DecisionLab workflow in a real browser:
 *   import a synthetic CSV → categorise → analyse spending → enter a balance →
 *   create a decision → compare two alternatives with a deterministic projection →
 *   record the choice → review the outcome.
 *
 * Usage: npm run build && npm run e2e   (set SCREENSHOTS=1 to save docs/screenshots/*.png)
 * Uses only synthetic data. Exits non-zero on any failed step or browser error.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

const PORT = 4321;
const BASE = `http://localhost:${PORT}/`;
const shots = process.env.SCREENSHOTS === '1';
const shotDir = 'docs/screenshots';
if (shots) mkdirSync(shotDir, { recursive: true });

// Synthetic statement in a typical NZ layout (DD/MM/YYYY, signed amounts, Payee/Particulars).
const rows = [['Date', 'Amount', 'Payee', 'Particulars']];
const months = ['07', '08', '09', '10'];
for (const m of months) {
  rows.push([`01/${m}/2026`, '2150.00', 'ACME ENGINEERING LTD', 'SALARY'], [`15/${m}/2026`, '2150.00', 'ACME ENGINEERING LTD', 'SALARY']);
  rows.push([`02/${m}/2026`, '-1340.00', 'AP RENT KELBURN FLAT', 'RENT']);
  rows.push([`05/${m}/2026`, '-112.40', 'EFTPOS COUNTDOWN KELBURN', ''], [`19/${m}/2026`, '-98.10', 'NEW WORLD THORNDON', '']);
  rows.push([`07/${m}/2026`, '-18.49', 'NETFLIX.COM', '']);
  rows.push([`10/${m}/2026`, '-24.50', 'TEST KITCHEN LTD', '']);
  rows.push([`12/${m}/2026`, '-400.00', 'TRANSFER TO SAVINGS', '']);
}
rows.push(['03/11/2026', '-45.00', 'MEMPHIS BELLE CAFE', '']);
const csvPath = join(tmpdir(), 'decisionlab-e2e-statement.csv');
writeFileSync(csvPath, rows.map((r) => r.join(',')).join('\n'));
// A second statement in a Kiwibank-style layout with a running balance column.
const kbPath = join(tmpdir(), 'decisionlab-e2e-kiwibank.csv');
writeFileSync(
  kbPath,
  ['Account number,Date,Memo/Description,Amount,Balance', '38-9000-0000000-01,01-10-2026,TRANSFER FROM EVERYDAY,400.00,5400.00', '38-9000-0000000-01,28-10-2026,INTEREST CREDIT,18.40,5418.40', '38-9000-0000000-01,01-11-2026,TRANSFER FROM EVERYDAY,400.00,5818.40'].join('\n'),
);

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
// Wait until the preview server answers (poll rather than parse its coloured output).
for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error('preview server did not start');
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const snap = async (name) => shots && page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: false });
const expectText = async (text, timeout = 5000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });

try {
  console.log('DecisionLab end-to-end: vertical slice');
  await page.goto(BASE);
  await expectText('Get started');
  ok('app loads with an empty, local database');

  // 1. Import
  await page.goto(`${BASE}#/transactions`);
  await page.getByRole('button', { name: 'Import CSV' }).first().click();
  await page.setInputFiles('#csv-file', csvPath);
  await page.fill('#new-acc', 'Everyday');
  await page.getByRole('button', { name: 'Next' }).click();
  await expectText('Description columns');
  await snap('import-mapping');
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expectText('Import 33 transactions');
  ok('CSV parsed, columns suggested, preview shows 33 new rows');
  await page.getByRole('button', { name: 'Import 33 transactions' }).click();
  await expectText('Imported 33 transactions');
  ok('import committed');

  // Re-import is deduplicated
  await page.getByRole('button', { name: 'Import CSV' }).first().click();
  await page.setInputFiles('#csv-file', csvPath);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expectText('Duplicates 33');
  await page.getByRole('button', { name: 'Close' }).click();
  ok('re-importing the same file finds 33 duplicates');

  // 2. Categorise: the unknown merchant is uncategorised; teach it once for all months
  await page.getByRole('button', { name: 'Review them merchant by merchant' }).click();
  await expectText('Uncategorised, by merchant (1 merchants, 4 transactions)');
  await page.getByLabel('Category for Test Kitchen Ltd').selectOption({ label: 'Eating out' });
  await expectText('4 “Test Kitchen Ltd” transactions → Eating out');
  await page.getByRole('button', { name: 'Also make a rule' }).click();
  await expectText('Rule created: merchant contains “test kitchen ltd”');
  await expectText('Nothing to review');
  ok('review queue: one choice categorised all 4 transactions from a merchant, plus a rule for future ones');
  await snap('transactions');

  // 3. Analyse
  await page.goto(`${BASE}#/spending`);
  await expectText('Avg monthly income');
  const income = await page.locator('text=Avg monthly income').locator('..').locator('..').textContent();
  if (!income.includes('$4,300')) throw new Error(`unexpected income metric: ${income}`);
  await expectText('Netflix Com');
  ok('spending analysis: income $4,300/month (transfers excluded), recurring payments detected');
  await snap('spending');

  await page.getByRole('button', { name: /Start from typical spending/ }).click();
  await expectText('Edit budgets');
  await expectText('of $1,340'); // rent budget = median monthly rent
  ok('budgets set from typical spending, with pace-aware status');

  await page.locator('tr', { hasText: 'Netflix Com' }).getByRole('button', { name: 'Edit' }).click();
  await page.fill('#rec-label', 'Netflix');
  await page.fill('#rec-amount', '20.99');
  await page.getByRole('button', { name: 'Save and confirm' }).click();
  await page.locator('tr', { hasText: 'Netflix' }).getByText('Confirmed').waitFor();
  await expectText('$20.99');
  ok('recurring payment renamed, confirmed and given its new price');

  await page.goto(`${BASE}#/transactions`);
  await page.getByRole('button', { name: 'Import CSV' }).first().click();
  await page.setInputFiles('#csv-file', kbPath);
  await page.selectOption('#imp-account', '__new');
  await page.fill('#new-acc', 'Savings');
  await page.selectOption('#new-acc-type', 'savings');
  await page.getByRole('button', { name: 'Next' }).click();
  await expectText('Looks like a Kiwibank export');
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expectText('Closing balance in this statement: $5,818.40');
  await page.getByRole('button', { name: 'Import 3 transactions' }).click();
  await expectText('Imported 3 transactions');
  ok('Kiwibank layout detected; statement closing balance read ($5,818.40)');

  // Enter a balance so flexibility can be estimated
  await page.goto(`${BASE}#/settings`);
  await page.locator('li', { hasText: 'Everyday' }).getByRole('button', { name: 'Edit' }).click();
  await page.fill('#acc-bal', '6000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto(`${BASE}#/`);
  await expectText('Available now');
  await expectText('$6,000.00');
  await expectText('From your imported statement, as of 2026-11-01');
  await expectText('$11,818.40'); // $6,000 entered + $5,818.40 from the statement

  await expectText('You haven’t backed up yet');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await page.fill('#bkd-pass', 'correct horse battery staple');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up', exact: true }).click()]);
  if (!/decisionlab-\d{4}-\d{2}-\d{2}\.decisionlab-backup\.enc\.json$/.test(download.suggestedFilename())) throw new Error(`unexpected backup name ${download.suggestedFilename()}`);
  const content = await (await download.createReadStream()).toArray();
  if (Buffer.concat(content).toString().includes('ACME')) throw new Error('backup is not encrypted');
  await page.getByText('You haven’t backed up yet').waitFor({ state: 'detached' });
  ok('one-click encrypted backup downloaded; the reminder clears');
  ok('flexibility uses the entered balance (Manual) and the statement balance (Known)');
  await snap('overview');

  // 4. Decision
  await page.getByRole('button', { name: 'New decision' }).first().click();
  await page.waitForURL(/#\/decisions\/dec_/);
  const decisionUrl = page.url();
  await page.fill('#d-title', 'Japan trip or invest');
  const names = page.locator('input[id^="o-name-"]');
  await names.nth(0).fill('Japan trip');
  await names.nth(1).fill('Invest the money');
  await page.locator('input[id^="o-up-"]').nth(0).fill('3000');
  await page.getByRole('button', { name: '+ Enjoyment' }).click();
  await page.getByRole('button', { name: '+ Long-term usefulness' }).click();
  await page.getByLabel('Enjoyment score for Japan trip').fill('9');
  await page.getByLabel('Enjoyment score for Invest the money').fill('4');
  await page.getByLabel('Long-term usefulness score for Japan trip').fill('5');
  await page.getByLabel('Long-term usefulness score for Invest the money').fill('8');
  await expectText('All changes saved locally', 4000);
  ok('decision created with two alternatives and two weighted criteria (autosaved)');

  await page.getByRole('tab', { name: '2 · Compare' }).click();
  await expectText('Preference score');
  await expectText('How the score is calculated');
  ok('transparent weighted-score breakdown and weight sensitivity shown');
  await expectText('Cost versus preference');

  await page.getByRole('tab', { name: '1 · Options & criteria' }).click();
  await page.getByRole('button', { name: 'Compare in pairs…' }).click();
  await page.locator('dialog[open] input[type=range]').first().fill('-4'); // Enjoyment strongly more important
  await expectText('Enjoyment is strongly more important (5×)');
  await page.getByRole('button', { name: 'Use these weights' }).click();
  const w = await page.locator('input[id^="c-w-"]').first().inputValue();
  if (w !== '83.3') throw new Error(`expected AHP weight 83.3 for Enjoyment, got ${w}`);
  ok('pairwise (AHP) comparison derives weights: 5× more important ⇒ 83.3% / 16.7%');
  await snap('decision-compare');

  await page.getByRole('tab', { name: '3 · Financial impact' }).click();
  await expectText('Opportunity cost at the horizon');
  await page.fill('#dec-horizon', '120');
  await page.fill('#dec-tax', '0');
  await page.fill('#dec-fee', '0');
  await page.waitForTimeout(300);
  const row = await page.locator('tr', { hasText: 'Japan trip' }).last().textContent();
  if (!/-\$\d/.test(row)) throw new Error(`expected a negative opportunity cost, got: ${row}`);
  ok(`deterministic projection compares alternatives (${row.replace(/\s+/g, ' ').trim()})`);
  await snap('decision-finance');

  await page.getByText('Simulate uncertain investment returns').click();
  await expectText('Outcomes at the horizon', 20000);
  const diffRow = await page.locator('tr', { hasText: 'Japan trip − Invest the money' }).textContent();
  if (!/0% of runs/.test(diffRow)) throw new Error(`expected the trip to trail investing on every path: ${diffRow}`);
  ok('Monte Carlo (Web Worker) shows outcome ranges and the trip trails investing on 0% of runs');

  // 5. Decide and record
  await page.getByRole('tab', { name: '4 · Decide' }).click();
  await page.getByRole('radio', { name: /Japan trip/ }).check();
  await page.fill('#dec-reason', 'Once-in-a-while experience; fits within available funds.');
  await page.fill('#dec-sat', '8');
  await page.fill('#dec-conf', '4');
  await page.getByRole('button', { name: 'Review in 3 months' }).click();
  await page.getByRole('button', { name: /Record choice: Japan trip/ }).click();
  await expectText('Your recorded choice');
  await expectText('never rewritten');
  ok('choice recorded with frozen snapshot of reasoning, predictions and assumptions');
  await snap('decision-recorded');

  // Snapshot survives edits to live assumptions
  await page.getByRole('tab', { name: '3 · Financial impact' }).click();
  await page.fill('#dec-return', '12');
  await page.getByRole('tab', { name: '4 · Decide' }).click();
  await expectText('6.0% return');
  ok('editing live assumptions does not rewrite the recorded snapshot');

  // 6. Manual entry and split transactions
  await page.goto(`${BASE}#/transactions`);
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.fill('#mt-date', '2026-11-05');
  await page.fill('#mt-amount', '3450');
  await page.fill('#mt-desc', 'JAPAN TRAVEL AGENCY');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expectText('Transaction added');
  ok('manual transaction added (cash or anything missing from a bank export)');
  await page.getByRole('button', { name: /Countdown Kelburn/ }).first().click();
  await page.getByRole('button', { name: 'Split…' }).click();
  await page.getByLabel('Part 1 amount').fill('92.40');
  await page.getByLabel('Part 2 amount').fill('20');
  await page.getByLabel('Part 2 category').selectOption({ label: 'Shopping' });
  await expectText('Parts add up to the transaction');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expectText('Split · 2 categories');
  ok('transaction split across Groceries and Shopping with exact-cent validation');

  // 7. Review outcome with the actual cost measured from linked transactions
  await page.goto(decisionUrl);
  await page.getByRole('tab', { name: '5 · Review outcome' }).click();
  await page.getByRole('button', { name: 'Find transactions' }).click();
  await page.getByLabel('Search transactions').fill('japan');
  await page.getByRole('checkbox', { name: /JAPAN TRAVEL AGENCY/ }).check();
  await page.getByRole('button', { name: /Link 1 selected/ }).click();
  await expectText('Actual cost from linked transactions: $3,450.00');
  await page.getByRole('button', { name: /Use linked total/ }).click();
  await page.fill('#rv-less', 'Budget for transport inside Japan.');
  await page.getByRole('button', { name: 'Save review' }).click();
  await expectText('Predicted vs actual');
  await expectText('+15%');
  ok('actual cost measured from a linked transaction; review shows +15% vs prediction');
  await snap('decision-review');
  await page.goto(`${BASE}#/insights`);
  await expectText('Based on only 1 reviewed decision');
  ok('insights show sample size and caution with little data');
  await snap('insights');

  await page.goto(decisionUrl);
  await page.getByRole('button', { name: 'Open in Scenario Lab' }).click();
  await page.waitForURL(/#\/scenarios\?set=scn_/);
  if ((await page.locator('#scn-name').inputValue()) !== 'Japan trip or invest (from decision)') throw new Error('scenario not created from decision');
  await page.getByRole('button', { name: 'Create a decision from this' }).click();
  await page.waitForURL(/#\/decisions\/dec_/);
  const optionNames = await page.locator('input[id^="o-name-"]').evaluateAll((els) => els.map((e) => e.value));
  if (optionNames.join() !== 'Japan trip,Invest the money') throw new Error(`unexpected options ${optionNames}`);
  ok('decision → Scenario Lab → new decision round trip keeps the alternatives');

  await page.goto(`${BASE}#/decisions/new`);
  await page.waitForURL(/#\/decisions\/dec_/);
  await page.getByRole('button', { name: /Trip or experience/ }).click();
  const tplOptions = await page.locator('input[id^="o-name-"]').evaluateAll((els) => els.map((e) => e.value));
  if (tplOptions.join() !== 'Go,Don’t go') throw new Error(`template options ${tplOptions}`);
  if ((await page.locator('input[id^="c-name-"]').count()) !== 4) throw new Error('template criteria not applied');
  ok('built-in template pre-fills alternatives and criteria');

  // Goals and the long view
  await page.goto(`${BASE}#/settings`);
  await page.getByRole('tab', { name: 'Planning & goals' }).click();
  await page.getByRole('button', { name: 'Add goal' }).click();
  await page.fill('#g-name', 'Laptop');
  await page.fill('#g-target', '3000');
  await page.fill('#g-current', '600');
  // Target: end of the month 11 months from now ⇒ 12 monthly contributions, whatever today is.
  const now = new Date();
  const goalEnd = new Date(now.getFullYear(), now.getMonth() + 12, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await page.fill('#g-date', iso(goalEnd));
  await page.fill('#g-return', '0');
  await page.fill('#g-monthly', '150');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expectText('Needs $200/month for 12 months'); // ($3,000 − $600) ÷ 12 with no return
  await expectText('Behind plan');
  await page.goto(BASE);
  await expectText('Edit goals');
  ok('goal savings plan: $200/month needed; planned $150 is flagged as behind');

  await page.goto(`${BASE}#/spending`);
  await expectText('Net worth');
  await page.goto(`${BASE}#/insights`);
  await expectText('Year in review');
  await page.goto(`${BASE}#/transactions`);
  await page.getByRole('tab', { name: 'Categorisation rules' }).click();
  await expectText('No matches');
  ok('net worth, year in review and rule health are shown');

  // Accessibility audit (axe-core, WCAG 2.1 A/AA + best practice) of every page in both themes,
  // with synthetic demo data. CSP is bypassed only in this test context to inject axe.
  const auditCtx = await browser.newContext({ bypassCSP: true, viewport: { width: 1360, height: 900 } });
  const audit = await auditCtx.newPage();
  await audit.goto(BASE);
  await audit.getByRole('button', { name: 'Load demo data' }).first().click();
  await audit.getByText('Demonstration data loaded.').waitFor();
  const violations = [];
  for (const scheme of ['light', 'dark']) {
    await audit.emulateMedia({ colorScheme: scheme });
    for (const route of ['', 'transactions', 'spending', 'decisions', 'scenarios', 'insights', 'settings']) {
      await audit.goto(`${BASE}#/${route}`);
      await audit.waitForTimeout(800);
      await audit.addScriptTag({ path: AXE_PATH });
      const found = await audit.evaluate(async () =>
        (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] })).violations.map((v) => `${v.impact} ${v.id} (${v.nodes.length})`),
      );
      violations.push(...found.map((f) => `${scheme} /${route}: ${f}`));
    }
  }
  await auditCtx.close();
  if (violations.length) throw new Error(`Accessibility violations:\n${violations.join('\n')}`);
  ok('axe accessibility audit: no violations on any page, light and dark');

  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`\nAll ${step} steps passed.`);
} catch (e) {
  console.error(`\n✗ Failed after step ${step}: ${e.message}`);
  await page.screenshot({ path: join(tmpdir(), 'decisionlab-e2e-failure.png'), fullPage: true });
  console.error(`  screenshot: ${join(tmpdir(), 'decisionlab-e2e-failure.png')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
