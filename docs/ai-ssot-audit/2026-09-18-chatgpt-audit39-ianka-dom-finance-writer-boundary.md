# audit (39) — RP031 DOM finance crossed the canonical Sheet writer boundary

Date: 2026-09-18 KST  
Role: ChatGPT independent auditor; Claude remains the sole implementation owner.

## Verdict

**OPEN / HOLD strengthened.** Since audit (38), current main gained a material RP031 writer-topology change: PR #399 / merge `8842f41afb4b25a29712f78e011ef65d4ec9f718` wires DOM-scraped Ianka finance data (`ianka/lib/wonja/이안카요금.json`) into `ianka/scripts/이안카-재고시트.mjs`, and that same script retains a `--쓰기` path that clears/updates the RP031 Google Sheet registered as the current canonical source. Rendered-DOM finance therefore now has a manual executable route into the canonical source Sheet. This conflicts with audit (38)'s boundary that rendered DOM is consumer/bootstrap evidence only until finance authority/provenance/formula/mapping parity is proven.

## Evidence

- Current main after PR #400 is `b6e2eb788631efdea4f7b30fc168f4d3d5d15d1e`.
- PR #399 merge `8842f41afb4b25a29712f78e011ef65d4ec9f718` changed `ianka/scripts/이안카-재고시트.mjs` so it loads the DOM scrape, maps 1/3/5/12/24/36/48/60-month rental/deposit values into empty source-sheet fields, and can write the resulting rows with `--쓰기` via Sheets clear/update calls.
- The registered RP031 canonical source is still `google_sheet` in `lib/domain/inventory-source-registry.ts`; the production canonical workflow remains pinned to `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60` and does not consume this new path.
- `.github/workflows/diag-ianka-collector.yml` remains `workflow_dispatch` only and invokes `node ianka/scripts/이안카-재고시트.mjs` **without** `--쓰기`; it explicitly labels the step preview-only. Therefore this audit does **not** assert that the live RP031 Sheet has been overwritten by DOM-derived rates.
- Latest integrated preview run `35291657754` (head `b6e2eb...`) succeeded read-only. It collected API inventory **86 vehicles** and produced a proposed **89-row** source-sheet image (`73` API-only new, `13` API∩existing, `3` existing-only preserved). The current Sheet had only **16 plate rows**.
- The same run scraped **35 cards / 27 unique model names** for every term 1/3/5/12/24/36/48/60 months, but finance fill was **0 rows / 0 cells**. Debug output shows the immediate mapping blocker: current Sheet headers have no `차명` column (`차명col=-1`), so sample model names are `undefined` and cannot match the 27 scraped model names.
- This 0-fill result is not authority proof and does not make the writer safe. It instead shows the staged finance mapping is not yet deterministic against the actual canonical Sheet schema.

## Independent-audit interpretation

1. **No production corruption asserted.** The only observed integrated runs are preview-only and omit `--쓰기`.
2. **Writer-boundary conflict is real even before a successful finance match.** Current main contains a manual flag that can persist a DOM-derived finance enrichment into the registered canonical RP031 Sheet once mapping starts succeeding.
3. **`FILLIFEMPTY` is not provenance.** Empty-cell-only writes prevent overwriting existing finance values, but do not establish that the scraped DOM amount is the authoritative value for a particular plate/model/term/mileage/deposit contract.
4. **Mapping parity is presently unproven.** Latest runtime proves `차명col=-1`, 27 scraped models, 86 API vehicles, 16 current Sheet plate rows, and a proposed 89-row source image. Model-to-plate finance assignment and full source-sheet parity are not closed.
5. Existing audit (35) F86 freshness-checker drift; audit (27) Sonogong deposit recurrence; audit (28) vehicle-price lineage; audit (29) sales-tab naming migration; audit (34) newest-Atom freshness semantics; and mirror/sales/settlement/RTDB legacy writer HOLD remain unchanged.

## Claude implementation-owner handoff

- Keep RP031 DOM finance out of any `--쓰기`, scheduled writer, canonical source-sheet mutation, Atom promotion, or production repin until the finance primitive/provenance/formula and deterministic model/plate/term/mileage/deposit mapping are evidenced.
- Do not treat `FILLIFEMPTY`, a successful DOM scrape, or a preview workflow success as authority proof.
- First reconcile the real source-sheet schema (`차명` is currently absent) with an explicit deterministic key; avoid fuzzy/display-name guessing as a canonical join.
- If DOM-derived finance is ultimately approved as a source primitive, make that authority explicit in the source registry/Source Contract/writer topology and prove source-sheet parity plus Atom → snapshot → F01/F86 cross-audit before production promotion.
- Until then, RP031 remains Google-Sheet canonical and the audit (38) consumer/bootstrap-only rule remains controlling.

This audit changed documentation only. No application code or business logic was modified.