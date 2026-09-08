# RTDB 제거 현황 (2026-09-04)

> 사장님 「rtdb 없애라 · 문제 없게끔」. 비용(월 30만원)은 **1단계로 이미 끊겼다.** store 완전 삭제는 여러 층짜리 마이그레이션.

## 왜 «비용»과 «store 삭제»가 다른가
- RTDB 비용의 큰 몫 = **파인더가 RTDB 노드를 통째로 스트리밍하는 읽기.**
- 그걸 Firestore 문서구독으로 돌린 것이 **1단계** — 이걸로 비용은 끊겼다. 파이프라인이 RTDB에 «한 시간에 한 번 쓰는」 건 푼돈.
- store 자체를 지우려면 앱 «전체»(계약·정산·정책·파트너·손님)가 Firestore를 읽고, 파이프라인도 Firestore에 써야 한다.

## ✅ 완료 (1단계 — 비용 컷, 라이브)
- `NEXT_PUBLIC_FINDER_FROM_FIRESTORE=1` 운영 세팅 + 재배포. 파인더가 Firestore 읽음.
- 파인더 3버그(㉠㉡㉢) 수정: 실 UID 뒤 구독 · 실패 시 핸들해제 · RTDB 폴백(절대 안 빔).

## ✅ 완료 (2단계 — 안전 기반, 검증됨. 미배포)
- **격리모델**: 공급사=`provider_company_code` · 영업자=`agent_code`(=`user_code`, 실측 17/18 일치) · admin 전부. companyId(계약)=공급사코드 base.
- **규칙**(`firestore.rules`): 계약·정산을 위 모델로. **에뮬레이터 8/8 통과**(`npm run check:rules`) — 영업자가 남의 계약 못 봄 확인.
- **클레임**(`scripts/set-user-claims.mts`): 108명 apply(role·company·agent_code=user_code·provider_company_code). 전파 최대 1시간.
- **FirestoreAdapter**(`lib/store.ts`): 계약·정산 list/get/update 를 «_key + 역할제약»으로. 복합인덱스(`firestore.indexes.json`).

## ⏳ 남은 것 (store 완전 삭제 — 여러 층, careful)
1. **다른 엔티티 격리** — policy·partner·customer 도 companyId 가 공급사코드/공유(PT-0000)라 영업자에 안 맞음. 각각 규칙·어댑터·인덱스 필요(계약·정산과 같은 패턴). room·message·quote 는 0건(채팅 폐기 예정) → 제외.
2. **인덱스·규칙 배포** — `firebase deploy --only firestore:indexes,firestore:rules` (하네스 게이트 → 사장님).
3. **데이터 신선화** — `shadow-copy-entities-to-firestore` 재실행(스위치 «직전»에 — 미리 하면 다시 낡음).
4. **파이프라인 Firestore 쓰기** — 지금은 RTDB 쓰고 미러. store 를 지우려면 원본을 Firestore 로.
5. **★로그인 통합테스트** — 미리보기에서 «영업자가 자기 계약만, 공급사가 자기 것만» 실제 로그인으로 확인. (에뮬레이터·타입은 통과했으나 실앱 검증은 로그인 필요 → 사장님.)
6. **스위치** — `NEXT_PUBLIC_DATA_BACKEND=firestore` + 재배포(게이트 → 사장님).
7. **RTDB 백업 후 삭제** — `npm run backup:export` → 삭제(되돌릴 수 없음 → 사장님 확인).

## 순서·주의
- ①~⑤ 를 다 마치고 통합테스트가 통과해야 ⑥ 스위치. 무작정 flag 켜면 «영업자가 남의 계약 봄(보안)» 또는 «화면 빔».
- 비용은 이미 잡혀서 서두를 이유 없음. 층마다 검증하며 간다.
