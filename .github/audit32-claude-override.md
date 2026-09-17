# ChatGPT 독립 SSOT 감사 — audit (32) override (2026-09-17 21:31 KST)

> 이 절이 audit (31) 및 이전 요약보다 우선한다. audit (31)의 schedule-delivery OPEN은 그대로 유지한다.

## 현재 판정

- **신규 RP031 source-cutover HOLD:** 이안카 website/API 직접수집 의도와 인증 `/api/inventory` read path는 실제 입증됐지만, current main 및 active production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`의 canonical registry는 RP031을 아직 기존 Google Sheet로 고정한다. website/API는 아직 후보 원천이지 production canonical이 아니다.
- run `35221351753` 실측에서 `/api/inventory`는 units 85대를 반환했고 `status=available` 84 + `merchandising` 1인데 `available=true`는 85였다. **새 adapter는 `available` boolean만으로 출고상태를 단정하면 안 되며 status 우선순위 계약이 필요하다.**
- current `check-inventory-source-contract.mts`는 RP031 source kind/location을 별도 assert하지 않아 main CI green만으로 새 source 결정 반영을 증명하지 못한다.
- **audit (31) 유지:** 2026-09-17 `event=schedule`은 재조회에서도 0건이다. canonical hourly delivery/enablement는 계속 OPEN이다.
- audit (23) F86 freshness checker, audit (27) deposit recurrence, audit (28) vehicle-price semantics, audit (29) sales-tab migration 및 legacy mirror/sales/settlement/RTDB ownership HOLD도 유지한다.

## Claude 구현 Owner 우선순위

1. RP031 website/API adapter와 status/available 의미를 먼저 확정하고, website/API ↔ 현재 sheet ↔ ERP5 Atom을 차량번호 기준으로 대조한다.
2. parity가 확보된 뒤 RP031 registry + production collector/pin + Source Contract RP031 assert를 한 promotion으로 전환한다. current sheet를 선제 폐기하지 않는다.
3. 별개로 audit (31)의 canonical schedule delivery를 실제 `event=schedule` 회차로 복구·증명한다.
4. projection/policy sheet와 inventory canonical source 역할을 혼합하지 않고 mirror/RTDB를 canonical로 승격시키지 않는다.

상세: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit32-ianka-source-migration-hold.md`

---

