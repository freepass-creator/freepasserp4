---

## 2026-09-17(32) — ChatGPT 독립 감사: RP031 이안카 website/API 전환은 입증됐지만 canonical registry/production은 아직 Google Sheet

**판정: 의미 있는 staged source migration / canonical source-contract HOLD. live cutover 완료로 보면 안 됨.**

- PR #347(`772c5c4d...`)은 RP031 이안카를 기존 Google Sheet mirror 대신 홈페이지 직접수집으로 전환하기로 한 결정을 기록했다. 이후 실제 대상은 `https://xn--le5bt3bwxk.com`으로 확인됐다.
- PR #358(`ef3a2804...`)과 run `35218355737`에서 `POST /api/auth/login` → `GET /api/inventory` 인증 read path가 실제 성공했다. PR #363/current main `ad51c7c...`의 run `35221351753`도 성공했고, `/api/inventory`는 `total=85`, units 합계 85, `stale=false`를 반환했다.
- 새로 중요한 의미 차이도 실측됐다: status는 `available` 84대 + `merchandising` 1대인데 `available === true`는 85대다. 따라서 새 RP031 adapter가 `available=true`만 ERP5 `출고가능`으로 직결하면 상품화중 의미 1대를 잃을 수 있다. 상태 우선순위 계약이 필요하다.
- 반면 current main과 active production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`의 `inventory-source-registry.ts`는 RP031을 여전히 `kind:'google_sheet'`, spreadsheet `1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs`로 고정한다. production generic ingest도 이 registry를 따라 RP031을 sheet collector로 읽는다. **website/API 진단 성공은 아직 production source cutover가 아니다.**
- `check-inventory-source-contract.mts`는 RP006/RP012/RP023은 source kind/location을 별도 assert하지만 RP031은 별도 source intent를 잠그지 않는다. current main CI run `35221347225` green을 RP031 cutover 완료 증거로 쓰면 안 된다.
- Claude 구현 Owner는 website/API↔sheet↔ERP5 Atom을 차량번호 기준으로 대조하고 상태/가격 필드 의미를 확정한 뒤, RP031 registry + collector/production pin + Source Contract assert를 한 promotion으로 전환해야 한다. projection/policy sheet 역할과 재고 canonical 역할은 분리한다.
- audit (31)의 2026-09-17 `event=schedule` 0건은 재조회에서도 그대로이며 schedule-delivery OPEN을 유지한다. audit (23)/(27)/(28)/(29)와 legacy mirror/sales/settlement/RTDB HOLD도 해소 증거가 없다.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit32-ianka-source-migration-hold.md`.

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.
