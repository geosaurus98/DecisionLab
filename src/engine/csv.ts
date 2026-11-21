/**
 * CSV parsing and column mapping for bank statement imports.
 *
 * Safety: files are parsed in memory only, never evaluated. Size and row limits guard
 * against accidental huge files. Values are kept as strings until mapped, and the original
 * row is retained on each transaction for auditing.
 */
import Papa from 'papaparse';
import { detectDateFormat, parseDate, type IsoDate } from '@/domain/dates';
import { parseMoney, type Cents } from '@/domain/money';
import type { CsvMapping } from '@/domain/types';

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 50_000;

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Problems found while parsing (malformed quotes, ragged rows…). */
  warnings: string[];
  /** Information from lines before the header row, when the bank includes a summary. */
  preamble: Preamble;
}

export interface Preamble {
  lines: string[];
  /** Balance stated in the summary, e.g. "$1005.74 balance with $1005.74 available as at Sat 21 Nov 2026". */
  statementBalance?: { amount: Cents; asOf: IsoDate };
  /** Account name/type line if recognisable (suggested name for a new account). */
  accountName?: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Read a bank's summary lines above the CSV header. Only the stated balance and an account
 * name are extracted; account numbers are not stored.
 */
export function parsePreamble(lines: string[]): Preamble {
  const clean = lines.map((l) => l.replace(/^\uFEFF/, '').trim()).filter((l) => l !== '');
  const out: Preamble = { lines: clean };
  for (const l of clean) {
    const m = /^(-?\$?-?[\d,]+\.\d{2})\s+balance\b.*\bas at\s+(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i.exec(l);
    if (m) {
      const amount = parseMoney(m[1]!);
      const month = MONTHS.indexOf(m[3]!.slice(0, 3).toLowerCase()) + 1;
      const date = month > 0 ? parseDate(`${m[2]}/${String(month).padStart(2, '0')}/${m[4]}`, 'DD/MM/YYYY') : null;
      if (amount !== null && date) out.statementBalance = { amount, asOf: date };
    }
  }
  // Heuristic account name: a short line that is neither the bank name, a timestamp, an account
  // number nor the balance line (e.g. "Everyday Saver", "Notice Saver").
  const candidates = clean.filter(
    (l) => l.length <= 40 && !/generated|bank$|balance|^\d{2}-\d{4}-\d{7}-\d{2,3}$/i.test(l) && !/^[\d\s-]+$/.test(l) && !l.includes(','),
  );
  if (candidates.length) out.accountName = candidates[candidates.length - 1];
  return out;
}

/**
 * Parse CSV text with a header row. Some NZ banks prepend account summary lines before the
 * header; `skipLeadingLines` handles that, and `findHeaderRow` can detect it automatically.
 */
export function parseCsvText(text: string, opts: { skipLeadingLines?: number } = {}): ParsedCsv {
  if (text.length > MAX_CSV_BYTES) {
    throw new Error(`File is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB. Split it into smaller statements.`);
  }
  let body = text.replace(/^\uFEFF/, ''); // strip UTF-8 BOM
  const skip = opts.skipLeadingLines ?? findHeaderRow(body);
  const allLines = body.split(/\r?\n/);
  const preamble = parsePreamble(allLines.slice(0, skip));
  if (skip > 0) body = allLines.slice(skip).join('\n');

  const result = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h, i) => h.trim() || `Column ${i + 1}`,
    transform: (v) => (typeof v === 'string' ? v.trim() : v),
  });
  const headers = (result.meta.fields ?? []).filter((h) => h !== '__parsed_extra');
  const warnings = result.errors.slice(0, 20).map((e) => `Row ${e.row !== undefined ? e.row + 1 : '?'}: ${e.message}`);
  if (result.errors.length > 20) warnings.push(`…and ${result.errors.length - 20} more parsing problems.`);
  if (result.data.length > MAX_CSV_ROWS) {
    throw new Error(`File has more than ${MAX_CSV_ROWS.toLocaleString()} rows. Split it into smaller statements.`);
  }
  const rows = result.data.map((r) => {
    const clean: Record<string, string> = {};
    for (const h of headers) clean[h] = r[h] ?? '';
    return clean;
  });
  return { headers, rows, warnings, preamble };
}

/**
 * Find the index of the first line that looks like a header: at least three delimited
 * fields, mostly non-numeric. Returns 0 when the first line already qualifies.
 */
export function findHeaderRow(text: string): number {
  const lines = text.split(/\r?\n/).slice(0, 15);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Summary lines such as "$1,234.56 balance with …" split on their thousands separators;
    // a header never contains a money amount.
    if (/\$\s?-?\d|\d,\d{3}\.\d{2}/.test(line)) continue;
    const fields = line.split(',').map((f) => f.replace(/"/g, '').trim());
    if (fields.length < 3) continue;
    const textual = fields.filter((f) => f !== '' && !/^[-$\d.,/()]+$/.test(f)).length;
    if (textual >= Math.ceil(fields.length * 0.6)) return i;
  }
  return 0;
}

const DATE_HINTS = ['date', 'transaction date', 'processed date', 'posted date'];
const AMOUNT_HINTS = ['amount', 'value', 'amount (nzd)'];
const DEBIT_HINTS = ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out'];
const CREDIT_HINTS = ['credit', 'deposit', 'deposits', 'money in', 'paid in'];
const DESC_HINTS = ['description', 'details', 'payee', 'particulars', 'memo', 'narrative', 'transaction details', 'merchant'];
const REF_HINTS = ['reference', 'ref', 'code'];
const BALANCE_HINTS = ['balance', 'closing balance', 'running balance'];

function findHeader(headers: string[], hints: string[]): string | undefined {
  const lower = headers.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const idx = lower.indexOf(hint);
    if (idx >= 0) return headers[idx];
  }
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx >= 0) return headers[idx];
  }
  return undefined;
}

