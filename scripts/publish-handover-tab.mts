/**
 * **「AI 인계」 탭**을 영업자 시트에 숨겨 둔다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-13 — 「영업자시트에 탭 하나 숨겨서 어떤 AI가 하더라도 매뉴얼 만들어놓자」)
 *   이 표는 규칙이 많고, 그 규칙은 전부 **사고를 한 번씩 겪고 생긴 것**이다.
 *   다음 사람이 그걸 모르면 같은 자리에서 같은 실수를 한다. 그래서 시트 안에 박아 둔다.
 *   ⚠ 리포 주석에도 같은 내용이 있지만, 시트를 여는 사람이 리포를 여는 것은 아니다.
 *
 * ★탭은 **숨긴다.** 영업자가 보는 자리가 아니다. 다만 지우지는 마라 —
 *   숨긴 탭이 하나 더 생기는 게 아니라, 이 한 장이 계속 갱신된다.
 *
 *   npx tsx scripts/publish-handover-tab.mts
 *   npx tsx scripts/publish-handover-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_EXCLUDE, SALES_MAPPING, SALES_RETIRED_COLUMNS } from '../lib/domain/sales-sheet-mapping';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const SHEET = arg('sheet', S(process.env.INVENTORY_EXPORT_SHEET_ID) || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const TAB = arg('tab', 'AI 인계');

/** [묶음, 항목, 내용] — 빈 줄은 ['', '', ''] 로 넣는다. */
type Row = [string, string, string];
const H = (t: string): Row => ['', '', t];
const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();

