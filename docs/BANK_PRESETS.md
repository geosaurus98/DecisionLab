# Bank CSV presets

DecisionLab recognises some New Zealand bank export layouts from their header row and pre-fills the column mapping. **All presets are currently unverified**: they follow publicly described layouts, and banks change formats or offer several. The import preview always shows every row, and anything that fails to parse is reported, not imported.

| Bank | Signature headers | Date format | Description columns | Balance |
| --- | --- | --- | --- | --- |
| ASB | Date, Unique Id, Tran Type, Payee, Memo, Amount | YYYY/MM/DD | Payee + Memo | — |
| ANZ | Type, Details, Particulars, Code, Reference, Amount, Date | DD/MM/YYYY | Details + Particulars | — |
| BNZ | Date, Amount, Payee, Particulars, Code, Reference, Tran Type | DD/MM/YYYY (accepts YY) | Payee + Particulars | — |
| Westpac | Date, Amount, Other Party, Description, Reference, Particulars, Analysis Code | DD/MM/YYYY | Other Party + Description | — |
| Kiwibank | Date, Memo/Description, Amount, Balance | DD-MM-YYYY | Memo/Description | Balance |

A Balance column is picked up automatically whenever the file has one.

## Verifying a preset (please do this with your own export)

1. Export a CSV from internet banking and import it. Check the blue/amber notice says the bank was detected.
2. In the preview: no error rows; dates are right (watch for day/month swaps); **spending is negative and income positive**; descriptions read sensibly.
3. If a balance column exists: the closing balance matches your banking app, and there is no “doesn’t add up” warning.
4. If anything needed changing, note the correct mapping. Then, in `src/engine/csvPresets.ts`, update the preset and set `verified: { on: 'YYYY-MM-DD' }`. Add a test in `src/engine/__tests__/realdata.test.ts` using **made-up rows in the same layout** — never commit a real statement.
