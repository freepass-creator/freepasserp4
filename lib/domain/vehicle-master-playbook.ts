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

/** 여기 적힌 파일을 고치는 것은 담당(커서)만. 다른 AI는 이슈만 남긴다. */
export const VEHICLE_MASTER_WRITE_ONLY = [
  'public/data/vehicle-master.json',
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
  'fill-supplier-ai-columns — 정제칸에 책 글자를 박는다(키를 안 만든다)',
  'stamp-encar-codes-on-supplier — M/SM/T 만(이름과 같을 때)',
  'pickConfirmedMasterCode — 이미 있는 mf- 를 고른다',
  'check-vehicle-master-lock · verify-master-pass',
] as const;

export type PlaybookRow = [string, string, string];

/** 맞추는 요령 — 다른 AI가 스냅·fill 할 때 이 순서만 따른다. 새 규칙을 만들지 않는다. */
export const VEHICLE_MASTER_MATCH_PLAYBOOK: PlaybookRow[] = [
  ['담당', `쓰기(json 이름·aliases·mf- 키 의미·「AI 정제」 정본 매핑·새 키 발급) = **${VEHICLE_MASTER_OWNER}만**. 라이브 원장 「차종마스터」 탭은 누구든 쓰지 않는다. 다른 AI는 이슈만 남기고 키·이름을 바꾸지 않는다.`, 'vehicle-master-lock · VEHICLE_MASTER_WRITE_ONLY'],
  ['가져다 쓰기', '스냅·fill·stamp·발행은 어떤 AI든 된다. 책은 읽고 칸에 옮기기만 한다. 비슷한 차로 붙이거나 빈 인승·cc를 채우거나 mf- 를 새로 만들지 않는다.', VEHICLE_MASTER_READ_API.join(' · ')],
  ['사전', '이름 = `public/data/vehicle-master.json`. 코드 책 = `data/vehicle-trim-key-registry.json`. 엔카 원자 시트는 중고 시세 행키(M/SM/T)만 — 정제칸 이름이 아니다.', '엔카에 가솔린 A6 없다고 A6 e-트론을 박지 않음'],
  ['세부모델', '풀체인지 = **모델+개발코드** (`K5 DL3` · `싼타페 MX5` · `아반떼 CN8`). 같은 코드 페리 = `더 뉴 {모델} {코드}`. `디 올 뉴`/`올 뉴`/`The all new` 는 **aliases만**.', 'SUBMODEL_NAME_RULE'],
  ['개발코드', '화면·정제칸에서 DL3·MX5·GN7·CN8 을 떼지 않는다. 「손님이 읽기 어렵다」는 이유로 깎으면 세대가 한 이름이 된다. 「AI 정제」에 그런 줄이 있어도 fill·발행기가 **무시**한다.', 'ai-refine-guard · 실측 2026-08-23 K5 DL3→K5'],
  ['트림 글자', '등급어만 한글(Premium→프리미엄). 제조사 공식 라틴은 정본: **H-PICK** · **N Line** · **X Line** · **GT Line**. 아반떼 N·아이오닉5 N 의 **N** 은 고성능 — N Line 과 합치지 않음.', 'LATIN_BRAND_TRIM_CANON'],
  ['공급사 원문', '정보는 **차량번호 왼쪽**(제조사·차종·차명(세부모델+트림)·연료·연식). 배기량 칸 숫자가 차명(가솔린 3.5 · LPG 3.0)과 달라도 차명이 이긴다.', '281노9792 · 101호5187'],
  ['모르면 빈칸', '마스터에 없으면 비슷한 차로 안 붙인다. 트림 후보가 여럿이면 **차종코드를 안 박는다**(PARTIAL). 인승·cc·kWh 를 지어내지 않는다.', '팰리세이드 9인승=대형 MPV · 7인승=대형 SUV — 인승이 있을 때만'],
  ['키 의미', 'mf- 한 줄의 뜻은 **레지스트리**. json variant 라벨과 달라도 키 뜻을 바꾸지 않는다. 삭제·재사용 금지.', 'vehicle-trim-key-registry.json'],
  ['새 차종', 'json에 행을 먼저 넣는다(담당) → fill 이 정제칸에 박는다. 엔카 키를 만들지 않는다.', 'fill-supplier-ai-columns --include-mirror'],
];
