# 교차검증 판 — 2026-08-31 ERP 전면 재감사

대상 정본: `a466b0aa3fb4ecbb7d08d6e9806e917953b18397` 위 현재 작업 트리와 운영 배포 `dpl_2ZEA2MoMyHLSngbhgS1gJ1PkvLfz`(freepasserp.com, READY).  
목적: 웹 속도, 디자인·기능 규격 통일, 정산 접수 → 실적확인 → 공급사 청구 엔진을 재현 가능한 근거로 재감사한다. 이 문서는 **수정·배포 승인서가 아니다.**

## 독립 검수 현황

| 역할 | 방식 | 판정 | 근거 |
|---|---|---|---|
| Codex | 원본 코드·운영 배포·정적 게이트·정산 시뮬 | 아래 판정 | `check:tokens`, `check:ui`, `check:design`, `typecheck`, `check:release`, `check-provider-gate`, `sim-e2e-settlement`, `sim-settlement-issuance` |
| Cursor | 읽기 전용 plan 검수 | 일부 위험 확인 | `SheetView.tsx` 가상화 선택 행 범위, 하단 탭 치수 예외; 카드 지연 로드와 `contentVisibility`는 통과 |
| Gemini | 읽기 전용 plan 검수 | Finder 데이터 결합 위험 지적, 정산의 클라이언트 관문 지적은 재현으로 반박 | 실제 POST `app/api/settlement/invoice/route.ts` 280~296행의 서버 관문을 재확인 |
| Claude | 읽기 전용 실행 시도 | **미완료** | 계정 주간 한도(9/1 13:00 KST 재개)로 새 검수를 받지 못했다. 기존 `docs/crosscheck/클로드.md`의 정산 잔여위험은 원본에서 재대조했지만, 오늘의 독립 승인으로 대체하지 않는다. |

따라서 이 감사는 발견·우선순위 설정에는 사용할 수 있으나, 돈·정산 규칙 변경이나 운영 배포의 4역할 합격으로 선언하지 않는다.

## Codex 판정

| 번호 | 영역 | 판정 | 원본·재현 근거 | 다음 조치 |
|---|---|---|---|---|
| P1-1 | 속도 | **맞음 — 초기 체감의 가장 큰 남은 병목** | `features/finder/finder-data-store.ts` 76~91행이 Finder 첫 진입에 상품 전체와 파트너 전체를 함께 `list()`하고, `useFinderResults.ts` 78~102·104~168행이 같은 전체 배열을 여러 번 집계·필터·정렬한다. 72/32개씩 보이게 한 것은 렌더량만 줄인다. | 검색/필터에 필요한 인덱스·페이지 API를 먼저 설계하고, 서버 필터·커서 페이지네이션으로 옮긴다. 원본 판매시트/ERP 계약은 별도 유지한다. |
| P1-2 | 속도 측정 | **맞음 — 실제 사용자의 느림은 아직 수치로 확정 못함** | 운영 배포 READY, 최근 24시간 오류 로그 0. Vercel Speed Insights는 프로젝트 설정상 `hasData: false`다. | Web Vitals/RUM을 켜고 `/finder`의 LCP·INP·API 응답·행 수를 같은 화면에서 수집한 뒤 예산을 정한다. |
| P1-3 | 규격 관리 | **틀림 — 도면/실물이 1건 불일치** | `npm run check:building`이 `features/finder/FinderResults.tsx`가 `docs/건물도면.md` 부속실에 누락됐다고 실패했다. 반면 tokens/UI/design/typecheck는 통과했다. | `FinderResults`를 로비동 부속실로 도면에 등록하고 검사 0건을 복구한다. 기능 변경과 섞지 않는다. |
| P1-4 | 기능·엔진 | **열려 있음 — 실적확인 증적이 건수만 고정** | `lib/domain/settlement-confirm.ts` 116~132행은 `nowLines > c.lines`만 재확인 사유로 사용한다. 같은 건수에서 차량·수수료·금액이 바뀌는 경우는 현재 증적으로 잡지 못한다. | 계약/차량/금액 스냅샷의 재확인 기준은 금전 규칙 변경이므로 대표 승인 후 별도 설계·시뮬부터 한다. |
| P1-5 | 엔진 고도화 | **열려 있음 — 정산 원장은 아직 Sheets, v4는 확인·발행 오버레이** | 기존 원본 대조 `docs/crosscheck/클로드.md`; 현재 `invoice` 관문은 RTDB지만 접수·원장 저장소 이관은 아니다. | 이관 여부와 쓰기 단일주체를 결정한 뒤, 마이그레이션/롤백/원본대조 계획을 별도 승인받는다. |
| P2-1 | 긴 목록 | **맞음 — 카드 목록은 진짜 가상화가 아님** | `FinderResults.tsx` 64~76·107~130행은 자동 추가와 `contentVisibility`를 쓰지만, 스크롤한 카드는 DOM에서 제거하지 않는다. | P1-1 이후에도 대량 스크롤이 문제면 windowed list를 도입한다. |
| P2-2 | 시트뷰 | **조건부 위험** | Cursor가 `SheetView.tsx` 542~553행의 멀리 떨어진 active cell이 render 범위를 넓힐 수 있음을 지적. 실제 행 수/키보드 재현은 아직 없다. 하단 탭 37px은 도면에 명시된 시트 레일 예외다. | 대형 탭·키보드 이동 프로파일링 후, active cell을 scroll-into-view하고 가상 범위를 분리할지 결정한다. |

