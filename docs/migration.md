# Inventory migration

## Source mapping

The supplied `INVENTORY` worksheet maps registration, make, model, VIN, year, colour, last service, insurance expiry, daily rate and weekly rate to `vehicles`. Rates are converted from whole-dollar spreadsheet cells to integer cents. Monthly rate, registration expiry, next service, photos and notes are not fabricated because the source does not provide them.

The workbook contains 33 non-empty records. Initial analysis found 11 missing VINs, 2 missing years, 5 missing insurance expirations, and 3 records with no rates. These are warnings rather than invented values. The script defaults every imported vehicle to `out_of_service`; an administrator must verify each record before changing it to `available`.

## Controlled procedure

1. Run the dry-run command and review its JSON report in `reports/`.
2. Correct source records or document accepted warnings after physically verifying VIN, compliance and rates.
3. Point application credentials at the intended **development/staging** project and take a Firestore export.
4. Commit only after review:

   ```powershell
   pnpm import:inventory -- --file "C:\Users\shrey\Downloads\Advance Auto Rentals Inventory.xlsx" --commit --allow-warnings
   ```

   Use `--initial-status=available` only after fleet readiness is verified.
5. Verify document count, registrations, rate cents, and the `imports/{migrationId}` status. Do not promote the same spreadsheet into production without a separate reviewed execution.

The migration ID is a hash of workbook bytes. A completed source hash cannot run twice. A failed partial migration remains `in_progress`; preserve the report, compare affected deterministic `vehicle_*` IDs, restore from the pre-import export if needed, and resolve before a controlled resume. Do not delete historic production data to “roll back.”