const ROWS: Row[] = [
  ['묶음', '항목', '내용'],
  ['', '', ''],
  ['0. 먼저 읽을 것', '이 문서', '이 시트를 고치기 전에 여기부터 읽어라. 아래 규칙은 전부 사고를 한 번씩 겪고 생긴 것이다.'],
  ['', '갱신', `마지막 갱신 ${kst.slice(0, 16).replace('T', ' ')} KST · 갱신 명령 npx tsx scripts/publish-handover-tab.mts --apply`],
  ['', '', ''],

  ['1. 이 시트는 무엇인가', '쓰는 사람', '영업자. 손님 앞에서 이 표를 보고 차와 요금을 말한다.'],
  ['', '제일 중요한 것', '차량번호 · 대여료 · 보증금. 이 셋이 틀리면 손님에게 잘못 말하게 된다.'],
  ['', '두 번째', '손에 익은 자리. 열 순서·이름을 함부로 바꾸지 마라 — 그게 이 표에서 제일 비싼 값이다.'],
  ['', '', ''],

  ['2. 탭 구성', '상품리스트', '전 공급사 재고. 공급사 시트에서 직행으로 옮긴다.'],
  ['', '손오공구독', '손오공 구독. 상품리스트와 같은 규격 + 인수형 요금.'],
  ['', '오플구독', '오토플러스 재고. 공급사 원본 탭을 통째로 복사(copyTo).'],
  ['', '오플프로모션', '오플 전기차 프로모션. 원본 탭 통째 복사.'],
  ['', 'AI 인계', '이 문서. 숨김.'],
  ['', '⚠ 금지', '같은 표를 두 벌 만들지 마라. 신버전·구버전을 나란히 뒀다가 한쪽만 갱신돼 영업자가 옛 값을 봤다(오플 유령 48개월).'],
  ['', '', ''],

  ['3. 어떻게 만들어지나', '★한 줄 요약', '공급사시트를 판매시트로 그대로 옮긴다. ERP를 거치지 않는다. 아래 @매핑 표가 «어느 칸을 어디로» 옮길지 정한다.'],
  ['', '매핑을 고치려면', '이 탭의 @매핑 줄을 고치면 된다. 코드를 안 고쳐도 발행기가 그대로 따른다.'],
  ['', '상품리스트', 'npx tsx scripts/publish-origin-tab.mts --apply'],
  ['', '손오공구독', 'npx tsx scripts/publish-sonogong-tab.mts --apply  (제공시트 「구독재고」 직행)'],
  ['', '⚠ 옛 손오공 발행기', 'publish-jonghap-tab --sonogong 은 쓰지 마라. ERP를 거쳐 돈이 사라진다 — 실측 2026-08-14: 제공시트 45대·보증금 24대인데 그 길로는 23대·보증금 0대로 나갔다.'],
  ['', '오플 두 장', 'npx tsx scripts/publish-partner-tabs.mts --apply'],
  ['', '주소의 정본', '문패 시트 「공급사시트정리」 1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY (공급사명 | 코드 | 시트주소)'],
  ['', '★파이어베이스', '안 쓴다. 구글시트만으로 돈다. ERP가 죽어 있어도 이 시트는 갱신된다.'],
  ['', '⚠ 하지 마라', 'RTDB 파트너 레코드에서 시트 주소를 찾지 마라. v3·v4가 갈려 있고 v4는 껍데기다 — 거기서 찾다가 이안카 84대·오플 100대가 통째로 빠졌다.'],
  ['', '', ''],

  ['4. 절대 규칙', '① 돈은 해석 안 함', '대여료·보증금·상태는 공급사가 쓴 글자를 그 자리에 옮길 뿐이다. 규칙으로 계산하지 마라.'],
  ['', '왜', '2026-08-12 하루에 난 오류가 전부 «우리가 옮기다 생긴 것»이었다 — 오플 요금 92대 자리밀림 · 유령 48개월 72대 · 아이카 1개월 60대 실종. 공급사 시트에는 맞게 적혀 있었다.'],
  ['', '② 지어내지 않음', '시트에 없는 칸은 비운다. 빈 칸이 틀린 값보다 낫다.'],
  ['', '③ 두 벌 금지', '같은 차가 두 탭에 서면 사고다. 오플·손오공구독은 상품리스트에서 뺀다.'],
  ['', '④ 매번 센다', '발행 때마다 차량번호·대여료·보증금이 몇 대 찼는지 찍는다. 갑자기 줄면 그날 발행을 멈추고 봐라.'],
  ['', '', ''],

  // ★서식은 코드가 아니라 여기 적힌 대로 간다. 정본은 `lib/domain/sales-sheet-format.ts` 한 곳.
  //   사장님 2026-08-14 — 「이런 거 다 매뉴얼에 메모해, 자꾸 까먹으니까」.
  ['5. 서식 (실측값)', '글꼴', 'Roboto 10pt · 기울임 없음 · 흰 바탕 · 행높이 23px · 테두리 없음 · 줄무늬 없음'],
  ['', '왜 로보토', '사장님 2026-08-14 선택. 한글 자소는 없어 구글이 대체 글꼴로 그린다 — 숫자·영문만 로보토로 나와 자릿수가 또렷하다.'],
  ['', '★적용 범위', '시트 끝까지 깐다. 쓴 범위까지만 씌우면 아래 빈 줄에 손으로 적었을 때 글꼴이 딴판이 된다.'],
  ['', '★색은 글자에', '배경이 아니라 글자색으로 가른다. 바탕은 전부 흰색.'],
  ['', '머리행', '굵게. 40열짜리 표에서 어디가 제목 줄인지 눈이 먼저 잡아야 한다. 첫 줄 고정.'],
  ['', '', ''],
  ['', '정렬 — 왼쪽', '제조사 · 모델 · 세부모델 · 세부트림 · 옵션 (긴 글. 가운데면 줄마다 시작 위치가 달라 세로로 못 훑는다)'],
  ['', '정렬 — 오른쪽', '금액·숫자 전부: Km · 배기량 · 소비자가격 · 단기보증 · 장기보증 · 1~60개월 · 21세 · 23세 · 1만+'],
  ['', '정렬 — 가운데', '날짜(최초등록·입고일자) · 그 밖 전부'],
  ['', '⚠ 숫자처럼 생긴 글', '대인 「무한/30」 · 자차 「400/50~100」 은 숫자가 아니라 글이다 — 가운데로 둔다.'],
  ['', '', ''],
  ['', '★기간별 대여료', '★★칸 «배경»에 넣는다. 글자색이 아니다(사장님 2026-08-14 — 「칸 배경에」). 글자색으로 가르면 40열 표에서 안 보인다.'],
  ['', '단계적으로', '한 블록을 한 색으로 칠하지 않는다 — 24와 60이 눈으로 안 갈린다. 기간이 길수록 짙다. 머리행까지 같이 칠한다.'],
  ['', '단기 (청록 배경)', '단기보증 #EAF7F8 · 1개월 #DCF0F2 · 6개월 #CDE9EC · 12개월 #BFE2E6'],
  ['', '장기 (파랑 배경)', '장기보증 #EDF0FE · 24개월 #DFE5FD · 36개월 #D1DAFC · 48개월 #C3CFFB · 60개월 #B5C4FA'],
  ['', '구독 반납형 배경', '보증금 #EDF0FE → 60개월 #A7B9F9 (장기와 같은 파랑 계열)'],
  ['', '구독 인수형 배경', '보증금 #F1EBFD → 60개월 #BFA5F3 (보라 계열. 반납형과 «색상»이 갈려야 블록이 보인다)'],
  ['', '⚠ 옅게', '짙어지면 검은 글자가 안 읽힌다. 배경이 있는 칸도 글자는 검정이다.'],
  ['', '글자색은 어디에', '값이 달라지는 칸에만 — 구분 · 배차상태 · 차량번호(링크) · 빨강 칸. 기간 칸 글자는 검정.'],
  ['', '굵게', '월 대여료만. 보증금은 굵히지 않는다 — 둘 다 굵으면 어느 게 월 요금인지 흐려진다.'],
  ['', '', ''],
  ['', '배차상태 (값별)', '즉시출고·출고가능 #0000FF · 상품화중·출고협의 #FF9900 · 계약중·출고불가 #999999 · 굵게'],
  ['', '구분 (값별)', '신차렌트 #FF00FF · 중고렌트 #34A853 · 중고구독 #FF9900 · 신차구독 #FF9900 · 굵게'],
  ['', '차량번호', '#1155CC + 밑줄 (사진링크가 걸린 칸만)'],
  ['', '빨강', '분납 · 21세 · 23세 · 1만+ · 전용계좌 · 비고 #FF0000'],
  ['', '', ''],
  ['', '⚠ 순서 함정', '색과 굵기를 따로 주지 마라. 뒤엣것이 앞엣것을 덮어 대여료가 통째로 검정으로 나간다. 한 번에 줘라.'],
  ['', '⚠ 정렬 함정', '정렬을 색보다 «먼저» 줘라. 색 요청은 textFormat만 건드려 정렬을 안 지운다. 뒤집으면 정렬이 날아간다.'],
  ['', '⚠ 링크 함정', '사진링크(textFormatRuns)는 맨 마지막에 걸어라. 뒤에 repeatCell이 한 번이라도 오면 링크가 통째로 지워진다.'],
  ['', '⚠ 글꼴 함정', '링크 run에도 글꼴을 같이 준다. 서식 모듈만 고치면 차량번호 칸만 옛 글꼴로 남는다(2026-08-14 실측).'],
  ['', '⚠ 탭 이름 함정', '발행기는 탭을 «이름»으로 찾는다. 이름이 어긋나면 못 찾고 새 탭을 하나 더 만든다 — 상품리스트가 둘이 된 사고가 두 번 났다.'],
  ['', '', ''],

  ['5-1. 구분 값', '★세 가지만', '신차렌트 · 중고렌트 · 중고구독 (사장님 2026-08-14). 캐논은 lib/intake/entities.PRODUCT_TYPES.'],
  ['', '옛 표기 갈아끼움', '신차·신차(선출고) → 신차렌트 · 재렌트·중고 → 중고렌트 · 재구독 → 중고구독'],
  ['', '⚠ 모르는 말', '「구독」 하나만 적힌 칸은 단정하지 않고 그대로 둔다. 빈 칸이 틀린 값보다 낫다.'],
  ['', '', ''],

  ['6. 차량번호 링크', '무엇을 거나', '렌트사가 올려놓은 사진 링크만. 공급사 시트 차번 칸의 하이퍼링크(아이카=상세페이지)와 스마트칩(오플·리더스=드라이브 폴더).'],
  ['', '⚠ 하지 마라', '사진이 없다고 우리 카탈로그(/m/코드)로 보내지 마라. «사진 보러 눌렀더니 딴 데로 가는» 칸이 된다. 링크가 없으면 그냥 글자로 둔다.'],
  ['', '사진함', 'https://drive.google.com/drive/folders/1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ (공급사별 폴더)'],
  ['', '', ''],

  ['7. 판매 차명', '정본', '공급사 시트에 적힌 값만. 차종마스터 스냅·상품마스터 3축으로 올리지 않는다(사장님 2026-08-19 — 안 틀리는 게 중요).'],
  ['', '축', '제조사 · 모델 만. 「차명」은 공급사 「차명(세부모델+트림)」 원문. ★세부모델·세부트림·파워트레인은 뺐다 — @매핑에 다시 적어도 발행기가 세우지 않는다(SALES_RETIRED_COLUMNS).'],
  ['', '모델 후보', '모델명 → 모델(정제). 없으면 빈칸(짐작 금지).'],
  ['', '표기 사전', 'public/data/master-aliases.json — 외장·내장·제조사 등 치환에만 쓴다. 세부축 올리기용 아님.'],
  ['', '전후 대조', '발행기를 고치면 --dump 로 old/new 를 견줘 돈 칸 diff 0 을 확인한 뒤 --apply.'],
  ['', '', ''],

  // ★공급사 제공시트는 «한 벌»이어야 한다. 양식이 갈리면 매핑이 시트마다 다르게 걸리고
  //   그게 곧 «값이 밀리는» 원인이다(사장님 2026-08-14 — 「웰릭스 표본으로 전체 확인해서 통일해줘」).
  ['7-1. 제공시트 규격', '기준', '웰릭스 프리패스 재고 「재고」 28열. 이게 표본이다.'],
  ['', '28열', '차량번호 | 입고일자 | 상태 | 분류 | 제조사 | 차명(세부모델+트림) | 옵션 | 외부색상 | 내부색상 | 연식 | 주행거리 | 연료 | 배기량 | 차량가격 | 단기보증 | 1개월 | 12개월 | 장기보증 | 24개월 | 36개월 | 48개월 | 60개월 | 기타기간①②③ | 정책코드 | 최초등록일 | 사진링크  (2026-08-18 사장님 통일 · 웰릭스 표준 · 20곳 재정렬)'],
  ['', '★6개월은 없다', '6개월은 운영하지 않는다(사장님 2026-08-14). 판다면 여백 칸(기타기간)의 «제목»을 바꿔 쓴다.'],
  ['', '6개월 정리 이력', '2026-08-14 — 렌트존·빌린카·스위치플랜·에코렌트카·제이앤제이 5곳에 6개월 열이 있어 뒤 12열이 한 칸씩 밀려 있었다. 빌린카 47대·제이앤제이 4대 요금은 기타기간①(제목을 「6개월」로 바꿈)로 옮기고 열을 지웠다.'],
  ['', '여백 칸 쓰는 법', '기타기간①②③은 «제목을 바꿔 쓰는» 칸이다. 「18개월」로 갈아 쓰면 파서가 그대로 되읽는다. 비워 두면 무시된다.'],
  ['', '⚠ 여백 칸 보증금', '여백 칸은 장기보증 블록 오른쪽이라 장기보증이 관할한다. 단기 요금을 여기 넣으면 보증금 관할이 바뀐다 — 되살릴 때 먼저 볼 것.'],
  ['', '점검', 'npx tsx scripts/audit-supplier-schema.mts (양식 대조) · scripts/fix-supplier-table.mts --apply (표·드롭다운 다시 세우기)'],
  ['', '⚠ 남의 시트', '우리 제공시트만 고친다. 가르는 표식은 열 이름 「차명(세부모델+트림)」. 소유자로 거르지 마라 — 우리 것도 회사 계정 여럿에 흩어져 있어 전부 막힌다.'],
  ['', '⚠ 분당 쿼터', '17곳을 연달아 읽으면 429가 난다. 끊기면 어떤 시트만 고쳐져 양식이 더 갈린다 — 재시도를 넣고 돌린다.'],
  ['', '', ''],

  ['8. 공급사별 주의', '제네시스', '요즘 나오는 건 트림이 없다. 세부트림 빈 칸이 정상이다 — 결손으로 세지 마라.'],
  ['', '손오공 구독', '한 차에 반납형·인수형 두 벌. 반납형이 기본이다. 인수형 블록이 시트에서 앞에 있어 그대로 읽으면 인수형이 기본값이 된다(카니발 36개월 14만원 차이).'],
  ['', '손오공 보증금', '반납형은 「연수×대여료」다. 기간마다 달라 한 숫자로 못 적는다 — 제공시트가 쓰는 말 그대로 글자로 넣는다.'],
  ['', '손오공 인수형', '36개월부터만 판다. 12·24개월은 45대 전부 비어 있다.'],
  ['', '손오공 A1 함정', '제공시트 「구독재고」 A1 머리글이 「1열」로 깨져 있었다(2026-08-14 「차량번호」로 고침). 그 한 칸 때문에 차량번호 열이 안 잡혀 45대 중 23대만 올라갔다.'],
  ['', '손오공 현재 값', '45대 · 반납형 요금 42대 · 인수형 요금 24대 · 보증금 반납형 24대(「연수×대여료」) · 인수형 보증금 24대. 요금은 있는데 보증금이 빈 18대는 제공시트가 그렇다 — 지어내지 않는다.'],
  ['', '오플', '요금이 「기간 × 주행거리」다(12개월 3만km 등). 표준 기간 칸에 안 들어가 별도 탭.'],
  ['', '아이언', 'ironrentcar.com 이 정본 — 「아이언 프리패스 재고」(정제시트)로 미러한다(sync-mirror-sheet --source=iron). 문패는 정제시트.'],
  ['', '배차중/배차대기', '배차대기·재고확인·재렌트 → 팔 수 있다 / 배차중·운행중·대여중 → 남이 타고 있다.'],
  ['', '', ''],

  ['9. 알려진 구멍', '보증금', '기간마다 보증금이 다른 차 81대(빌린카45·손오공24·KH6·스타4·센트로2). 표에 한 값만 찍으면 틀린다.'],
  ['', '차고지', 'ERP에 18/404만 차 있다. 공급사 시트에서 다시 긁어야 한다.'],
  ['', '사진', '405대 중 사진 있는 차 188대. 아이카 69·이안카 58이 비어 있다 — 공급사에 요청할 목록.'],
  ['', '스타스카이=스타', '(주)스타스카이(RP005)와 스타(RP018)는 같은 회사다(사장님 확인 2026-08-13). RP005는 재고 0대·시트 없음 — 문패의 「스타 RP018」 하나만 보면 된다. 시트에는 「스타」로 나간다.'],
  ['', '', ''],

  ['', '', ''],
  ['@매핑', '판매시트 열', '공급사시트 열 이름 후보 — 쉼표로. 앞에서부터 먼저 맞는 것을 쓴다. 없으면 빈 칸으로 둔다(지어내지 않는다).'],
  // ★표 내용은 `lib/domain/sales-sheet-mapping.SALES_MAPPING` 한 곳에서 나온다 —
  //   발행기의 예비값과 같은 곳이라 둘이 어긋날 수가 없다(실측 2026-08-14: 어긋나서 네 열이 통째로 비었다).
  ...SALES_MAPPING.map(([col, cands]) => ['', col, cands.length ? cands.join(', ') : '(문패의 공급사명이 자동으로 들어간다 — 공급사 시트에서 찾지 않는다)']),
  ['@매핑끝', '', ''],
  ['', '', ''],
  ['@제외', '공급사코드 또는 코드:탭', '상품리스트에서 뺄 것 — 별도 탭으로 따로 싣는 것들. 같은 차가 두 탭에 서면 사고다.'],
  ...SALES_EXCLUDE.map(([code, why]) => ['', code, why]),
  ['@제외끝', '', ''],
  ['', '', ''],

  ['10. 고칠 곳', '상품리스트 발행', 'scripts/publish-origin-tab.mts'],
  ['', '손오공·규격', 'scripts/publish-jonghap-tab.mts'],
  ['', '오플 탭 복사', 'scripts/publish-partner-tabs.mts'],
  ['', '마스터 감사', 'scripts/audit-master-gap.mts · scripts/fill-master-gap.mts'],
  ['', '표기 사전', 'lib/domain/master-alias.ts · scripts/seed-master-aliases.mts'],
  ['', '공급사 양식', 'lib/domain/supplier-template-sheet.ts'],
  ['', '시트→ERP', 'scripts/apply-sheet-to-erp.mts (차명 축·연령할증만. 돈은 되읽지 않는다)'],
];