/** Suggest a mapping from header names and sample values. The user always confirms it. */
export function suggestMapping(parsed: ParsedCsv): Partial<CsvMapping> {
  const { headers, rows } = parsed;
  const dateColumn = findHeader(headers, DATE_HINTS);
  const debitColumn = findHeader(headers, DEBIT_HINTS);
  const creditColumn = findHeader(headers, CREDIT_HINTS);
  const amountColumn = findHeader(headers, AMOUNT_HINTS);
  const descriptionCandidates = headers.filter((h) => DESC_HINTS.some((hint) => h.toLowerCase().includes(hint)));
  const descriptionColumns = descriptionCandidates.length > 0 ? descriptionCandidates.slice(0, 2) : headers.slice(1, 2);
  const mapping: Partial<CsvMapping> = {
    dateColumn,
    descriptionColumns,
    referenceColumn: findHeader(headers, REF_HINTS),
    balanceColumn: findHeader(headers, BALANCE_HINTS),
  };
  if (amountColumn) {
    mapping.amountMode = 'signed';
    mapping.amountColumn = amountColumn;
  } else if (debitColumn || creditColumn) {
    mapping.amountMode = 'debitCredit';
    mapping.debitColumn = debitColumn;
    mapping.creditColumn = creditColumn;
  } else {
    mapping.amountMode = 'signed';
  }
  if (dateColumn) {
    const samples = rows.slice(0, 50).map((r) => r[dateColumn] ?? '');
    mapping.dateFormat = detectDateFormat(samples) ?? 'DD/MM/YYYY';
  }
  return mapping;
}

export interface MappedRow {
  rowNumber: number;
  date: IsoDate | null;
  amount: Cents | null;
  description: string;
  reference?: string;
  /** Running balance after this row, if a balance column is mapped and the cell is not empty. */
  balance?: Cents | null;
  original: Record<string, string>;
  errors: string[];
}

export function validateMapping(mapping: Partial<CsvMapping>, headers: string[]): string[] {
  const errors: string[] = [];
  const has = (c?: string) => !!c && headers.includes(c);
  if (!has(mapping.dateColumn)) errors.push('Choose the date column.');
  if (!mapping.dateFormat) errors.push('Choose the date format.');
  if (mapping.amountMode === 'signed') {
    if (!has(mapping.amountColumn)) errors.push('Choose the amount column.');
  } else if (mapping.amountMode === 'debitCredit') {
    if (!has(mapping.debitColumn) && !has(mapping.creditColumn)) errors.push('Choose a debit and/or credit column.');
  } else {
    errors.push('Choose how amounts are represented.');
  }
  if (!mapping.descriptionColumns?.length || !mapping.descriptionColumns.every(has)) {
    errors.push('Choose at least one description column.');
  }
  return errors;
}

/** Apply a column mapping to parsed rows, producing typed values plus per-row errors. */
export function mapRows(rows: Record<string, string>[], mapping: CsvMapping): MappedRow[] {
  return rows.map((row, i) => {
    const errors: string[] = [];
    const rawDate = row[mapping.dateColumn] ?? '';
    const date = parseDate(rawDate, mapping.dateFormat);
    if (!date) errors.push(`Unrecognised date "${rawDate}" for format ${mapping.dateFormat}.`);

    let amount: Cents | null = null;
    if (mapping.amountMode === 'signed') {
      const raw = row[mapping.amountColumn ?? ''] ?? '';
      amount = parseMoney(raw);
      if (amount === null) errors.push(`Unrecognised amount "${raw}".`);
      else if (mapping.invertSign) amount = amount === 0 ? 0 : -amount;
    } else {
      const debitRaw = mapping.debitColumn ? row[mapping.debitColumn] ?? '' : '';
      const creditRaw = mapping.creditColumn ? row[mapping.creditColumn] ?? '' : '';
      const debit = parseMoney(debitRaw);
      const credit = parseMoney(creditRaw);
      if (debitRaw !== '' && debit === null) errors.push(`Unrecognised debit "${debitRaw}".`);
      if (creditRaw !== '' && credit === null) errors.push(`Unrecognised credit "${creditRaw}".`);
      if (errors.length === 0) {
        if (debit === null && credit === null) {
          errors.push('Row has neither a debit nor a credit amount.');
        } else {
          // Debits reduce the balance regardless of how the bank signs them.
          const value = (credit !== null ? Math.abs(credit) : 0) - (debit !== null ? Math.abs(debit) : 0);
          amount = value === 0 ? 0 : value;
        }
      }
    }

    const description = mapping.descriptionColumns
      .map((c) => row[c] ?? '')
      .filter((v) => v !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const reference = mapping.referenceColumn ? row[mapping.referenceColumn] || undefined : undefined;
    // A blank description must not drop a real transaction (it would break balances); fall back
    // to the reference/code column, or a placeholder.
    const finalDescription = description || (reference ? `(${reference})` : '(no description)');
    let balance: Cents | null | undefined;
    if (mapping.balanceColumn) {
      const raw = row[mapping.balanceColumn] ?? '';
      // A missing or unreadable balance cell does not block the transaction; it is just not
      // used for balance checks.
      balance = raw.trim() === '' ? null : parseMoney(raw);
    }

    return { rowNumber: i + 1, date, amount, description: finalDescription, reference, balance, original: { ...row }, errors };
  });
}

/** Neutralise spreadsheet formula injection when exporting user-controlled text to CSV. */
export function csvSafeCell(value: string | number): string {
  const s = String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers.map(csvSafeCell).join(','), ...rows.map((r) => r.map(csvSafeCell).join(','))].join('\n');
}
