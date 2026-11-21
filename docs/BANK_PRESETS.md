# Bank CSV presets

DecisionLab recognises some New Zealand bank export layouts from their header row and pre-fills the column mapping. **Heartland Bank is verified** against real exports (21 Nov 2026: five account types — everyday, call, notice savers, term deposit — about 1,900 rows, zero parse errors, and every account's transactions sum exactly to the balance Heartland states). **The others are unverified**: they follow publicly described layouts, and banks change formats or offer several. The import preview always shows every row, and anything that fails to parse is reported, not imported.

| Bank | Signature headers | Date format | Description columns | Balance |
| --- | --- | --- | --- | --- |
| **Heartland Bank** ✅ | Date, Transaction Code, Transaction Reference, Amount | DD/MM/YYYY | Transaction Reference (code kept as reference) | Stated in the summary lines above the table |
| ASB | Date, Unique Id, Tran Type, Payee, Memo, Amount | YYYY/MM/DD | Payee + Memo | — |
| ANZ | Type, Details, Particulars, Code, Reference, Amount, Date | DD/MM/YYYY | Details + Particulars | — |
| BNZ | Date, Amount, Payee, Particulars, Code, Reference, Tran Type | DD/MM/YYYY (accepts YY) | Payee + Particulars | — |
| Westpac | Date, Amount, Other Party, Description, Reference, Particulars, Analysis Code | DD/MM/YYYY | Other Party + Description | — |
| Kiwibank | Date, Memo/Description, Amount, Balance | DD-MM-YYYY | Memo/Description | Balance |

A Balance column is picked up automatically whenever the file has one.

### Notes from verifying Heartland

- Exports start with summary lines (generation time, bank, account type, account number, “$X balance with $Y available as at <date>”) followed by a blank line, the header, another blank line, then rows newest-first with `$`-prefixed signed amounts and Windows line endings.
- DecisionLab reads the stated balance as the account's *Known* balance and suggests the account type line as the account name. The account number is not stored.
- Card purchases embed a timestamp in the description (`2026:07:11 17:50:03.573682` or `12-NOV-26 10.15.32.123456 AM`); these are stripped from merchant keys so the same shop is recognised every time.
- A few automatic transfers have an empty description; they are imported with the transaction code as their description instead of being rejected.
- Withholding tax on interest is categorised as (negative) income, so interest is reported net of tax; “TD Deposit” and “Internal Transfer” are transfers.

## Verifying a preset (please do this with your own export)

1. Export a CSV from internet banking and import it. Check the blue/amber notice says the bank was detected.
2. In the preview: no error rows; dates are right (watch for day/month swaps); **spending is negative and income positive**; descriptions read sensibly.
3. If a balance column exists: the closing balance matches your banking app, and there is no “doesn’t add up” warning.
4. If anything needed changing, note the correct mapping. Then, in `src/engine/csvPresets.ts`, update the preset and set `verified: { on: 'YYYY-MM-DD' }`. Add a test in `src/engine/__tests__/realdata.test.ts` using **made-up rows in the same layout** — never commit a real statement.
