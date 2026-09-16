# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 관련 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 Claude 세션/다른 AI 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

> 주의: 위 handoff의 **역할 분리 원칙은 유효**하지만, 그 문서의 일부 상태 설명(`eafbd88e...` pin, RETRO_SHORT 9대 제외 등)은 현재보다 오래됐다. 현재 운영 사실은 이 파일과 `docs/AI-SSOT-AUDIT-LOG.md`의 최신 항목을 우선한다.

ChatGPT는 current main / workflow / CI / writer topology / F01/F86 규칙을 독립 감사하고, 의미 있는 변경·충돌·해소가 있을 때 GitHub 감사로그에 남긴다. Claude 구현 Owner는 그 감사기록을 읽고 같은 단일 세션에서 수정한다.

---

Claude 구현 Owner가 **공급사 원천 / ERP5 / 판매시트 / 정제시트 / ERP 동기 / writer topology / F86 전용 projection**을 건드리거나 검토할 때는 먼저 아래를 읽는다.

- `docs/AI-SSOT-AUDIT-LOG.md`
- **SSOT 구조 계약:** `docs/ai-ssot-audit/FREEPASS-SSOT-ARCHITECTURE-CONTRACT.md`
- 최신 운영결정: `docs/ai-ssot-audit/2026-09-16-sonogong-autoplus-tab-routing.md`
- F86 과거 점검: `docs/ai-ssot-audit/2026-09-16-f86-hahuhho-sheet-audit.md` — 단, 그 문서의 RETRO_SHORT 9대 제외 결론은 폐기된 역사적 판정
- 단일세션 운영 핸드오프: `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md` — 역할 분리만 유효, 상태값은 최신 감사와 대조
- **예약/자동 writer 지도:** `docs/예약작업-지도.md` — 현재 engine pin 설명이 stale임
- **AI 소통 창구:** `docs/ai-ssot-audit/AI-INBOX.md`

규칙:

1. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다.
2. `.github/workflows/*sync*.yml`, legacy mirror, 현재 production pin, F01/F86 projection까지 함께 본다.
3. production pin과 current `main`을 구분해서 검토한다.
4. 새 충돌을 찾거나 기존 충돌을 해소하면 감사 이력에 날짜별로 남긴다.
5. 과거 판정은 삭제하지 않는다. 해결되면 새 항목에 `해소됨`으로 남긴다.
6. 날짜별 운영결정/감사 문서는 실제 코드/workflow보다 우선하지 않는다.
7. F01/F86/손오공/오토플러스/손님 화면은 모두 projection/output이다. 표시 요구를 upstream canonical source로 역수입하지 않는다.
8. 작업 전 `origin/main`, 현재 branch, dirty tree를 확인하고 다른 세션의 최신 변경을 덮어쓰지 않는다.
9. FreePass SSOT 코드 구현은 지정 Claude 세션에서만 한다. ChatGPT findings는 직접 근거 재확인 후 그 세션에서 처리한다.
10. 장기 구조는 `SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT` 한 방향을 지킨다. Projection을 다시 Source로 쓰지 않는다.

## 현재 최근 핵심 판정 — 2026-09-16 독립 감사 최신

### production 경로 — `d635f8c8...` 실제 운영 검증 완료

- ERP5 canonical inventory source registry는 현재 24개 공급사를 고정하며 특수 원천은 **RP006=ironrentcar.com / RP012=ERP API / RP023=RebornCar**다.
- main legacy direct ingest는 fail-closed.
- **현재 `.github/workflows/erp5-ssot-refresh.yml` checkout pin은 `d635f8c87c3840a6956184b4d20f99dd968b6138`.**
- repin 반영: PR #304, merge commit `81abd90df3bed9590c2bf498461af652488cc92e`.
- 이전 감사에서 보류했던 live publication도 이제 확인됐다.

실제 운영 증거:

- Actions run `35039845907` / `workflow_dispatch` / `apply=true` / conclusion `success`
- 실제 checkout ref `d635f8c87c3840a6956184b4d20f99dd968b6138`
- 공급사 사전검사 24/24 성공, 실제 ERP5 반영 24/24 성공
- snapshot `20260916003428110-083c958cb668`
  - 등록 1,592 / 출고불가 857 / 현재 재고 735
- public catalog 727대 expected=actual, hash 동일, missing/extra/policy/photo mismatch 0
- F01 **735대** 발행
- F86 **735대 / 19탭 / 90열** 발행
- F86 ↔ 원자 **46,675칸 mismatch 0**, freshness 1분
- 원자 ↔ F01 값 다른 칸 0 / 빠진 차 0 / 잘못 남은 차 0
- F01 ↔ F86 값 다른 칸 0 / 빠진 차 0 / 추가 차 0
- 차번/사진 링크 mismatch 0
- snapshot artifact 보존 성공

따라서 현재 pin은 **코드/CI만 통과한 상태가 아니라 실제 SOURCE → ERP5 Atom → snapshot → public/F01/F86 → 칸 감사까지 운영 한 회차 PASS**다.

### 예약지도 — 문서 drift 미해소

- 실제 production workflow pin: `d635f8c8...`
- `docs/예약작업-지도.md`의 `통합 워크플로 엔진`: 아직 `3a334ddf...`
- Claude 구현 Owner가 실제 workflow와 맞춰야 한다. ChatGPT 감사자는 운영문서를 직접 수정하지 않았다.

