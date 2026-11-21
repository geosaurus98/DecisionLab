// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MoneyInput, Segmented } from '@/ui/components';
import { ToastProvider } from '@/ui/toast';
import { ImportWizard } from '@/features/transactions/ImportWizard';
import { PairwiseWeights } from '@/features/decisions/PairwiseWeights';
import { DecisionLabDb, db, useDatabase } from '@/data/db';
import { ensureSeeded } from '@/data/init';
import { saveAccount } from '@/data/transactions';
import { blankDecision } from '@/data/decisions';
import { defaultAssumptions } from '@/data/settings';
import { polyfillDialog } from '../dom';

beforeAll(polyfillDialog);
afterEach(cleanup);

describe('MoneyInput', () => {
  it('reports cents for valid NZ amounts and flags invalid text', () => {
    const onChange = vi.fn();
    render(<MoneyInput ariaLabel="Amount" value={null} onChange={onChange} />);
    const input = screen.getByLabelText('Amount');
    fireEvent.change(input, { target: { value: '1,234.50' } });
    expect(onChange).toHaveBeenLastCalledWith(123450);
    fireEvent.change(input, { target: { value: '12.3.4' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '-5' } });
    expect(input.getAttribute('aria-invalid')).toBe('true'); // negatives not allowed by default
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('Segmented', () => {
  it('is a radio group with the selected option checked', () => {
    function Harness() {
      const [v, setV] = useState<'a' | 'b'>('a');
      return <Segmented ariaLabel="Choice" value={v} onChange={setV} options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} />;
    }
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Choice' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Beta' }));
    expect(within(group).getByRole('radio', { name: 'Beta' }).getAttribute('aria-checked')).toBe('true');
    expect(within(group).getByRole('radio', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('PairwiseWeights', () => {
  it('derives weights from a pairwise judgement and applies them', () => {
    const d = blankDecision(defaultAssumptions('2026-11-21'));
    d.criteria = [
      { id: 'fun', name: 'Fun', type: 'rating', direction: 'higher', weight: 1 },
      { id: 'cost', name: 'Practicality', type: 'rating', direction: 'higher', weight: 1 },
    ];
    const onApply = vi.fn();
    render(<PairwiseWeights open onClose={() => {}} decision={d} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText('Fun versus Practicality'), { target: { value: '-2' } }); // towards Fun
    expect(screen.getByText('Fun is moderately more important (3×)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use these weights' }));
    const [pairwise, weights] = onApply.mock.calls[0]!;
    expect(pairwise).toEqual({ 'fun|cost': 3 });
    expect(weights.fun).toBeCloseTo(0.75, 10);
  });
});

describe('ImportWizard', () => {
  let n = 0;
  beforeEach(async () => {
    useDatabase(new DecisionLabDb(`component-${++n}`));
    await ensureSeeded();
  });

  it('detects a bank layout, reads balances and imports through the preview', async () => {
    await saveAccount({ name: 'Everyday', type: 'everyday', includeInLiquid: true });
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <ImportWizard open onClose={onClose} />
      </ToastProvider>,
    );
    const csv = 'Account number,Date,Memo/Description,Amount,Balance\n38-9000-0000000-00,01-03-2026,COUNTDOWN KELBURN,-84.20,915.80\n38-9000-0000000-00,02-03-2026,ACME SALARY,2150.00,3065.80\n';
    const file = new File([csv], 'kiwibank.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });
    await screen.findByText(/Found/);
    await waitFor(() => expect((screen.getByLabelText('Import into account') as HTMLSelectElement).value).not.toBe(''));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Looks like a Kiwibank export')).toBeTruthy();
    expect((screen.getByLabelText('Date format') as HTMLSelectElement).value).toBe('DD-MM-YYYY');
    expect((screen.getByLabelText(/Balance column/) as HTMLSelectElement).value).toBe('Balance');
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByText(/Closing balance in this statement/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 transactions' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await db.transactions.count()).toBe(2);
    expect((await db.accounts.toArray())[0]!.statementBalance).toMatchObject({ amount: 306580, asOf: '2026-03-02' });
  });
});
