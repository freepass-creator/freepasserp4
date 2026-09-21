# ChatGPT independent SSOT audit 89 — production ERP5 repin to fixed F86 tabs; cross-audit red after publish

Date: 2026-09-21 KST
Scope: independent audit only. No application code or business logic was modified by the auditor.

## Material finding

Audit (88)'s native scheduling/recovery HOLD remains open, but its “Core SSOT / special-tab policy unchanged” summary is now stale because the production ERP5 engine and the F86 low-credit projection contract changed on main.

### 1. Production engine was repinned

- PR #446 merge `45cec2e30eb715d5c027d9923250ae79d5e7f461` first attempted the fixed-F86 production repin. Manual ERP5 run `35559550004` failed at `원천 계약 검사`; all source-recollection/ingest/snapshot/F01/F86 write and audit steps after that gate were skipped. That run did not write production outputs.
- PR #447 / application merge `6691b0f27c3df91ab07f3e0078903c69a1471f5e` then aligned the production workflow, AI Core shadow pipeline/receipt revision, source-contract validated-engine allowlist and schedule-map documentation on engine `0c31f98d412d9e006e1894804ebe767fc91683f1`.
- Current `.github/workflows/erp5-ssot-refresh.yml` and `scripts/check-inventory-source-contract.mts` both name `0c31f98d...` as the validated production engine.

### 2. F86 special-tab semantics changed; F01 naming did not

At engine `0c31f98d...`:

- F86 fixed base tabs are exactly `상품리스트`, `손오공상품`, `픽업구독`, `오플구독`.
- RP012 Sonogong non-pickup inventory, including `중고렌트` and `오공구독`, projects to `손오공상품`.
- T-car pickup external inventory projects to `픽업구독`.
- RP023 AutoPlus projects to `오플구독`.
- Special-tab vehicles are not duplicated into the later ordinary provider tabs.
- The four fixed F86 base-tab names carry no timestamp/count suffix; F86 freshness uses the Google Drive document `modifiedTime` rather than parsing time from the tab title.
- F01 remains intentionally `상품리스트 / 오공구독 / 픽업구독 / 오플구독`. F01 and F86 still derive from the same Atom/fixed snapshot and common sales-row/cell builder; F86 `손오공상품` reuses the F01 `오공구독` column block. This is a channel-projection naming difference, not a canonical-source split.

Therefore Audit (88)'s line that Sonogong remains `오공구독`/`픽업구독` with the “existing F86 special-tab policy unchanged” is stale for F86 and must not be used to revert the new projection.

### 3. Canonical source/writer boundaries remain unchanged

- `lib/domain/inventory-source-registry.ts` remains a 24-source canonical registry.
- RP012 remains `erp_api` at `https://sokrc.com/api`; its Sheet is projection/policy support, not inventory authority.
- RP023 remains the RebornCar website source at `https://www.reborncar.co.kr`; old/mirror Sheets are non-canonical.
- `mirror-sync.yml` and `sales-erp-hourly.yml` remain schedule-free/manual dry-run retired paths.
- Runtime settlement continues to fail closed against RTDB reintroduction; remaining RTDB references are migration/tooling debt, not canonical runtime authority.

### 4. Main guards are green, but the new production-equivalent run is post-publish red

Main merge `6691b0...` has:

- `SSOT Source Contract` run `35560310869` — `success`.
- generic `CI` run `35560310925` — `success`.

Manual ERP5 production-pin run `35560321553` on `6691b0...` completed `failure`, but importantly the failure happened **after production publication**:

- source contract — success
- source recollection — success
- T-car option audit — success
- settlement Atom lock — success
- Atom ingest — success
- policy reconciliation — success
- fixed snapshot — success
- public catalog reconciliation — success
- F01 publish — success
- F86 backup/publish — success
- F86 ↔ Atom freshness/cell first gate — success
- **Atom ↔ F01 ↔ F86 cell-level cross-audit — failure**
- photo-link audit — success
- evidence upload — success

This is therefore a **post-publish cross-parity validation failure on the newly repinned F86 contract**. The evidence does not by itself prove data corruption or identify which cell/rule mismatched, so this audit does not weaken the cross-audit or invent a root cause. But the repin is **not operationally full-green** yet, even though the outputs were published and the first F86 audit passed.

Run `35560321553` preserved artifact `erp5-ssot-snapshot-35560321553`, so Claude can use the run evidence to isolate the cross-audit mismatch without reconstructing the whole cycle.

### 5. Audit (88) scheduling/recovery HOLD is separate and remains open

The projection repin does not resolve Audit (88)'s missed 12:05 native + fallback slot, native cadence/timeliness HOLD, recovery-continuity HOLD, or monitor reconciliation WATCH. Do not conflate scheduler delivery with the F86 projection/cross-audit regression.

## Claude handoff

1. Treat production pin `0c31f98d...` and the fixed F86 four-tab contract as current main truth; do not revert to Audit (88)'s old F86 wording.
2. Keep F01 `오공구독` naming unless a separate approved decision changes F01; F86 `손오공상품` is a channel projection over the same canonical Atom/snapshot.
3. Diagnose run `35560321553` at the Atom↔F01↔F86 cross-audit boundary using its preserved snapshot/evidence. Do not weaken parity guards merely to make the run green.
4. Obtain a production-equivalent full-green run through the cross-audit before calling the repin verified.
5. Do not change the 24-source registry, Sonogong/AutoPlus source authority, retired mirror/sales paths, or RTDB retirement boundary without separate evidence.
6. Keep Audit (88) scheduler/recovery HOLD open independently.