## 이미 합격한 것

- 공통 토큰·UI 계약·확정 카드 디자인·타입 검사: 모두 PASS.
- 판매시트는 처음 연 탭만 가져오도록 되어 있어, 이전의 전 탭 동시 preload 병목은 제거됐다 (`SheetView.tsx` 458~460행).
- 카드 번들은 보기 전환 때만 지연 로드하고, 오프스크린 카드에는 `contentVisibility`가 적용된다 (`FinderResults.tsx` 10~13, 110~125행).
- 공급사 청구는 UI만이 아니라 서버 POST가 원장을 재조회해 `providerBillGate()`를 통과하지 못하면 409로 차단한다 (`invoice/route.ts` 280~296행). 코드 우선·애매한 이름 매칭 차단은 `check-provider-gate` 전 케이스 PASS, 3자 E2E 22/22, 발행 15/15 PASS로 재현했다.

## 실행 순서 제안

1. **안전한 즉시 정리:** 도면 1건을 등록하고 UI/정적 게이트를 다시 0으로 만든다.
2. **속도 1차:** 실사용 Web Vitals를 수집하고, Finder 상품/파트너 전체 로드의 응답 크기·파싱·필터 시간을 계측한다.
3. **속도 2차:** 수치가 확인되면 Finder 검색 결과를 서버 페이지네이션·얇은 목록 DTO로 바꾼다. 이후 필요하면 카드 true virtualization을 한다.
4. **엔진:** 확인 증적을 금액/차량까지 고정할지, 정산 원장을 ERP 저장소로 이관할지 각각 대표 승인 후 별도 설계한다.

## 보류·불일치 해소

- Gemini의 “청구 관문이 클라이언트에만 있다”는 지적은 현재 원본 POST와 직접 시뮬이 반박하므로 **틀림**으로 해소했다.
- Claude의 오늘 독립 검수는 한도 때문에 미완료다. 새 규칙 변경·운영 배포 전에는 재개 후 Claude 검수를 다시 받아야 한다.
- `check:release`는 차단 0건, 약관 재동의 OFF와 서비스워커 부재 경고 2건이다. 이번 Finder/정산 속도 범위의 배포 차단은 아니지만 출시 정책에서는 별도 결정이 필요하다.
