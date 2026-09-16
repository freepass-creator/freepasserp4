# 2026-09-17 ChatGPT 독립 SSOT 감사 — `check:shop-data-parity` 회귀 해소 확인

## 범위

`CLAUDE-AUDIT.md`, `docs/AI-SSOT-AUDIT-LOG.md` 최신 `(20)`, current `origin/main`, production workflow/pin, writer topology, ERP5 canonical source registry, F01/F86 projection, 손오공·오토플러스 전용탭, mirror/RTDB legacy 경로, 최근 commit/CI를 독립 대조했다. 애플리케이션 코드와 비즈니스 로직은 수정하지 않았다.

## 1. 해소됨 — required `check:shop-data-parity` checker drift

current main HEAD는 `7535c581245f89b2da95f910e05fead4d14a24e2`이며 PR #337의 merge commit이다.

PR #337은 `scripts/sim-shop-data-parity.mts` 한 파일만 수정했다. 기존 checker가 cache/helper refactor 이전 형태인 `collection('products')`, `collection('policy')`와 feed route 내부 직접 reader 호출을 요구하던 것을, 현재 구현 형태에 맞춰 다음을 검증하도록 변경했다.

- `collection('products', 'products')`
- `collection('policies', 'policy')`
- `app/api/catalog/feed/route.ts`가 `loadGuestListing`을 사용
- `lib/server/guest-listing.ts`가 `readWhitelabelCatalogFromErp5`를 사용
- `includePartners: !!providerCode`, `includeUsers: !!share` 유지
- feed/listing 양쪽에서 `firebaseAdminApp`, `firestore-ref-shim`, `.ref(` 직접 경로 금지

즉 required ratchet을 느슨하게 없앤 것이 아니라 helper 아래로 이동한 ERP5 Firestore 읽기 계약을 따라가도록 정적 검사 위치를 옮겼다.

## 2. CI 증거

PR head `ff02d8f662e84290c949d1b3a3e1a2c388d9dacd`의 `verify` check가 success였다.

merge 뒤 main push CI:

- run `35117788232`
- head `7535c581245f89b2da95f910e05fead4d14a24e2`
- conclusion: **success**

job `104867526238`에서 다음 단계가 실제 success다.

- `RTDB 스왑점 밖 직접 열기`
- `웹·모바일이 같은 Firestore 피드를 쓰는가`
- `Production build`

따라서 audit `(18)~(20)`의 “required checker가 current helper 구조를 오탐해 main CI가 red” 판정은 **해소됨**으로 갱신한다.

## 3. 별개 HOLD는 해소되지 않음

이번 #337은 checker 파일 하나만 바꿨으므로 다음 기존 SSOT/운영 항목은 그대로 남는다.

- production pin `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`
- current main legacy F01 writer와 production F01의 same-output contract 충돌
- `.github/actions/prepare-credentials/action.yml`의 composite-action metadata `${{ secrets.GOOGLE_SA_JSON }}` 문제
- `settlement-sync.yml`의 옛 `sync-contract-from-ledger.mts`/`정산` 탭 경로와 Atom-lock 미연결
- 픽업구독 canonical 색 `#C2185B`
- `mirror-sync.yml` / `sales-erp-hourly.yml` write-capable cron 선언 및 RP023 legacy mirror source
- current production semantics 기준 정상 scheduled F01/F86 full-audit 확인 HOLD

## 4. schedule dispatch gap 재확인

2026-09-17 00:50 KST 근처에 GitHub Actions `event=schedule` 기록을 다시 조회했지만 2026-09-16 하루에 여전히 4건만 확인됐고, 마지막은 16:18:54 KST의 `계약중 표기(30분)` run `35067894061`이었다.

repository의 cron 선언은 그대로이므로 audit `(20)`의 schedule-delivery/enablement drift는 **미해소 유지**다. 원인은 workflow disable인지 scheduler delivery 누락인지 독립 확정하지 않는다.

## Claude 구현 Owner handoff

1. `check:shop-data-parity` checker drift는 해소됨으로 닫고, 현재 의미적 검사를 약화시키지 않는다.
2. schedule-delivery gap, same-output F01 writer ownership, credential composite action, settlement Atom-lock orchestration을 우선 미해소 항목으로 유지한다.
3. 픽업구독 색은 production `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 처리한다.
4. mirror/RTDB legacy 경로를 canonical source로 승격시키지 않는다.
