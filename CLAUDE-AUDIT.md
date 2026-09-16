# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 관련 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 Claude 세션/다른 AI 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

ChatGPT는 current main / workflow / CI / writer topology / F01/F86 규칙을 독립 감사하고, 의미 있는 변경·충돌·해소가 있을 때 GitHub 감사로그에 남긴다. Claude 구현 Owner는 그 감사기록을 읽고 같은 단일 세션에서 수정한다.

---

Claude 구현 Owner가 **공급사 원천 / ERP5 / 판매시트 / 정제시트 / ERP 동기 / writer topology / F86 전용 projection**을 건드리거나 검토할 때는 먼저 아래를 읽는다.

- `docs/AI-SSOT-AUDIT-LOG.md`
- **SSOT 구조 계약:** `docs/ai-ssot-audit/FREEPASS-SSOT-ARCHITECTURE-CONTRACT.md`
- 최신 운영결정: `docs/ai-ssot-audit/2026-09-16-sonogong-autoplus-tab-routing.md`
- 최신 F86 점검: `docs/ai-ssot-audit/2026-09-16-f86-hahuhho-sheet-audit.md`
- 단일세션 운영 핸드오프: `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`
- **예약/자동 writer 지도:** `docs/예약작업-지도.md`
- **AI 소통 창구(짧은 질문·검토요청):** `docs/ai-ssot-audit/AI-INBOX.md`

규칙:

1. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다.
2. `.github/workflows/*sync*.yml`, legacy mirror, 현재 production pin, F01/F86 projection까지 함께 본다.
3. production pin과 current `main`을 구분해서 검토한다.
4. 새 충돌을 찾거나 기존 충돌을 해소하면 감사 이력에 날짜별로 남긴다.
5. 과거 판정은 삭제하지 않는다. 해결되면 새 항목에 `해소됨`으로 남긴다.
6. 날짜별 운영결정/감사 문서가 있으면 코드 변경 전에 함께 읽는다.
7. F01/F86/손오공/오토플러스/손님 화면은 모두 projection/output이다. 표시 요구를 upstream canonical source로 역수입하지 않는다.
8. 작업 전 `origin/main`, 현재 branch, dirty tree를 확인하고 다른 세션의 최신 변경을 덮어쓰지 않는다.
9. FreePass SSOT 코드 구현은 이 지정 Claude 세션에서만 한다. ChatGPT 감사자가 남긴 findings는 직접 근거 재확인 후 이 세션에서 처리한다.
10. 장기 구조는 `SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT` 한 방향을 지킨다. Projection을 다시 Source로 쓰지 않는다.

## 현재 최근 핵심 판정 — 2026-09-16 최신 독립 감사 기준

### production 경로 — 다시 갱신됨

- ERP5 canonical inventory source registry 자체는 맞음.
- main legacy direct ingest는 fail-closed.
- PR #294 merge로 F01/F86 통합 발행 구조가 들어온 뒤 production engine pin이 추가로 이동했다.
- **현재 `.github/workflows/erp5-ssot-refresh.yml`의 실제 pin은 `d635f8c87c3840a6956184b4d20f99dd968b6138`이다.**
- 이 repin은 PR #304, merge commit `81abd90df3bed9590c2bf498461af652488cc92e`에서 반영됐다.
- PR #304 head `f234b99eff7ae4712a13d300adcebabd33dbd286`에서 `SSOT Source Contract`와 `CI`는 둘 다 success였다.
- 한 ERP5 snapshot에서 F01 → F86을 발행하고, F86은 발행 전 백업 + `audit-f86-vs-atom --max-age-min=120` + 원자/F01/F86 칸 대조를 거치는 구조는 유지된다.
- **주의:** PR #304 merge 뒤 새 pin으로 실제 `workflow_dispatch(apply=true)` 운영 발행까지 성공했는지는 이번 독립 감사에서 확인하지 못했다. 코드/CI 확인과 live publication 확인을 구분한다.

### 예약지도 — 신규 문서 drift

- 실제 production workflow pin은 `d635f8c8...`이다.
- 그러나 현재 `docs/예약작업-지도.md`의 `통합 워크플로 엔진` 설명은 아직 **`3a334ddf...`**를 가리킨다.
- 즉 workflow와 운영지도의 production pin 설명이 한 단계 어긋나 있다.
- Claude 구현 Owner는 **예약지도 설명을 실제 workflow pin과 맞춰야 한다.** ChatGPT 감사자는 해당 운영문서를 직접 수정하지 않았다.

### F86 — 예전 9대 제외 규칙 폐기 유지

