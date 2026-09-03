# Codex 독립 검수 의견 — Firestore 차량 이관

기준 시각: 2026-09-03 KST. 이 문서는 읽기 전용 대조 결과이며, 운영 데이터·시트·규칙·배포를 변경하지 않았다.

## 판정: 전환 NO-GO

Firestore로의 데이터 복사는 진행됐으나, 재고관리의 Firestore 읽기 전환과 RTDB 비용 절감 완료를 선언할 수 있는 상태는 아니다.

## 확인 결과

- RTDB `v4/products` 활성 차량은 1,227대, Firestore `products`는 1,223건이다.
- Firestore에 없는 RTDB 출고가능 차량은 4대다: `154어1411`, `154어1434`, `05수4658`, `35서5793`.
- 같은 차번 1,223대 대조에서 RTDB 대비 Firestore 값 차이는 `vehicle_status` 3대, `price` 2대, `mileage` 1대, `photo_link` 3대다.
- 이름 축도 RTDB 대비 Firestore 값 차이가 있다: 제조사 86대, 모델 65대, 세부모델 272대, 세부트림 190대.
- 공급사 원본 → 정제시트 상태 감사(아이카·오토플러스·이안카·아이언 범위)에서 실제 갈림은 7대다. 아이카 3대는 `출고협의 → 출고불가`, 오토플러스 4대는 `출고가능 → 출고불가`다. 판매시트에 없으나 계약중으로 하류에 남은 4대는 정상 예외로 분리한다.
- Production Vercel 환경에는 `NEXT_PUBLIC_FINDER_FROM_FIRESTORE`가 없어 재고관리 화면은 아직 RTDB를 읽는다. 이는 현재 상태에서는 안전한 기본값이다.

## 차단 사유

`scripts/refine-atoms-to-firestore.mts` 및 `scripts/mirror-to-firestore.mts`가 로컬 `public/data/vehicle-master.json`과 `snapToMaster`로 원문/기존 값을 다시 치유·정규화한다. 현재 확정 규칙인 「정제칸 이름 = 지금 원문 철자 + 라이브 마스터 세대」「하류에서 추정·치환 금지」와 충돌한다. 특히 `세부모델 교정`은 Firestore에서만 이름 축을 바꿔 판매시트·원본과 화면을 갈라 놓을 수 있다.

## 수정 완료 조건

1. 이름 축은 중앙 판매시트의 정제값과 원문을 그대로 복사한다. 로컬 마스터 재스냅·자동 치유는 제거하거나 검수대기로 fail-closed 한다.
2. Firestore와 RTDB의 차량 집합, 상태, 대여료/보증금, 주행거리, 사진, 공급사, 상품코드, 이름 4축을 대조해 차이 0을 만든다. 4대 누락도 원인 확인 후 정상 경로에서만 반영한다.
3. 공급사 원본 → 정제시트의 상태 갈림 7대는 원본 재조회 후 정제 경로에서 해소하거나 명시적 정상 예외로 기록한다.
4. 판매시트 → Firestore 직접 대조기를 추가해, RTDB를 중간 정본으로 삼지 않는다.
5. 위 대조가 모두 통과하고 Firestore Rules·서버 조회 경로를 별도 검수한 뒤에만 Production의 `NEXT_PUBLIC_FINDER_FROM_FIRESTORE=1` 전환을 검토한다.