console.log(`■ 「${TAB}」 탭 ${APPLY ? '반영' : '미리보기(dry-run)'}`);
console.log(`  ${ROWS.length}줄 · 대상 ${SHEET}\n`);
for (const r of ROWS.slice(0, 8)) console.log(`   ${r.map((c) => c.slice(0, 40)).join(' | ')}`);
console.log('   …');
if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
const api = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
const call = async (u: string, init?: RequestInit) => {
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
};

const meta = await call(`${api}?fields=sheets(properties(sheetId,title,index))`) as
  { sheets: { properties: { sheetId: number; title: string; index: number } }[] };
let found = meta.sheets.find((s) => s.properties.title === TAB);
if (!found) {
  const made = await call(`${api}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }),
  });
  found = { properties: made.replies[0].addSheet.properties };
  console.log(`  탭 「${TAB}」 새로 만듦`);
}
const gid = found.properties.sheetId;
const rgb = (hex: string) => ({
  red: parseInt(hex.slice(0, 2), 16) / 255,
  green: parseInt(hex.slice(2, 4), 16) / 255,
  blue: parseInt(hex.slice(4, 6), 16) / 255,
});

/**
 * ★**시트에서 손으로 고친 @매핑·@제외를 지키고 쓴다.**
 *
 * ⚠ 예전에는 그냥 A1:Z500 을 지우고 코드의 ROWS 를 다시 썼다. 그래서 시트에서 고친 규칙이
 *   이 명령 한 번에 옛 코드값으로 되돌아갔다 — 「시트를 고치면 발행이 그대로 따른다」는
 *   약속이 여기서 깨져 있었다(2026-08-14 발견). 되돌릴 길은 구글시트 버전기록뿐이었다.
 *
 * ★규칙 — **시트가 이긴다.** 시트 블록이 코드와 다르면 시트 것을 그대로 두고 화면에 알린다.
 *   그래야 사람이 코드(`lib/domain/sales-sheet-mapping`)에도 같은 줄을 반영할 수 있다.
 */
{
  const block = (rows: string[][], from: string, to: string) => {
    const a = rows.findIndex((r) => S(r[0]) === from);
    if (a < 0) return null;
    const out: string[][] = [];
    for (const r of rows.slice(a + 1)) { if (S(r[0]) === to) break; out.push([S(r[0]), S(r[1]), S(r[2])]); }
    return out;
  };
  const same = (a: string[][], b: string[][]) => a.length === b.length && a.every((r, i) => r.join('') === b[i].join(''));
  let live: string[][] = [];
  try {
    const cur = await call(`${api}/values/${encodeURIComponent(TAB)}!A1:C500`) as { values?: string[][] };
    live = (cur.values || []) as string[][];
  } catch { /* 처음 만드는 경우 */ }
  /** 급할 때 코드값으로 되돌리는 손잡이. 평소엔 안 쓴다. */
  const RESET = process.argv.includes('--reset-map');
  for (const [from, to] of [['@매핑', '@매핑끝'], ['@제외', '@제외끝']] as [string, string][]) {
    const onSheet = block(live, from, to);
    if (RESET || !onSheet || !onSheet.some((r) => S(r[1]))) continue;
    const inCode = block(ROWS, from, to) || [];
    if (same(onSheet, inCode)) continue;
    /**
     * ★**«시트가 무조건 이김»이 아니라 «합침»이다.**
     * ⚠ 처음엔 시트 것을 통째로 썼는데, 그러면 **코드에서 열을 늘려도 시트가 옛 구성을 붙들어**
     *   새 칸이 영영 안 나간다(실측 2026-08-14 — 43칸을 늘렸는데 시트는 40열 그대로였다).
     *   그 보호는 «사람이 시트에서 고친 것»을 지키라고 넣은 것이지 «열을 늘린 것»을 막으라는 게 아니다.
     * ★코드의 **차례**를 따르되 그 줄이 시트에도 있으면 **시트의 값**을 쓴다.
     *   시트에만 있는 줄(사람이 더한 것)은 뒤에 남긴다 — 그러면 둘 다 안 잃는다.
     */
    const bySheet = new Map(onSheet.filter((r) => S(r[1])).map((r) => [S(r[1]), r]));
    const used = new Set<string>();
    const merged = inCode.map((r) => {
      const k = S(r[1]);
      const hit = k ? bySheet.get(k) : undefined;
      if (hit) { used.add(k); return hit; }
      return r;
    });
    // ★뺀 열(SALES_RETIRED_COLUMNS)은 시트에 남아 있어도 되살리지 않는다 — 안 그러면 «시트에만 있는 줄»로 뒤에 붙는다.
    const retired = onSheet.filter((r) => S(r[1]) && !used.has(S(r[1])) && SALES_RETIRED_COLUMNS.includes(S(r[1])));
    const extra = onSheet.filter((r) => S(r[1]) && !used.has(S(r[1])) && !SALES_RETIRED_COLUMNS.includes(S(r[1])));
    if (retired.length) console.log(`  ★${from} — 뺀 열 ${retired.map((r) => S(r[1])).join('·')} 은 시트에 있어도 세우지 않는다`);
    const at = ROWS.findIndex((r) => S(r[0]) === from);
    const end = ROWS.findIndex((r) => S(r[0]) === to);
    ROWS.splice(at + 1, end - at - 1, ...merged, ...extra);
    console.log(`  ★${from} — 시트에서 고친 ${used.size}줄은 지키고, 코드에 새로 생긴 ${merged.length - used.size}줄을 더한다`
      + `${extra.length ? ` · 시트에만 있는 ${extra.length}줄은 뒤에 남긴다` : ''}`);
  }
}
await call(`${api}/values/${encodeURIComponent(TAB)}!A1:Z500:clear`, { method: 'POST', body: '{}' });
await call(`${api}/values/${encodeURIComponent(TAB)}!A1?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: ROWS }),
});
await call(`${api}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: [
    // 읽으라고 만든 문서다 — 줄바꿈을 켜고 넉넉히 준다.
    { repeatCell: {
      range: { sheetId: gid },
      cell: { userEnteredFormat: {
        backgroundColor: rgb('FFFFFF'),
        textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, foregroundColor: rgb('000000') },
        horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', wrapStrategy: 'WRAP',
      } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    } },
    { repeatCell: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, bold: true } } },
      fields: 'userEnteredFormat.textFormat',
    } },
    // 묶음 이름(A열)은 굵게 — 눈으로 단락이 갈려야 한다.
    { repeatCell: {
      range: { sheetId: gid, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, bold: true, foregroundColor: rgb('1D4ED8') } } },
      fields: 'userEnteredFormat.textFormat',
    } },
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    ...[[0, 150], [1, 130], [2, 900]].map(([i, px]) => ({ updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px }, fields: 'pixelSize',
    } })),
    // ★맨 뒤로 보내고 숨긴다 — 영업자가 보는 자리가 아니다.
    { updateSheetProperties: { properties: { sheetId: gid, index: meta.sheets.length, hidden: true }, fields: 'index,hidden' } },
  ] }),
});
console.log(`\n  반영 완료 — 숨긴 탭 「${TAB}」 · ${ROWS.length}줄`);
console.log(`  https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}\n`);
