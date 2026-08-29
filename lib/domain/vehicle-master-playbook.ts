/**
 * **차종마스터·코드 — 누가 쓰고, 가져다 쓸 때는 어떻게 맞추나.**
 *
 * ★사장님 2026-08-23 — 「차종마스터 코드는 너만 만진다. 그걸 가져다 쓰는 건 어떤 AI라도 상관없지만
 *   맞추는 값이나 요령은 니가 매뉴얼해놔」.
 *
 * 쓰기(이름 정본·mf- 키 의미) = **커서만**. 다른 AI는 읽기·스냅·fill·stamp 로 적용만.
 * 이 파일은 운영 매뉴얼 0″장과 같다. 요령을 바꾸려면 여기와 매뉴얼을 같이 고친다.
 */
export const VEHICLE_MASTER_OWNER = '커서';

/** 모든 AI 공통. 세 번째 예외를 만들지 마라. 글자를 바꾸면 check-vehicle-master-lock 이 실패한다. */
export const ENCAR_NAME_ABSOLUTE =
  '⛔차종이름=엔카 1:1. 예외 둘만: 기아 N세대→개발코드, 우리 시트만 G80 DH. 세 번째 예외 금지.';

/** 여기 적힌 파일을 고치는 것은 담당(커서)만. 다른 AI는 이슈만 남긴다. */
export const VEHICLE_MASTER_WRITE_ONLY = [
  'public/data/vehicle-trim-master.json', // 시트에서만 생성(generate:vehicle-trim-master --write). 손으로 이름 고치지 말 것
  'data/vehicle-trim-key-registry.json',
  'data/product-vehicle-review-decisions.json',
  'lib/domain/submodel-code.ts',
  'lib/domain/vehicle-master-lock.ts',
  'lib/domain/vehicle-master-playbook.ts',
  '판매시트 「AI 정제」 @세부모델·@모델 정본 매핑',
] as const;

/** 아무 AI나 호출해도 된다 — 값을 새로 만들지 않고 책을 읽는다. */
export const VEHICLE_MASTER_READ_API = [
  'snapToMaster (lib/domain/vehicle-master-match.ts)',
  'fill-supplier-from-encar-sheet — 엔카 작업 시트로 정제칸(키를 안 만든다)',
  'stamp-encar-codes-on-supplier — M/SM/T 만(이름과 같을 때)',
  'pickConfirmedMasterCode — 이미 있는 mf- 를 고른다',
  'check-vehicle-master-lock · verify-master-pass',
] as const;

export type PlaybookRow = [string, string, string];

