# FreePassERP.com — CI 경계 검증 후속 기록

- 일자: 2026-09-25 (KST)
- PR: #496, Draft 유지
- 선행 기록: `2026-09-25-freepasserp-public-value-validation.md`
- 범위: 공통 화이트라벨 검증기. 활성 데이터 공급원, F01/F86, 원천 데이터, UI 디자인은 변경하지 않는다.

## 실제 재실행 결과와 검증기의 구조 불일치 수정

후속 HEAD `b3108b364a65e5ab97fea3954eca3a273d1de300`의 CI run `36118613809`,
job `108018503043`에서 전체 Typecheck, 폰트 토큰, 디자인 토큰, 격자 검사,
확정 디자인 검사가 통과했다. 앞선 타입 오류 4건은 해소되었다.
이후 Stability Lock에서 정확히 2건이 실패했다.

1. Guest Listing에 구체적 ERP5 reader 이름이 직접 있어야 한다는 옛 검사는 승인된
   `readFreepassCatalog` facade 도입과 맞지 않았다. 이제 Guest Listing → facade →
   현재 ERP5 reader 연결을 함께 확인한다. 활성 공급원을 바꾸지는 않는다.
2. 원문 전체에서 `await observe...`를 금지한 정규식은 응답 후 실행되는
   `after(async () => { ... await observe... })`도 잘못 막았다.
   TypeScript AST로 실제 next/server after import, observer import, callback 안/밖의
   호출 위치를 검사한다. 주석이나 다른 모듈의 after만으로 통과하지 않는다.

`sim-freepass-shadow-boundary.mts`의 11개 정상/반례가 로컬 strict 컴파일 및 실행에서
PASS했다. 직접 await, fire-and-forget, after의 즉시 평가 인수, 정상 지연 호출과
직접 호출을 섞은 경우는 모두 거부한다. 기존 `check:erp4-main`에서 이 회귀도 실행한다.
기존 UI/가격/인증 검사를 삭제하거나 통과 기준을 완화하지 않았다.
이는 현재 명시적 inline callback 패턴의 정적 회귀검사이며 전체 프로그램 제어흐름 증명은 아니다.
이 수정 이후 최종 CI 상태는 PR에 남긴다. 브라우저/실데이터 parity 및 독립 검증은 별도다.