### F86 — 현재 규칙은 F86 = F01

- F86은 canonical source가 아니라 하허호 전용 projection/presentation.
- `RETRO_SHORT` 9대 제외 규칙은 폐기됐다.
- 장기요금 없는 9대도 싣고 요금 칸만 빈 채 둔다.
- 실제 run `35039845907`에서 F01 735대 = F86 735대가 확인됐다.
- 과거 `2026-09-16-f86-hahuhho-sheet-audit.md`의 `9대 의도적 제외 PASS`는 역사적 판정이며 현재 운영규칙으로 되살리지 않는다.

### 손오공 / 오토플러스 판매탭

- 손오공은 별도 판매탭 유지.
- 오토플러스도 별도 판매탭 유지.
- 공급사가 실제 제공하는 고유 기간·주행거리·요금 구조를 보존하고 공통화는 템플릿 표현에 한정한다.
- 손오공 중고렌트는 신규 탭을 만들지 않고 손오공 탭 내부 반납형 상품군에 합류하는 방향.
- canonical source는 **RP012=ERP API, RP023=RebornCar**.
- 실제 최신 발행 F01 구성은 상품리스트 381 / 오공구독 54 / 픽업구독 234 / 오플구독 66 = 총 735.

### 손님 public projection — 보증금 drift 해소됨

- `deposit_note` 유실 문제는 PR #299 merge로 해소됨.
- merge commit `64ce8ec8e98697767048e15ba222ccc08a8c2a18`.
- current main public whitelist가 `deposit_note`를 포함하고 `depositLine()`이 금액 → 규칙 글자 → `보증금 없음` 순으로 의미를 보존한다.

### live gate / IANKA — canonical production과 legacy projection 신호를 분리해서 본다

- RP023 false positive는 PR #298(`3340c015501a1ba06a58177396fe2882c1a0d3f8`)의 `--only=IANKA,IRON`로 해소됨.
- 과거 run `35034104413`에서 IANKA `133허5372` 24/36/48/60개월 가격 불일치와 4개 정제/projection 시트 stale이 관측됐다.
- 그러나 최신 실제 production run `35039845907`은 **canonical snapshot의 원자 ↔ F01 값 다른 칸 0**을 입증했다.
- 따라서 과거 IANKA 4칸 mismatch를 **현재 production F01 오류**로 계속 취급하지 않는다.
- 정확한 판정은: canonical production 경로 PASS, 과거 IANKA mismatch는 legacy `publish-origin-tab`/projection 계열 신호.
- 4개 legacy projection 시트가 지금도 stale인지는 최신 통합 run이 그 mirror를 갱신하지 않으므로 **재검증 전 HOLD**.
- RP023 freshness를 이유로 옛 Google Sheet mirror를 곧바로 `--apply`하지 않는다.

### writer topology — latent conflict 잔존

- `docs/예약작업-지도.md`는 `sales-erp-hourly.yml`과 `mirror-sync.yml`을 **꺼짐**으로 기록한다.
- 그러나 current main에는 cron이 그대로 존재한다.
  - `sales-erp-hourly.yml`: `0 0-9 * * 1-5`
  - `mirror-sync.yml`: `*/30 * * * *`
- `MIRROR_SOURCES` RP023의 `from`은 여전히 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`다.
- canonical registry RP023은 RebornCar다.
- UI에서 실제 disabled라면 active writer 충돌이라고 단정하지 않지만, 저장소/CI가 disable 상태를 강제하지 못하므로 재-enable 시 legacy writer가 살아날 **latent conflict**는 남아 있다.

### ACTIVE handoff 문서 — 상태 설명 stale

`docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`는 역할 분리 원칙은 맞지만 현재 상태 설명 일부가 오래됐다.

- `eafbd88e...` production pin 설명
- F86 9대 RETRO_SHORT 제외를 현재 사실처럼 설명
- 예전 writer 상태 설명

이 문서는 시작 순서에 포함되어 있으므로 Claude 구현 Owner가 예약지도와 함께 최신 감사결론으로 정리하는 것이 안전하다.

## Claude 구현 Owner의 다음 우선순위

1. **`docs/예약작업-지도.md`의 production engine 설명을 실제 pin `d635f8c8...`와 맞춘다.**
2. **`docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`의 오래된 상태 설명을 최신화한다.** 역할 분리 원칙은 유지한다.
3. legacy projection 시트가 현재도 필요한 운영면이면 `ssot-live-gate`를 다시 실행해 IANKA/4개 projection freshness의 현재 상태만 재확인한다. canonical production은 이미 PASS다.
4. `sales-erp-hourly.yml` / `mirror-sync.yml`의 GitHub UI disable 의존성을 장기적으로 없앨지 판단한다. 파일 schedule 제거, 별도 guard, 상태 검증 등 구현 선택은 Claude 단일 세션에서 한다.
5. RP023 legacy mirror source를 canonical 권한처럼 다시 사용하지 않는다.
6. 변경 후 반드시 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append한다.

세부 근거는 `docs/AI-SSOT-AUDIT-LOG.md`의 최신 `2026-09-16(6)` 항목을 우선 본다.
