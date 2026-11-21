/**
 * Column layouts of common New Zealand bank CSV exports, used to pre-fill the import
 * mapping when a file's header matches. These are based on publicly described export
 * formats and are marked UNVERIFIED until checked against a real export: banks change
 * formats, and some offer several. The user always reviews the mapping and preview, and
 * every row that fails to parse is reported rather than imported.
 *
 * To verify a preset: import a real (personal) export, confirm the preview has no errors and
 * the amounts' signs are right, then set `verified` and note the date below.
 */
import type { CsvMapping } from '@/domain/types';
import type { DateFormat } from '@/domain/dates';

export interface BankPreset {
  id: string;
  bank: string;
  /** Headers that must all be present (case-insensitive) for the preset to match. */
  signature: string[];
  mapping: CsvMapping;
  verified: false | { on: string };
  notes?: string;
}

const m = (p: Omit<CsvMapping, 'amountMode'> & { amountMode?: CsvMapping['amountMode']; dateFormat: DateFormat }): CsvMapping => ({ amountMode: 'signed', ...p });

export const BANK_PRESETS: BankPreset[] = [
  {
    id: 'asb',
    bank: 'ASB',
    signature: ['Date', 'Unique Id', 'Tran Type', 'Payee', 'Memo', 'Amount'],
    mapping: m({ dateColumn: 'Date', dateFormat: 'YYYY/MM/DD', amountColumn: 'Amount', descriptionColumns: ['Payee', 'Memo'], referenceColumn: 'Unique Id' }),
    verified: false,
    notes: 'ASB exports start with several account-summary lines; they are skipped automatically.',
  },
  {
    id: 'anz',
    bank: 'ANZ',
    signature: ['Type', 'Details', 'Particulars', 'Code', 'Reference', 'Amount', 'Date'],
    mapping: m({ dateColumn: 'Date', dateFormat: 'DD/MM/YYYY', amountColumn: 'Amount', descriptionColumns: ['Details', 'Particulars'], referenceColumn: 'Reference' }),
    verified: false,
  },
  {
    id: 'bnz',
    bank: 'BNZ',
    signature: ['Date', 'Amount', 'Payee', 'Particulars', 'Code', 'Reference', 'Tran Type'],
    mapping: m({ dateColumn: 'Date', dateFormat: 'DD/MM/YYYY', amountColumn: 'Amount', descriptionColumns: ['Payee', 'Particulars'], referenceColumn: 'Reference' }),
    verified: false,
    notes: 'Some BNZ exports use two-digit years (DD/MM/YY); the DD/MM/YYYY format accepts both.',
  },
  {
    id: 'westpac',
    bank: 'Westpac',
    signature: ['Date', 'Amount', 'Other Party', 'Description', 'Reference', 'Particulars', 'Analysis Code'],
    mapping: m({ dateColumn: 'Date', dateFormat: 'DD/MM/YYYY', amountColumn: 'Amount', descriptionColumns: ['Other Party', 'Description'], referenceColumn: 'Reference' }),
    verified: false,
  },
  {
    id: 'kiwibank',
    bank: 'Kiwibank',
    signature: ['Date', 'Memo/Description', 'Amount', 'Balance'],
    mapping: m({ dateColumn: 'Date', dateFormat: 'DD-MM-YYYY', amountColumn: 'Amount', descriptionColumns: ['Memo/Description'], balanceColumn: 'Balance' }),
    verified: false,
    notes: 'Kiwibank offers several export layouts; check the date format in the preview.',
  },
];

/** Find the preset whose signature headers all appear in the file (most specific first). */
export function detectPreset(headers: string[]): BankPreset | null {
  const lower = new Set(headers.map((h) => h.trim().toLowerCase()));
  const matches = BANK_PRESETS.filter((p) => p.signature.every((h) => lower.has(h.toLowerCase())));
  matches.sort((a, b) => b.signature.length - a.signature.length);
  const best = matches[0];
  if (!best) return null;
  // Map preset column names onto the file's actual header spelling.
  const actual = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));
  const fix = (c?: string) => (c ? actual.get(c.toLowerCase()) ?? c : undefined);
  const mp = best.mapping;
  return {
    ...best,
    mapping: {
      ...mp,
      dateColumn: fix(mp.dateColumn)!,
      amountColumn: fix(mp.amountColumn),
      debitColumn: fix(mp.debitColumn),
      creditColumn: fix(mp.creditColumn),
      descriptionColumns: mp.descriptionColumns.map((c) => fix(c)!).filter((c) => actual.has(c.toLowerCase())),
      referenceColumn: fix(mp.referenceColumn),
      balanceColumn: mp.balanceColumn ? fix(mp.balanceColumn) : headers.find((h) => h.trim().toLowerCase() === 'balance'),
    },
  };
}