/** 맞추는 요령 — 다른 AI가 스냅·fill 할 때 이 순서만 따른다. 새 규칙을 만들지 않는다. */
export const VEHICLE_MASTER_MATCH_PLAYBOOK: PlaybookRow[] = [
  ['⛔경고', ENCAR_NAME_ABSOLUTE, 'docs/차종마스터-엔카작업시트-매뉴얼.md · AGENTS.md · CLAUDE.md'],
  ['담당', `쓰기(시트 이름·mf- 키 의미·「AI 정제」 정본 매핑·새 키 발급) = **${VEHICLE_MASTER_OWNER}만**. 이름·제원 작업 정본 = 엔카 작업 시트. 라이브 원장 mf- 에는 아직 안 씀. \`vehicle-master.json\` 은 **폐기**. 다른 AI는 이슈만 남기고 키·이름을 바꾸지 않는다.`, 'vehicle-master-lock · VEHICLE_MASTER_WRITE_ONLY'],
  ['가져다 쓰기', '스냅·fill·stamp·발행은 어떤 AI든 된다. 책은 읽고 칸에 옮기기만 한다. 비슷한 차로 붙이거나 빈 인승·cc를 채우거나 mf- 를 새로 만들지 않는다.', VEHICLE_MASTER_READ_API.join(' · ')],
  ['사전', '작업 정본 = 엔카 작업 시트(차종·제원·배터리 탭). 라이브 원장 mf- 에는 아직 안 씀. vehicle-master.json으로 세부모델을 지어내지 않는다.', 'docs/차종마스터-엔카작업시트-매뉴얼.md'],
  ['세부모델', '엔카와 개수·이름 1:1. 괄호 없음(G80 (RG3) → G80 RG3). 연식종료 2019 이전(NF)은 넣지 않는다.', '엔카 iNav · 7년 창'],
  ['순서', '제조사 안에서만 모델 → 그 모델 안에서만 세부모델 → 그 세부모델 안에서만 세부트림. 한 칸이 안 모이면 그 아래는 안 붙인다. 싼타페 전체에서 Prestige를 고르거나, 현대 전체에서 K5를 고르지 않는다.', 'attachFromEncarSheet'],
  ['하나로만', '원문에 글자가 들어 있고 가장 긴 후보가 하나만. 산타페≠싼타페. 비슷한 철자·오타 보정 금지. 후보가 둘인데 한쪽이 다른 쪽을 포함하지 않으면 빈칸.', 'uniqueLongest'],
  ['예외(이 둘만)', '① 기아만 N세대→개발코드(K5 3세대 → K5 DL3). 엔카에 이미 코드가 있으면 그대로. ② 우리 시트만 제네시스 1세대 G80 DH(엔카는 G80). 그 밖은 엔카 그대로. 티볼리 X100·제네시스 FL 분할·다른 비기아 개발코드는 예외 아님.', 'docs/차종마스터-엔카작업시트-매뉴얼.md'],
  ['엔카에 없는 쪼개기', '제네시스 FL처럼 엔카가 안 나눈 세부모델은 합친다. 같은 트림이면 FL 행을 지우고 기존 행 생산종료를 FL 종료로 이어 붙인다. 배터리 kWh가 다르면 이름만 떼고 행은 둘(팩 둘). kWh를 지어내지 않는다. G80 DH는 예외라 합치지 않는다.', 'docs/차종마스터-엔카작업시트-매뉴얼.md'],
  ['세부트림', '세부모델을 잠근 뒤에만. 그 세부모델에 달린 엔카 트림만(글자 그대로). 배기량으로 쪼개지 않는다. 2.5 세 개 + 3.5에만 있는 하나 = 네 개. 괄호 없음. 등급 이름이 없으면 기본형. 렌터카·택시·장애인용은 트림이 아니다. 5링크·리프처럼 차가 다른 것만 풀어 쓴다.', '합집합 · 파워트레인≠트림'],
  ['제원', '연료·배기량·구동은 제원마스터 허용값. 차종 행을 cc마다 쪼개지 않는다. 인승은 원문이 하나로 모일 때만.', '제원마스터 탭'],
  ['배터리', '전기만 전기차배터리마스터. 세부모델별 공식 kWh. 팩이 둘이면 행 둘. 화이트리스트로 아무 kWh나 고르지 않는다.', '전기차배터리마스터 탭'],
  ['개발코드', '엔카에 이미 있으면 그대로. 우리가 새로 붙이는 것은 예외 둘뿐(기아 N세대, 우리 시트 G80 DH). 「손님이 읽기 어렵다」로 이름을 깎지 않는다.', 'ai-refine-guard · K5 DL3 · G80 DH'],
  ['트림 글자', '합친 뒤의 트림 이름. 등급어 한글화는 엔카가 영문일 때만. H-PICK·N Line·GT-Line은 한글화 금지.', 'LATIN_BRAND_TRIM_CANON'],
  ['공급사 원문', '정보는 차량번호 왼쪽(제조사·차종·차명·연료·연식). 배기량 칸 숫자가 차명과 달라도 차명이 이긴다.', '281노9792 · 101호5187'],
  ['이름 vs 제원', '모델까지 모이면 연료·cc·구동은 붙여도 된다. 세부트림은 세부모델 잠긴 뒤에만. 배터리는 세부모델+전기만. HEV를 전기로 바꾸지 않는다.', 'attachSpecs · packKwh'],
  ['정제칸', '칸마다 따로. 빈 칸은 채우고 작업 시트와 다르면 바로잡는다. 안 모이면 안 건드린다. fill은 차량번호 왼쪽 원문을 따른다 — 제보로 고친 트림도 원문이 옛 글자면 되돌린다(리더스 125호1238).', 'fill-supplier-from-encar-sheet'],
  ['모르면 빈칸', '엔카·시트에 없으면 비슷한 차로 안 붙인다. 트림 후보가 여럿이면 차종코드를 안 박는다(PARTIAL).', ''],
  ['검증', '구글 시트 원본을 연다. 자기 도구 출력 재인용은 검증이 아니다. 교차검증은 다른 AI. 쓰기 뒤: 작업 시트 FL·예외 둘 재조회 → fill dry-run(반영분이 줄어야) → 판매시트·ERP는 별도 발행 전.', 'audit-encar-work-sheet · fill-supplier-from-encar-sheet · audit-encar-work-vs-sheets'],
  ['키 의미', 'mf- 한 줄의 뜻은 **레지스트리**. 삭제·재사용 금지. 트림 매칭과 코드(연료·cc 갈림)는 다른 층이다.', 'vehicle-trim-key-registry.json'],
  ['새 차종', '엔카에 맞춰 작업 시트에 먼저 넣는다 → 승인 후 정제시트 fill → 확정되면 라이브 원장. 로컬 json으로 이름을 만들지 않는다. 작업 시트에서 JSON을 생성·비교하지 않는다.', '엔카 작업 시트'],
];