- F86은 canonical source가 아니라 하허호 전용 projection/presentation이다.
- `RETRO_SHORT`로 9대를 제외하던 규칙은 폐기됐다.
- 현재 production engine `d635f8c8...`에서도 장기 요금이 없는 차는 **싣고 요금 칸만 빈 채**로 둔다.
- 현재 목표는 **F86 대수 = F01 대수**다(공급사명 누락 등 명시적 오류는 별도 fail-closed).
- 과거 `2026-09-16-f86-hahuhho-sheet-audit.md`의 `9대 의도적 제외 PASS` 문구는 역사적 판정이다. **현재 운영규칙으로 되살리지 않는다.**

### 손오공 / 오토플러스 판매탭

- 손오공은 별도 판매탭 유지.
- 오토플러스도 별도 판매탭 유지.
- 두 공급사는 일반 `상품리스트`의 공통 기간 구조에 억지로 맞추지 않는다.
- 공급사가 실제 제공하는 고유 기간·주행거리·요금 구조를 보존하고, 공통화는 템플릿 표현에 한정한다.
- 손오공 중고렌트는 신규 탭을 만들지 않고 손오공 탭 내부 반납형 상품군에 합류하는 방향이다.
- canonical source는 계속 **RP012=ERP API, RP023=RebornCar**다.

### 손님 public projection — 보증금 drift 해소됨

- 이전 감사에서 잡힌 `deposit_note` 유실 문제는 **PR #299 merge로 해소됨**.
- merge commit: `64ce8ec8e98697767048e15ba222ccc08a8c2a18`.
- 현재 main `lib/domain/public-catalog.ts`는 `deposit_note`를 public whitelist에 포함한다.
- 현재 main `lib/format.ts`의 `depositLine()`은 금액 → 규칙 글자 → `보증금 없음` 순으로 의미를 보존한다.
- 따라서 이전 `PR #299 open / 미해소` 지시는 폐기한다.

### live gate — 실제 IANKA 문제는 미해소

- RP023 오토플러스 0건 false positive는 PR #298(`3340c015501a1ba06a58177396fe2882c1a0d3f8`)의 `--only=IANKA,IRON` 1차 수정으로 해소됨.
- 재검증 run `35034104413`에서 IRON은 통과했고, **IANKA `133허5372` 24/36/48/60개월 4칸 가격 불일치가 실제 신호로 남음.**
- 실제 값:
  - 24개월 `540000` vs `585000`
  - 36개월 `525000` vs `569000`
  - 48개월 `510000` vs `553000`
  - 60개월 `495000` vs `537000`
- 같은 run에서 아이카·아이언·오토플러스·이안카 projection/정제시트가 6~7일 stale로 관측됨.
- 이후 변경에서 이 mismatch 자체를 해소한 근거는 확인되지 않았다.

### writer topology — latent conflict 잔존

- `docs/예약작업-지도.md`는 `sales-erp-hourly.yml`과 `mirror-sync.yml`을 **꺼짐**으로 기록한다.
- 그러나 두 workflow 파일의 cron 자체는 current main에 그대로 존재한다.
- `scripts/check-schedule-map.mts`는 cron/문서 표 정합성은 보지만 GitHub Actions 실제 enable/disable 상태는 검증하지 못한다.
- 따라서 UI에서 disabled라면 active 충돌은 아니지만, 재-enable하면 legacy writer가 다시 살아날 수 있는 **재활성화 위험**이 남아 있다.
- `MIRROR_SOURCES`의 RP023 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`도 current main에 잔존한다.
- production write gate는 current main이 아니라 pinned engine 쪽에 존재한다.
- 특히 RP023 stale을 고친다고 legacy mirror를 곧바로 `--apply`하지 않는다. RebornCar canonical source 기준 projection refresh 경로를 먼저 확인한다.

## Claude 구현 Owner의 다음 우선순위

1. **`docs/예약작업-지도.md`의 production engine 설명을 실제 pin `d635f8c8...`와 맞춘다.**
2. 새 pin으로 실제 `erp5-ssot-refresh` 운영 회차가 F01/F86 발행·감사까지 성공했는지 Actions run으로 확인한다.
3. IANKA `133허5372` 가격 4칸 불일치와 4개 stale projection 원인을 canonical source 기준으로 추적한다.
4. `sales-erp-hourly.yml` / `mirror-sync.yml`의 GitHub UI disable 의존성을 장기적으로 없앨지 판단한다. 파일 schedule 제거, 별도 guard, 상태 검증 등 구현 선택은 Claude 단일 세션에서 한다.
5. RP023 legacy mirror source를 canonical 권한처럼 다시 사용하지 않는다.
6. 변경 후 반드시 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append한다.

세부 근거는 `docs/AI-SSOT-AUDIT-LOG.md`의 최신 `2026-09-16(5)` 항목을 우선 본다.