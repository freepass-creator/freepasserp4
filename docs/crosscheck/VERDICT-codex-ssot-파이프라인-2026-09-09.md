# CODEX 의견 — SSOT 파이프라인 (트림·전파·상태·계약우선) 2026-09-09

사장님 「SSOT 명확히 · 한 곳에서 받고 한 곳에서 나간다」 작업의 코덱스 독립검증.
검증=코덱스(검사만) · 수정=클로드. 판정 근거는 파일:줄. 원자 실측 = `npm run check:invariants`.

## 1단계 — 세부트림 = 마스터 복사 or 공란 (커밋 70628319)
- 규칙: 트림은 마스터 복사 아니면 공란(지어내기 금지). `clean-trim.ts` 추출·「기본형」 폴백 폐기.
  수집기(`ingest-supplier`·`ingest-aica`) cleanTrim 경유 · `hourly-sync ⑭¾` clean-atom-trims 정규화.
- 실측: 마스터밖 트림 위반 **276 → 2**, 오염 0.

## 2단계 — 정본 전파 자동화 (커밋 575a7b14 · 9e37c2a7)
**코덱스 판정: 순서 역전 없음. 「높음」 결함 1(고침).**
- ⓪⅗ export 가 ①(첫 JSON 소비)보다 앞 — 재현상 역전 경로 없음.
- [높음] export 실패 + 기존 JSON 부재·손상이 겹치면 ①은 마스터 없이 진행, ①′는 크래시. 「지난 완본으로 안전」이
  완본이 유효할 때만 참. ⇒ **고침**: ⓪⅗′ 유효성 게이트(있고·파싱되고·entries≥1 아니면 stop).
- [낮음] 매 회차 1816 doc 읽기(달러 미미, 무료쿼터 공유). 배포 앱 carmaster(1h 캐시)는 로컬 export 안 닿음(㉠ 몫).
- ★부수: 회차 끝 미정의 `건너뜀` → ReferenceError(락 미해제 14h). steps 에서 뽑게 고침.

## 3단계 — 상태 판정 한 함수 resolveStatus (커밋 96b5d0e6 · 3bd1c46c)
**코덱스 판정: 대체로 충실. 미세 회귀 1(고침).**
- mirror·ingest·heal 이 `lib/domain/atom-status.ts resolveStatus` 하나만 씀(8케이스 대조 동일).
- [미세] mirror 원래 `S(locked)` truthy 였는데 `input.locked` 원값 truthy 로 바뀌어 엣지값에서 reason 만 달라짐 → `S()`로 되돌림.
- heal 은 status_label_raw·reason 안 덮게 골라 씀(원천 표기 보존).

## 계약 우선(정산원장 맨 먼저) (커밋 e8b0af17 · 837ccab5)
**코덱스 판정: FAIL — 이것만으론 「판 차가 다시 선다」를 완전히는 못 막음. 방향은 사장님 우선순위와 일치.**
- 넣은 것: locked 있으면 공급사 「출고가능」이 못 덮음(완료=숨김·아니면 계약중). heal 도 락 존중(clobber 복구).
- 남은 «기존» 결함(정산 도메인·컷오버와 얽힘 — 이 파이프라인만으론 못 닫음):
  ① 수집 레이스: ingest 가 pin 읽은 뒤 계약이 올라가면 그 회차는 락을 못 봄.
  ② 락 저장소 갈림: 락이 RTDB(앱 flag=rtdb)·Firestore(mark-contract) 양쪽 — 한 곳으로 모아야(RTDB 컷오버).
  ③ 정산엔진 취소경로 `settlement-engine.ts:277`: 상태가 계약중/출고불가일 때만 락 해제 → clobber 뒤 취소면 갇힘.
- ⇒ 우선순위 일치(판 차 재노출 < 팔 차 잠깐 숨김). airtight 는 정산세션 + 컷오버 조율 필요.

## 관통 결론
freepass SSOT 엔진·게이트는 freepass 안에 자체적으로 있다 — `check:invariants`(원자 불변식) · `check:publish-atom`(발행이
원자에서만 읽나=한 곳에서 나간다) · `check:atoms` · `check:sync` · hourly-sync. aiops `ssot-geomsa`(재무 SSOT)와 분리됨.
airtight 상태(계약 우선)는 RTDB→Firestore 컷오버가 끝나 락이 한 곳(Firestore)에 모여야 완성된다.
