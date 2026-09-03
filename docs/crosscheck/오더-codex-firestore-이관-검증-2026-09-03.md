# 코덱스 오더 — Firestore 이관·상태디테일·차종마스터 전수검증 (2026-09-03)

> 설계·구현: Claude · **검사: Codex** · 고치는 것은 Codex 가 아니다
> 근거: CLAUDE.md 「협업 파이프라인」 — 「코덱스 = 검사만. 어긋난 것을 보고하면 내가 고친다」

## 무엇을 (한 문장)

이번 세션이 «재고를 Firestore 로 옮기고 · 상태를 4필드로 나누고 · 기아 단세대 코드를 뗀」 것이
**사용자 원래 요구와 어긋나지 않는지**를 독립으로 다시 세어 보고한다.

## 고치지 않는다

**파일을 하나도 바꾸지 않는다.** 어긋난 것을 찾으면 «무엇이 몇 건 어떻게 어긋났는지»만 적는다.
고치고 싶어지면 그 자리에서 멈추고 보고한다.

## 사용자 원래 요구 (= 검증 기준, 내 설계 아님)

1. 재고는 Firestore, 상태값만 실시간(비용 절감). 차량번호가 곧 문서키.
2. **차번은 유일** — 원자에 같은 번호 2개 불가, 겹치면 오류.
3. 세부모델·세부트림은 **차종마스터에서만** 조합, 생성·계층이탈 금지.
4. 기아 **단세대는 엔카 코드 없음**(K8·EV6), **다세대는 코드 유지**(K5 3세대→K5 DL3).
5. **출고불가만 뺀다** (그 밖은 다 올린다 = listable).
6. 공급사 **원가·수수료 노출 금지**.

## 어떻게 — 일곱을 각각 «따로» 센다 (숫자만 비교하지 말고 «어느 차/어느 파일」까지)

### ① 차번 유일 (요구 2)
`products/{차번}` 컬렉션에서 car_number 중복 0 인지 독립 집계. RTDB v4/products 차번수 ↔ Firestore 문서수 대조.
겹치면 그 차번을 찍는다.

### ② 기아 코드 규칙 (요구 4) — «다세대를 안 건드렸나»가 핵심
- `public/data/vehicle-master.json`·`vehicle-trim-master.json`·`master-aliases.json` 의 **sub_model 필드**에
  K8 GL3·EV6 CV1·레이 TAM·모하비 HM·스팅어 CK 잔존 = **0** 이어야 한다.
- ⚠ **역방향도 본다** — K5 DL3·K7 YG·쏘렌토 UM·K3 BD·K9 RJ·니로 SG2 같은 «다세대 코드»가
  **살아 있어야** 한다(잘못 지웠으면 사고). 기준 = 모델당 distinct gen_code ≥ 2 면 다세대.
- Firestore 상품에서 세부모델이 마스터 계층(제조사|모델|세부모델)에 실재하는지 전수(계층이탈=요구 3 위반).

### ③ 원가·수수료 격리 (요구 6)
Firestore `products` 어느 문서에도 **fee·commission·fee_memo·vehicle_price·vin·account_number** 가
없어야 한다. price 는 deposit·rent 만.

### ④ 상태 4필드 일관성 (상태 디테일)
status·status_kind·status_reason·listable 이 서로 모순 없나:
- status_kind=='불가' ⇔ listable==false ⇔ status=='출고불가'.
- listable 합계 == 출고불가 아닌 수 == 727 (요구 5).
- 빈 상태는 '차량검수' 로 정규화됐나.

### ⑤ 파인더 읽기 전환 — 가시성·원가 패리티
`lib/firebase/firestore-products-client.ts` 의 `shapeFinderRows` 가 `RtdbAdapter.listForFinder` 와
**같은 가공**인지: isExcludedProduct 제외 · dedupeProductsByVehicle · canSeeProductCost/stripProductCost.
그리고 플래그(`NEXT_PUBLIC_FINDER_FROM_FIRESTORE`) 미설정이면 RTDB 경로 그대로(운영 무변경)인지.

### ⑥ Firestore 규칙 노출 (보안)
`firestore.rules` 의 `products` 는 read=signedIn·write=false 인지. 컬렉션 오탈(단수 product 와 혼동) 없나.
로그인 사용자에게 과다 노출되는 필드 없나(③과 연결).

### ⑦ 빌드·타입·파이프라인 안전
- `npx tsc --noEmit` = 0.
- `scripts/hourly-sync.mts` ⑭ 미러·⑮ 검증이 **best-effort** 인가 — 실패해도 `stop()` 안 하고 경고만,
  `--apply` 아닐 때 안 도는가. 시트·ERP 를 안 건드리는가.

## 완료조건 (pass = 아래가 전부 참)

| 대상 | 기대 |
|---|---|
| tsc --noEmit | 오류 0 |
| 차번중복(Firestore) | 0 |
| 기아 단세대 코드 잔존(마스터 3파일 sub_model) | 0 |
| 다세대 코드 살아있음(K5 DL3 등) | 유지(잘못 지운 것 0) |
| Firestore private 필드(fee/commission/vehicle_price/vin/account_number) | 0 |
| 계층이탈 상품 | 0 |
| listable == 출고불가 아닌 수 | 일치(≈727) |
| status_kind/listable/status 모순 | 0 |

어긋나면 **어느 항목·몇 건·어느 차/파일**인지 적어 보고한다. Codex 는 고치지 않는다 — 내가 고친다.

## 참고 (읽어두면 빠름)

- 커밋: refine-atoms / sync-variable / mirror-to-firestore / firestore-products-client + finder-data-store /
  firestore.rules+firebase.json / apply-kia-single-gen-codes / detect-atom-changes / hourly-sync ⑭⑮ / 상태 4필드.
- 미러 정본 = `scripts/mirror-to-firestore.mts` (refine+variable 한 방). 규칙 = `docs/차종명명-정제-매뉴얼.md §1`.
- Codex 가 이미 낸 의견: `docs/crosscheck/CODEX-FIRESTORE-이관-의견-2026-09-03.md` — 그 지적이 반영됐는지도 같이 본다.
