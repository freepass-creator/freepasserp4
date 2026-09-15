# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 관련 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 Claude 세션/다른 AI 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

ChatGPT는 매시간 current main / workflow / CI / writer topology / F01/F86 규칙을 독립 감사하고, 의미 있는 변경·충돌·해소가 있을 때 GitHub 감사로그에 남긴다. Claude 구현 Owner는 그 감사기록을 읽고 같은 단일 세션에서 수정한다.

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
7. F01/F86/손오공구독/오플구독/손님 화면은 모두 projection/output이다. 표시 요구를 upstream canonical source로 역수입하지 않는다.
8. 작업 전 `origin/main`, 현재 branch, dirty tree를 확인하고 다른 세션의 최신 변경을 덮어쓰지 않는다.
9. FreePass SSOT 코드 구현은 이 지정 Claude 세션에서만 한다. ChatGPT 감사자가 남긴 findings는 직접 근거 재확인 후 이 세션에서 처리한다.
10. 장기 구조는 `SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT` 한 방향을 지킨다. Projection을 다시 Source로 쓰지 않는다.

## 현재 최근 핵심 판정 — 2026-09-16 08시대 감사 기준

### production 경로 — 갱신됨

- ERP5 canonical inventory source registry 자체는 맞음.
- main legacy direct ingest는 fail-closed.
- **PR #294가 merge됨** — merge commit `470b6ed2c41b074483e0426a35098b23903635e6`.
- 현재 `.github/workflows/erp5-ssot-refresh.yml`은 옛 `eafbd88e...`가 아니라 **`fb4872dd9cd18e168b043fad19c22c0f79644c17`** 엔진을 pin한다.
- 한 ERP5 snapshot에서 **F01 → F86**을 발행하고, F86은 발행 전 백업 + `audit-f86-vs-atom --max-age-min=120` + 원자/F01/F86 칸 대조를 거친다.

### F86 — 예전 9대 제외 규칙 폐기

- F86은 canonical source가 아니라 하허호 전용 projection/presentation이다.
- **`RETRO_SHORT`로 9대를 제외하던 규칙은 폐기됐다.**
- 현재 production 엔진 `fb4872dd...`에서는 장기 요금이 없는 차도 **싣고 요금 칸만 빈 채로 둔다.**
- 현재 목표는 **F86 대수 = F01 대수**다(공급사명 누락 등 명시적 오류는 별도 fail-closed).
- 과거 문서의 `F01 382 vs F86 373 → 9대 의도적 제외 PASS`는 역사적 판정일 뿐 **현재 운영규칙이 아니다. 되살리지 않는다.**

### 손오공 / 오토플러스 판매탭

- 손오공은 별도 판매탭 유지.
- 오토플러스도 별도 판매탭 유지.
- 두 공급사는 일반 `상품리스트`의 1/6/12/24/36/60 구조에 억지로 맞추지 않는다.
- 공급사가 실제 제공하는 고유 기간·주행거리·요금 구조를 보존하고, 공통화는 템플릿 표현에 한정한다.
- 손오공 중고렌트는 신규 탭을 만들지 않고 손오공 탭 내부 반납형 상품군에 합류하는 방향이다.
- canonical source는 계속 RP012=ERP API, RP023=RebornCar다.

### live gate

- RP023 오토플러스 0건 false positive는 PR #298(`3340c015501a1ba06a58177396fe2882c1a0d3f8`)의 `--only=IANKA,IRON` 1차 수정으로 해소됨.
- 재검증 run `35034104413`에서 IRON은 통과했고, **IANKA `133허5372` 24/36/48/60개월 4칸 가격 불일치가 실제 신호로 남음.**
- 같은 run에서 아이카·아이언·오토플러스·이안카 projection/정제시트가 6~7일 stale로 관측됨.
- 이 문제는 false positive가 아니라 아직 미해소된 실제 freshness/parity 문제다.

### writer topology — latent conflict 잔존

- `docs/예약작업-지도.md`는 `sales-erp-hourly.yml`과 `mirror-sync.yml`을 **꺼짐**으로 기록한다.
- 그러나 두 workflow 파일의 cron 자체는 current main에 그대로 존재한다.
- `scripts/check-schedule-map.mts`는 **cron과 문서 표의 일치만 확인하고 GitHub Actions 실제 enable/disable 상태는 검증하지 못한다.**
- 따라서 지금 UI에서 disabled라면 active 충돌은 아니지만, 누군가 재-enable하면 legacy writer가 다시 살아날 수 있는 **재활성화 위험**이 남아 있다.
- `MIRROR_SOURCES`의 RP023 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`도 current main에 잔존한다.
- 특히 RP023 stale을 고친다고 legacy mirror를 곧바로 `--apply`하지 않는다. RebornCar canonical source 기준 projection refresh 경로를 먼저 확인한다.

### 손님 public projection — 현재 main drift

- 현재 main `lib/domain/public-catalog.ts`는 `deposit_note`를 public whitelist에서 누락한다.
- 카드/상세 계열은 숫자 보증금이 0이면 규칙형 보증금 의미를 잃고 `보증금 없음`으로 보일 수 있다.
- 이는 Atom 자체가 아니라 **Projection 단계 의미 손실**이다.
- PR #299(`claude/shop-deposit-rule`)가 `deposit_note` 전달 + 공통 `depositLine()` 표시 수정으로 열려 있다. merge/검증 전까지 미해소로 본다.

## Claude 구현 Owner의 다음 우선순위

1. IANKA `133허5372` 가격 4칸 불일치와 4개 stale projection 원인을 canonical source 기준으로 추적한다.
2. `sales-erp-hourly.yml` / `mirror-sync.yml`의 **GitHub UI disable 의존성**을 장기적으로 없앨지 판단한다. 파일 schedule 제거, 별도 guard, 상태 검증 등 구현 선택은 Claude 단일 세션에서 한다.
3. RP023 legacy mirror source를 canonical 권한처럼 다시 사용하지 않는다.
4. PR #299를 검토·머지하면 카드/상세/공유 화면이 규칙형 보증금을 같은 의미로 표시하는지 다시 대조한다.
5. 변경 후 반드시 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append한다.

세부 근거는 `docs/AI-SSOT-AUDIT-LOG.md`의 최신 `2026-09-16(4)` 항목을 우선 본다.
