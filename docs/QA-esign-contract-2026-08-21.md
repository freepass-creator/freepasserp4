# 전자계약·계약서 기능검수 요청 (Claude → Codex)

작성 2026-08-21 · 대상 커밋 `2a818655` … `d9100200` (5개)
브랜치 `feat/sales-sheet-manual` · **푸시 완료 · 배포 안 함**

---

## 1. 무엇을 고쳤나

| 커밋 | 요지 |
|---|---|
| `2a818655` | 계약서 규격을 ERP 토큰에 맞춤 · 약관 단 채우기 · 02 차량표·보증금표 재설계 |
| `8cf14ae2` | 세로 간격 사다리 · 표지 요지 lucide 아이콘 · 새 칸 배선 |
| `2eef7498` | 차량가액·차량 비고를 발송 화면에서 입력 |
| `b6ba3c06` | 필수값 확정 · ERP 차량 골라도 차량번호·차종 수정 가능 |
| `d9100200` | 안 적으면 ERP 값이 나간다는 것을 자리표시로 표시 |

만진 파일 5개
```
public/contract-template/rental-contract.html
lib/domain/esign-field-map.ts
lib/domain/esign-template-fields.ts
lib/domain/esign-center.ts
components/EsignSendCenter.tsx
```

---

## 2. 검수해 주셨으면 하는 것 — 기능 위주

정적 검사(sim·drift)는 전부 통과했습니다. **실제로 돌려봐야 아는 것**만 남았습니다.

### ① 발송 왕복 — 신차 (차량번호 없는 계약)

가장 크게 바뀐 경로입니다.

1. ERP 차량을 **고르지 않고** 「차량 직접입력」으로 차명만 입력
2. 차량번호에 `미정` 입력
3. 대여기간·월 대여료·보증금 입력 (보증금은 `0` 으로 시험)
4. 「링크 만들기」가 활성화되는가
5. 발송 후 봉인본에 차명·「미정」·0원이 그대로 찍히는가

> 전에는 `erp_product` BLOCK 이 항상 걸려 **신차 계약 자체를 못 보냈습니다.**
> 이번에 차명이 있으면 통과하도록 바꿨는데, 실제 발송까지 도는지 확인이 필요합니다.

### ② 발송 왕복 — 중고 (ERP 차량 선택)

1. ERP 차량 선택 → 차량번호·차종이 **채워진 채로 뜨는가**
2. 그 자리에서 **차량번호를 고칠 수 있는가** (전에는 칸이 사라졌습니다)
3. 고친 값이 봉인본에 반영되는가
4. **아무것도 안 고치면** ERP 값 그대로 나가는가

### ③ 새 칸 4개가 실제로 찍히는가

| 칸 | 필드 | 출처 |
|---|---|---|
| 차량가액 | `contract_vehicle_price` | 수기 (발송 화면) |
| 차량 비고 | `vehicle_remark` | 수기 (발송 화면) |
| 상품구분 | `vehicle_condition_type` · `vehicle_classification` | 재고 `product_type` 에서 가름 |
| 구동방식·승차정원 | `drive_type` · `seats` | 재고 |

> `product_type` 이 `픽업구독` 인 차로도 한 번 봐 주세요 — 「중고차 · 구독서비스」로 나와야 합니다.

### ④ 보증금 분납

회차 칸(1·2·3회차)을 걷어내고 **총액 · 횟수 · 방식** 셋으로 바꿨습니다.

- 일시납 → 「1회 / 일시납」
- 4회 분납 → 「4회 / 매회 분납비율대로 분할」 (전에는 4회 이상을 아예 못 적었습니다)

### ⑤ 인쇄 (PDF)

화면은 봤는데 **실제 인쇄는 안 봤습니다.**

- A4 PDF 로 뽑아 17장인지, 잘리는 장이 없는지
- 약관 3장의 단 하단이 차 있는지
- 표지 아이콘 4개가 인쇄에서도 나오는지

