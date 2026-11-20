import { describe, expect, it } from 'vitest';
import { csvSafeCell, findHeaderRow, mapRows, parseCsvText, suggestMapping, validateMapping } from '../csv';
import type { CsvMapping } from '@/domain/types';

const SIGNED = `Date,Amount,Payee,Particulars,Code,Reference
01/03/2026,-84.20,COUNTDOWN PONSONBY,,,
02/03/2026,"2,450.00",ACME ENGINEERING LTD,SALARY,,MAR
03/03/2026,(12.50),"HELLO, FRESH",,,
31/02/2026,-5.00,BAD DATE,,,
04/03/2026,abc,BAD AMOUNT,,,
`;

describe('parseCsvText', () => {
  it('parses quoted fields, commas inside quotes and a BOM', () => {
    const parsed = parseCsvText('﻿' + SIGNED);
    expect(parsed.headers).toEqual(['Date', 'Amount', 'Payee', 'Particulars', 'Code', 'Reference']);
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.rows[2]!.Payee).toBe('HELLO, FRESH');
  });

  it('skips bank preamble lines before the header', () => {
    const text = `Account,12-3456-7890123-00\nStatement period,01/03/2026 to 31/03/2026\n\n${SIGNED}`;
    expect(findHeaderRow(text)).toBe(3);
    expect(parseCsvText(text).headers[0]).toBe('Date');
  });
});

describe('mapping', () => {
  it('suggests a signed-amount mapping with NZ date format', () => {
    const m = suggestMapping(parseCsvText(SIGNED));
    expect(m.dateColumn).toBe('Date');
    expect(m.amountMode).toBe('signed');
    expect(m.amountColumn).toBe('Amount');
    expect(m.dateFormat).toBe('DD/MM/YYYY');
    expect(m.descriptionColumns).toContain('Payee');
  });

  it('maps rows and reports per-row errors without throwing', () => {
    const parsed = parseCsvText(SIGNED);
    const mapping: CsvMapping = {
      dateColumn: 'Date',
      dateFormat: 'DD/MM/YYYY',
      amountMode: 'signed',
      amountColumn: 'Amount',
      descriptionColumns: ['Payee', 'Particulars'],
    };
    expect(validateMapping(mapping, parsed.headers)).toEqual([]);
    const rows = mapRows(parsed.rows, mapping);
    expect(rows[0]).toMatchObject({ date: '2026-03-01', amount: -8420, description: 'COUNTDOWN PONSONBY', errors: [] });
    expect(rows[1]).toMatchObject({ amount: 245000, description: 'ACME ENGINEERING LTD SALARY' });
    expect(rows[2]!.amount).toBe(-1250);
    expect(rows[3]!.errors[0]).toMatch(/date/i);
    expect(rows[4]!.errors[0]).toMatch(/amount/i);
    expect(rows[0]!.original.Payee).toBe('COUNTDOWN PONSONBY');
  });

  it('supports debit/credit columns regardless of how debits are signed', () => {
    const text = `Transaction Date,Details,Debit,Credit
2026-03-01,Rent,450.00,
2026-03-02,Pay,,2000.00
2026-03-03,Coffee,-4.50,
2026-03-04,Nothing,,
`;
    const parsed = parseCsvText(text);
    const m = suggestMapping(parsed);
    expect(m.amountMode).toBe('debitCredit');
    const rows = mapRows(parsed.rows, { ...(m as CsvMapping), dateFormat: 'YYYY-MM-DD' });
    expect(rows.map((r) => r.amount)).toEqual([-45000, 200000, -450, null]);
    expect(rows[3]!.errors[0]).toMatch(/neither/);
  });

  it('inverts signs for banks that report spending as positive', () => {
    const parsed = parseCsvText('Date,Amount,Description\n2026-03-01,20.00,Shop\n');
    const rows = mapRows(parsed.rows, {
      dateColumn: 'Date',
      dateFormat: 'YYYY-MM-DD',
      amountMode: 'signed',
      amountColumn: 'Amount',
      invertSign: true,
      descriptionColumns: ['Description'],
    });
    expect(rows[0]!.amount).toBe(-2000);
  });

  it('reports missing mapping fields', () => {
    expect(validateMapping({ amountMode: 'signed' }, ['A'])).toHaveLength(4);
  });
});

describe('csvSafeCell', () => {
  it('neutralises formula injection but keeps negative numbers', () => {
    expect(csvSafeCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvSafeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvSafeCell('-12.50')).toBe('-12.50');
    expect(csvSafeCell('a,b')).toBe('"a,b"');
  });
});
