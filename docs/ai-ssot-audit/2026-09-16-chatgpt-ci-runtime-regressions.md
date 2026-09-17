# 2026-09-16 ChatGPT independent SSOT audit — CI/runtime regression evidence

## Scope

Independent read-only audit of current `origin/main` against the latest `(17)` audit conclusions. Application code and business logic were not modified.

Current main observed during this audit: `1769d36cf0cda806f9f1b89561e637e62693b1ad`.

## 1. New regression — required shop data parity checker is stale after the Firestore cache refactor

Current main CI run `35077840002` is red. The failing required step is `웹·모바일이 같은 Firestore 피드를 쓰는가` (`npm run check:shop-data-parity`).

The checker `scripts/sim-shop-data-parity.mts` still requires literal source text:

- `collection('products')`
- `collection('policy')`

But current `lib/server/whitelabel-erp5-catalog.ts` now reads through a cache helper:

- `collection('products', 'products')`
- `collection('policies', 'policy')`
- helper body: `erp5Firestore().collection(name).get()`

Therefore this observed failure is checker-contract drift caused by implementation shape, not evidence that the guest catalog changed away from ERP5 Firestore. Until the checker is updated to validate the helper path semantically, main CI is red and this required parity guarantee is unavailable.

PR #327 / `scripts/ci-checker-manifest.json` made this checker required, so the failure is governance-relevant rather than advisory.

## 2. New runtime regression — shared credential composite action is invalid at workflow load time

Current `.github/actions/prepare-credentials/action.yml` has this input description:

```yaml
description: GOOGLE_SA_JSON 시크릿 값. 호출부에서 `${{ secrets.GOOGLE_SA_JSON }}` 로 넘긴다.
```

The `${{ secrets... }}` expression occurs inside composite action metadata where the `secrets` context is not valid. The latest observed scheduled `계약중 표기(30분)` run `35067894061` fails while loading that local action with:

`Unrecognized named-value: 'secrets'. Located expression: secrets.GOOGLE_SA_JSON`

The preceding checkout succeeds; the writer itself never runs. The prior observed contract-status scheduled run was successful, so this is an operational regression introduced after the shared-action change (`330adaf32ccf3e69f67fc4a649cb5c03cabe5231`).

Current generic `check:workflows` still passes, so its static workflow coverage does not currently detect this local composite-action expression error.

This accidental failure must not be treated as a legitimate writer-ownership gate. Repository code still declares the scheduled writer active-capable; it is simply broken before execution.

## 3. Existing settlement orchestration conflict is still live, now confirmed by scheduled failure

Latest observed scheduled `정산 접수 반영(1시간)` run `35056578656` reaches the legacy step `scripts/sync-contract-from-ledger.mts` and fails because it expects a `정산` tab that the current ledger contract no longer has:

`시트 "정산"을(를) 찾지 못했습니다.`

Current `.github/workflows/settlement-sync.yml` still invokes `sync-contract-from-ledger.mts`; it has not been switched to the production-pin implementation `sync-vehicle-lock-from-ledger.mts` that models `접수`/`취소` as ERP5 Atom lock/unlock events. Thus audit `(16)`/`(17)` remains unresolved in actual scheduled operation.

## 4. Prior SSOT holds remain unchanged

- Production engine pin remains `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`.
- Current main still carries the old F01 projection contract (`손오공구독`, five product types), while the production pin owns the newer `오공구독`/seven-type/color-lock contract. The same-output F01 writer collision from audit `(17)` remains unresolved.
- `lib/domain/category-colors.ts` on current main still has `픽업구독: #C2185B`.
- `mirror-sync.yml` remains a `*/30` scheduled `--apply` writer; `sales-erp-hourly.yml` remains a scheduled `--apply` writer in repository code. Incidental runtime failures are not governance retirement.
- Canonical inventory registry remains RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar. RP023's legacy mirror source remains the old Google Sheet and must not be interpreted as canonical.
- No new independently verified normal scheduled F01/F86 full-audit success on the current `2e880cef...` production semantics was established in this audit.

## Claude implementation-owner handoff

1. Keep the same-output F01 writer/contract conflict from `(17)` as the highest SSOT ownership item; do not mistake broken schedules for a safe retirement mechanism.
2. Repair `check:shop-data-parity` so it validates the actual helper-mediated ERP5 Firestore path and remains a meaningful required ratchet after refactors.
3. Repair `.github/actions/prepare-credentials/action.yml` metadata and add a check that validates local composite actions, not only workflow YAML wiring.
4. Replace the scheduled settlement legacy contract with the canonical current ledger/ERP5 Atom lock orchestration; verify both `접수` lock and `취소` unlock in an actual scheduled run.
5. Keep existing production-pin, pickup-color, mirror/RTDB legacy ownership, and full-run verification HOLDs open until directly evidenced as resolved.
