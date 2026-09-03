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
  '손오공-정제.mjs — 라이브 「차종마스터」 행 복사(hourly-sync ⓪)',
  'fill-supplier-ai-columns closeNamesToLiveMaster — 라이브에 없는 이름 비움. 원문에 없는 디 올 뉴는 안 붙임',
  'fill-supplier-from-encar-sheet — 엔카 작업 시트로 키를 안 만든다',
  'stamp-encar-codes-on-supplier — M/SM/T 만(이름과 같을 때)',
  'pickConfirmedMasterCode — 이미 있는 mf- 를 고른다',
  'check-vehicle-master-lock · verify-master-pass',
] as const;

export type PlaybookRow = [string, string, string];

/** 맞추는 요령 — 다른 AI가 스냅·fill 할 때 이 순서만 따른다. 새 규칙을 만들지 않는다. */
export const VEHICLE_MASTER_MATCH_PLAYBOOK: PlaybookRow[] = [
  ['담당', `쓰기(시트 이름·mf- 키 의미·「AI 정제」 정본 매핑·새 키 발급·라이브 탭 행 추가) = **${VEHICLE_MASTER_OWNER}만**. 정제칸 **세대** 정본 = 라이브 「차종마스터」 탭. **철자** = 지금 원문. 엔카 작업 시트(F03)는 추가·검토용. 라이브 탭에 클로드·코덱스가 쓰지 않는다. \`vehicle-master.json\` 은 **폐기**.`, 'vehicle-master-lock · VEHICLE_MASTER_WRITE_ONLY'],
  ['가져다 쓰기', '스냅·fill·stamp·발행은 어떤 AI든 된다. 책은 읽고 칸에 옮기기만 한다. 비슷한 차로 붙이거나 빈 인승·cc를 채우거나 mf- 를 새로 만들지 않는다.', VEHICLE_MASTER_READ_API.join(' · ')],
  ['사전', '정제칸 **세대** = 라이브 「차종마스터」 행. **철자** = 지금 원문. 원문에 없는 디 올 뉴 금지. 엔카 작업 시트는 새 행 추가·제원. vehicle-master.json으로 세부모델을 지어내지 않는다.', 'docs/차종명명-정제-매뉴얼.md §1-0'],
  ['세부모델', '엔카와 개수·이름 1:1. 괄호 없음(G80 (RG3) → G80 RG3). 연식종료 2019 이전(NF)은 넣지 않는다.', '엔카 iNav · 7년 창'],
  ['예외(이 둘만)', '① 기아만: 엔카에 세대명이 있을 때만 N세대→개발코드(K5 3세대 → K5 DL3). 세대 하나(K8)는 엔카 세대명 없음 → 코드 없음. F03 `K8 GL3`류는 허용 오류(안 고침·매칭 무해·검수대기 아님). 올 뉴·더 뉴 카니발 = YP, 더 뉴 카니발 4세대 = KA4. 엔카에 이미 코드가 있으면 그대로. ② 우리 시트만 제네시스 1세대 G80 DH(엔카는 G80). FL 분할·티볼리 X100·다른 비기아 개발코드는 예외 아님.', 'docs/차종명명-정제-매뉴얼.md'],
  ['세부트림', '배기량으로 쪼개지 않는다. 2.5 세 개 + 3.5에만 있는 하나 = 네 개. 괄호 없음. 등급 이름이 없으면 기본형. 렌터카·택시·장애인용은 트림이 아니다. 5링크·리프처럼 차가 다른 것만 풀어 쓴다.', '합집합 · 파워트레인≠트림'],
  ['제원', '연료·배기량·구동은 제원마스터 허용값. 차종 행을 cc마다 쪼개지 않는다. 인승은 원문이 하나로 모일 때만.', '제원마스터 탭'],
  ['배터리', '전기만 전기차배터리마스터. 세부모델별 공식 kWh. 팩이 둘이면 행 둘. 화이트리스트로 아무 kWh나 고르지 않는다.', '전기차배터리마스터 탭'],
  ['개발코드', '엔카에 이미 있으면 그대로. 기아는 세대명이 있을 때만 붙인다(K5 DL3). 단일세대(K8)에 GL3를 추측으로 만들지 않는다. F03가 이미 `K8 GL3`면 그대로 매칭. 우리 시트 G80 DH만 둘째 예외. 「손님이 읽기 어렵다」로 이름을 깎지 않는다.', 'ai-refine-guard · K5 DL3 · K8 · G80 DH'],
  ['트림 글자', '합친 뒤의 트림 이름. 등급어 한글화는 엔카가 영문일 때만. H-PICK·N Line·GT-Line은 한글화 금지.', 'LATIN_BRAND_TRIM_CANON'],
  ['공급사 원문', '정보는 차량번호 왼쪽(제조사·차종·차명·연료·연식). 배기량 칸 숫자가 차명과 달라도 차명이 이긴다.', '281노9792 · 101호5187'],
  ['정제칸', '세대=라이브 행 멤버십. 철자=지금 왼쪽 원문. 원문에 없는 디 올 뉴를 붙이지 않음. 없는 이름은 생성·보정·FL/YP 붙이거나 떼지 않음. 조합이 없으면 세 칸 비우고 검수대기. 판매·ERP는 정제칸 사본. 상품마스터 차번은 이름 입력이 아님.', 'vehicle-refine · fill-supplier-ai-columns · 손오공-정제 · audit:raw-ad-prefix'],
  ['모르면 빈칸', '엔카·시트에 없으면 비슷한 차로 안 붙인다. 트림 후보가 여럿이면 차종코드를 안 박는다(PARTIAL).', ''],
  ['키 의미', 'mf- 한 줄의 뜻은 **레지스트리**. 삭제·재사용 금지. 트림 매칭과 코드(연료·cc 갈림)는 다른 층이다.', 'vehicle-trim-key-registry.json'],
  ['새 차종', '엔카 작업 시트에 먼저 → 커서가 라이브 「차종마스터」에 같은 행을 넣은 뒤에만 정제칸 재발행. 로컬 json으로 이름을 만들지 않는다. 상품시트·ERP만 임시 수정 금지.', '엔카 작업 시트 → 라이브 탭'],
  ['검수 칸', '차종마스터 이름 7열 오른쪽: 클로드/커서/코덱스 × 지식검토·엔카대조. 지식검토=매뉴얼 규칙, 엔카대조=iNav 원문. 이름·기간은 여기 적지 않는다.', 'ensure-encar-master-review-columns · write-cursor-f03-review'],
];
