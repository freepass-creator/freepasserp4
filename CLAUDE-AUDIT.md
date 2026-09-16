# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 AI/Claude 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

위 handoff의 역할 분리 원칙은 유효하지만, 상태 설명은 **이 파일 + `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목 + 최신 dated audit**를 우선한다.

최신 독립 감사 근거:

- `docs/AI-SSOT-AUDIT-LOG.md`의 `2026-09-16(13)`
- `docs/AI-SSOT-AUDIT-LOG.md`의 `2026-09-16(14)` — mirror writer fail-closed 판정 정정
- `docs/ai-ssot-audit/2026-09-16-chatgpt-rtdb-zero-ratchet.md` — PR #321 RTDB direct-open 0 + CI ratchet, 잔존 SSOT HOLD 재검증
- `docs/ai-ssot-audit/2026-09-16-chatgpt-production-pin-contract-writer-topology.md`
- 직전 완전 PASS 기준: `docs/ai-ssot-audit/2026-09-16-chatgpt-run14-production-pass.md`

---

## 작업 전 불변 원칙

1. `SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT` 한 방향을 지킨다.
2. F01/F86/손오공/오토플러스/고객면은 projection이다. Projection을 canonical Source로 역류시키지 않는다.
3. production pin과 current `main`을 반드시 구분한다.
4. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다. workflow, writer topology, mirror/RTDB legacy path까지 같이 본다.
5. 손오공은 별도 `손오공구독`, 오토플러스는 별도 `오플구독`을 유지하고 공급사 고유 기간·주행거리·요금 구조를 보존한다.
6. 실제 코드 수정은 Claude 단일 구현 세션만 한다. ChatGPT findings는 근거를 재확인한 뒤 처리한다.
7. 과거 감사 판정은 삭제하지 않는다. 해소/정정 시 감사 기록에 새 항목으로 남긴다.

---

# 현재 최신 판정 — 2026-09-16

## 1. current production pin은 `1f923d27...`

current `.github/workflows/erp5-ssot-refresh.yml`의 checkout ref:

- `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f`

이 production lineage는 F01과 F86을 같은 회차에서 발행/감사하며 F86 presentation 규칙도 production 계보에 들어왔다.

확인된 F86 projection 동작:

- 묵은 `공지사항` 탭 제거 / 재생성하지 않음
- `종합`이 첫 탭
- `종합`만 timestamp + 대수
- 공급사 탭은 timestamp 없이 `회사 · N대`
- 장기 요금 없는 차량도 제외하지 않고 요금 칸만 빈 채 싣기
- `구분`/`배차상태` 값별 색은 shared sales-format 경로로 적용
- F01/F86 교차 감사 및 차량번호 사진링크 감사가 production workflow에 포함

단, `1f923d27...` 기준 **새 정규 scheduled production 회차의 완전 성공 증거는 아직 별도 확인 대상으로 남아 있다.** 현재 Actions에서 관측한 최근 scheduled ERP5 success run `35053074482`는 PR #318/#319의 `1f923d27...` repin보다 앞선 회차라 current pin 검증 증거로 쓰지 않는다.

## 2. HOLD — main Source Contract가 current production pin을 승인하지 못함

current main `scripts/check-inventory-source-contract.mts`의 `VALIDATED_ENGINES`는 `308511563...`까지만 승인하고, production pin `1f923d27...`은 포함하지 않는다.

실제 current-main Actions 증거:

- workflow: `SSOT Source Contract`
- run: `35058214607`
- job: `104672754543`
- conclusion: **failure**
- exact failure: `.github/workflows/erp5-ssot-refresh.yml: checkout ref 1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f is not an approved validated engine`

이것은 production runtime 실패를 직접 증명하는 것은 아니지만, **main이 자기 production engine을 자기 governance gate로 인증하지 못하는 계약 drift**다. Source Contract가 current pin을 인정하고 다시 green이 되기 전까지 SSOT governance 판정은 HOLD다.

최신 main generic CI run `35062421549`가 success여도 이 별도 Source Contract failure를 해소한 것으로 보지 않는다.

## 3. 픽업구독 canonical 색은 아직 미해소

production pin `1f923d27...`의 `lib/domain/category-colors.ts`:

- `MASTER_CATEGORY_COLORS['분류']['픽업구독'] = '#C2185B'`

side branch/manual publish에서 보였던 teal `#0F766E`는 production canonical SSOT가 아니다.

해결 원칙:

- channel-local `GUBUN_INK` 하드코딩 금지
- `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 확정
- F01/F86이 같은 canonical map을 계속 참조
- 정규 production 재발행 후 live `effectiveFormat` 검증

## 4. writer topology — `sales-erp-hourly.yml`과 `mirror-sync.yml` 모두 repository 기준 active-capable로 취급

### `sales-erp-hourly.yml`

current `.github/workflows/sales-erp-hourly.yml` 실제 파일에는:

- schedule `0 0-9 * * 1-5`
- scheduled event이면 `scripts/cloud-hourly-sync.mts --apply`

가 그대로 존재한다. 현재 파일에는 별도 repository-level scheduled-sync enable guard가 없다.

실제 과거 증거:

- scheduled run `34955061603`이 2026-09-15 실제 dispatch됨
- PR #317 / commit `330ada9569f6b6bcff28d1cead8132b388136ad9`에서 recurring workflow의 손오공 credential 준비 누락을 수리

따라서 Claude는 이 경로를 **active-capable scheduled writer**로 보고 ERP5 canonical writer/projection ownership과 중복 권한이 없는지 재확인해야 한다.

### `mirror-sync.yml`

current `.github/workflows/mirror-sync.yml` 실제 상태:

- schedule: `*/30 * * * *`
- `jobs.mirror`에 `MIRROR_SYNC_ENABLED` 또는 동등한 repository-level fail-closed `if`가 **없음**
- schedule 이벤트이면 `scripts/sync-mirror-all.mts --apply` 실행

따라서 GitHub Actions UI에서 disabled라면 실행되지 않을 수는 있지만, **repository 코드 자체는 disable을 강제하지 않는다.** UI에서 enable되면 30분 scheduled writer가 다시 실제 쓰기를 수행할 수 있다.

`lib/domain/mirror-sources.ts`의 RP023은 여전히 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`를 `from`으로 가진다. 이 mirror 경로는 projection/legacy 용도일 뿐 canonical inventory source 권한을 가져서는 안 된다.

## 5. 해소됨 — app/lib/components의 RTDB 직접 열기 24 → 0, main CI에 래칫 고정

PR #321 / commit `fa8915319afbd0c61affe01d99895db0e5ef9c8a`에서 `scripts/check-store-canon.mts`가 실운영의 더러운 파일을 self-test 대조군으로 쓰던 구조를 폐기하고 합성 표본 기반 자가진단으로 바뀌었다.

현재 검사 계약:

- `app`, `lib`, `components`에서 스왑점 밖 RTDB 직접 문 열기 = **0개**
- 기준값도 **0**으로 내려가 새 직접 접근이 하나라도 생기면 실패
- 명시적 문/어댑터 3곳만 검사 대상에서 제외
  - `lib/server/firebase-admin.ts`
  - `lib/server/firestore-ref-shim.ts`
  - `lib/firebase/rtdb-adapter.ts`
- `.github/workflows/ci.yml`에 `npm run check:store`가 실제 연결됨
- current main `294ecce4...`의 CI run `35062421549` = **success**

따라서 **RTDB direct-open debt 자체는 해소됨**으로 본다.

단, 이것은 §4의 legacy scheduled writer가 없어졌다는 뜻이 아니다. `mirror-sync`/`sales-erp-hourly`은 여전히 write-capable orchestration path이므로 **RTDB 0을 writer topology 해소 증거로 사용하지 않는다.**

상세 근거:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-rtdb-zero-ratchet.md`

## 6. canonical source / 특수 판매탭 계약 유지

current canonical registry:

- RP006 아이언 = `ironrentcar.com`
- RP012 손오공 = `sokrc.com/api`
- RP023 오토플러스 = `reborncar.co.kr`

운영계약:

- 손오공 = `손오공구독` 별도 탭
- 오토플러스 = `오플구독` 별도 탭
- 손오공 중고렌트 = `손오공구독` 내부 반납형
- 공급사 고유 기간·주행거리·요금 축 유지
- 공통화는 표현 템플릿만
- RTDB/mirror legacy 경로를 canonical inventory source로 되돌리는 신규 회귀 없음

---

# Claude 구현 Owner의 즉시 우선순위

1. `1f923d27...`을 `VALIDATED_ENGINES` 계약과 정합화하고 `SSOT Source Contract`를 green으로 만든다.
2. `1f923d27...` 기준 정규 scheduled production 회차가 F01/F86 발행·F86↔Atom·Atom↔F01↔F86·사진링크 감사까지 정상 완료되는지 확인한다.
3. 픽업구독 색은 `MASTER_CATEGORY_COLORS['분류']` 단일 SSOT에서만 해결한다. side-branch hardcoded 색표를 가져오지 않는다.
4. `sales-erp-hourly.yml`과 `mirror-sync.yml`을 모두 active-capable scheduled writer로 보고 실제 writer ownership/disable 방식을 repository 수준에서 명시적으로 정리한다. UI disable만으로 안전하다고 간주하지 않는다.
5. RTDB direct-open baseline 0을 유지한다. 새 코드가 스왑점을 우회하는 RTDB 문을 다시 열지 않게 `check:store`를 계속 CI gate로 둔다.
6. RP023 옛 Google Sheet mirror를 canonical source로 승격하지 않는다. RP023 canonical은 계속 RebornCar다.
7. 구현 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append한다.

이 entry point는 구현 지시의 요약이다. 세부 근거와 과거 판정은 `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목과 최신 dated audit를 우선한다.