---

## 3. 깨면 안 되는 규칙

계약서 서식을 고칠 일이 있으면 이것만 지켜 주세요. 전부 실측으로 잡은 것들이라, 되돌리면 같은 증상이 다시 납니다.

1. **글자 크기는 `:root` 의 `--fs-*` 9개만** 쓴다. ERP `tokens.ts FS` 에서 인쇄용으로 한 단(−1px) 내린 값이다
2. **라운드는 `--radius`(4) · `--radius-card`(8) 둘뿐** — 칩 전용 3px 같은 걸 새로 만들지 않는다
3. **표는 전부 「머리띠 + 카드」** — 장별 override 를 다시 넣지 않는다 (예전에 칸 여백이 6/5/3.5px 세 갈래였다)
4. **`.rhead` 의 여백을 장마다 바꾸지 않는다** — 문서의 시작선이다. 약관 장만 2mm 로 줄인 적이 있는데, 빼도 17장 유지된다
5. **인라인 색으로 글자 크기를 바꾸지 않는다** — `[style*="color:var(--mute)"]` 규칙이 표 칸을 몰래 줄였다. 부연은 `.dim` 클래스로
6. **`data-accent` 는 속성 맨 뒤에** — `class="section" data-contract-option="…"` 이 붙어 있어야 `sim-esign-document-boundary` 가 통과한다
7. **약관 조문 참조는 「제17조 및 제18조」** — 「제17조·제18조」 같은 축약은 sim 이 막는다. **주석에 써도 걸린다**
8. **차량가액에 재고 `vehicle_price` 를 쓰지 않는다** — 그건 관리자 전용 원가이고, 전자계약 쪽 같은 이름 필드는 실제로 기간별 대여료 표다
9. **새 `data-field` 를 만들면 `FIELD_MAP` 에 등록**한다. 안 하면 `sim-esign-field-map` 이 깨진다
10. **발송 화면에서 받는 값은 `ISSUE_INPUT_FIELDS` 에 넣는다.** 여기 빠지면 입력해도 **말없이 버려진다** (실제로 그래서 한 번 놓쳤다)

---

## 4. 확인 명령

```bash
npx tsx scripts/sim-esign-agreement.mts
npx tsx scripts/sim-esign-document-boundary.mts
npx tsx scripts/sim-esign-field-map.mts
npx tsx scripts/sim-esign-draft-gate.mts
npx tsx scripts/audit-contract-fields.mts
npm run check:template-drift
```

서식을 눈으로 볼 때는 **반드시 서버로** 열어 주세요.
```
http://localhost:4004/contract-template/rental-contract.html?embed=1
```
> 파일(`file:///…`)로 열면 폰트 경로가 `/fonts/…` 절대경로라 **Pretendard 가 안 붙고** 맑은 고딕으로 보입니다. 그 상태로 폰트를 고치면 엉뚱한 데를 만지게 됩니다.

---

## 5. 안 한 것 (검수 대상 아님)

- **사고다발 계약해지** — 코덱스 담당. `accident_termination_total_count` 는 `FIELD_MAP` 등록만 해뒀습니다(안 하면 sim 이 깨져서)
- **부속서류 빈칸** — 인수증 12칸 · 연대보증 8칸 · 개인사업자 세금계산서 7칸. 인도 시점 정보라 계약 발송 시점엔 존재할 수 없는 것이 섞여 있어, 「손으로 쓰는 서식으로 둘지 / ERP 입력을 붙일지」 결정이 먼저입니다
- **배포** — `main` 이 162+ 커밋 뒤라 밀면 다른 세션 작업까지 통째로 나갑니다
- **커밋 안 된 50개 파일** — 커서·코덱스 작업분이라 손대지 않았습니다. `app/sign/[token]/sign.module.css` 가 **삭제** 상태인데 의도인지 확인이 필요합니다
