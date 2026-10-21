---
name: invoice-normalizer
description: Normalizes invoice files into verified structured records. Use when extracting supplier, identifier, dates, currency, subtotal, tax, and total from an invoice.
---

# Invoice Normalizer

Normalize one local invoice without inventing missing values.

## Workflow

1. Inspect the complete input and identify its format.
2. Extract the canonical fields defined in [the field contract](references/field-contract.md).
3. Preserve unknown values as `null` and record ambiguity under `warnings`.
4. Run `python3 scripts/validate_record.py output.json`.
5. Correct validation errors and rerun until it passes.
6. Report the output path, validation result, and unresolved warnings.

If the input cannot be read, return `blocked` with the missing capability instead of producing a record.
