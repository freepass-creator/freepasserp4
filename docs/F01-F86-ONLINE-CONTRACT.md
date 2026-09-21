# F01/F86 온라인 표시 규격 연결

사용자 2026-09-21 최종 규격: `MM.DD HH:mm 상품리스트 N대`, `손오공상품 N대`, `픽업구독 N대`, `오플구독 N대`. 공급사도 `회사명 N대`. 날짜는 상품리스트에만 앞에 붙고 가운데점/축약명/별도 오공구독 탭은 없다.

정본은 freepass-data `contracts/f01-f86-sheet-spec.v1.json`이다. 이 엔진은 `vendor/freepass-data/manifest.json`의 정확한 upstream commit과 SHA256으로 고정한 사본을 소비한다. 사본에서 규칙을 바꾸지 말고 upstream 정본을 수정한 뒤 함께 갱신한다. 서식 스킨 이후 공통 표시 규격을 적용한다.

F01/F86 발행은 기존 production write gate와 기존 workflow concurrency 안에서 수행한다. F01 표준/F86 레트로, 셀 값·상품 분류 경로를 유지한다. 새 분류, 원자 수정, 원천 유입 경로는 이 변경의 범위가 아니다. 기본 네 탭은 안정된 sheetId를 필수로 요구하며 누락/중복/폐기 탭은 HOLD한다. 숨김 관리 탭은 자동 정리에서 제외한다.

발행 후 `verifyPublishedPresentation`은 같은 upstream collector와 planner로 실제 Sheets를 재조회한다. 이름/순서/대수/색/260·360px 원문 열/전체 필터/고정 머리행/F86 단기 숨김을 검사한다. 원문 값과 의미의 정합성은 기존 atom 대조가 별도로 담당한다. 이 모듈은 새 writer가 아니라 기존 writer의 출력 규격 및 readback gate다.

온라인 발행의 문패 시각은 기존 동일 회차 snapshot.capturedAt을 사용한다. 이는 원천 전체의 최신성이나 발행 완료 시각을 보증하지 않는다. 수동 표시 전용 갱신은 명시한 updatedAt을 사용한다.

`scripts/audit-sheet-presentation-online.mts`는 GET만 허용하며 운영 DB·발행 코드를 불러오지 않는다. 기존 문패의 시각을 유지한 채 동일 규격을 읽기 전용으로 검증한다. raw grid와 인증정보는 로그에 출력하지 않는다.

검증: data 측 검사20개 및 기존58개 PASS. 엔진 typecheck, check:sync, 공급사 registry PASS. 새 parity simulation은 양쪽 발행 서식 결과를 upstream planner로 검사하여 요청0개를 요구한다. Cursor 독립 검토에서 희소 셀 응답 정규화를 보완했다. 알 수 없는 열 너비는 추정하지 않고 HOLD한다. 자동 rollback은 동시 수동 편집을 덮을 수 있어 하지 않는다. Sheets의 마지막 조회와 쓰기 사이에 원자적 compare-and-swap은 제공하지 못한다.

Claude는 weekly limit, Gemini는 계정 서비스403으로 검토 불가였다. 이들은 PASS가 아니다. 운영 pin 전환, 실제 온라인 readback, 필수 독립 검증이 남아 있으면 운영 자동화 완료로 보고하지 않는다. PR454의 이전 축약 이름/180·320px 규격은 이 규격과 충돌하므로 함께 병합하지 않는다.
