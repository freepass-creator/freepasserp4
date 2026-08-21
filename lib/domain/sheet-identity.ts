/**
 * **「이 시트는」 — 시트마다 첫눈에 알 것 한 장** : 무엇인가 · 지금 쓰나(상태) · 어떻게 구성됐나 · 어디를 바라보나(입력) · 어디에 주나(출력) · 주기 · 틀리면 어디를 고치나.
 *
 * ★사장님 2026-08-19 — 「시트마다 그 시트가 어떻게 구성됐고 어디를 바라보고 어디한테 데이터를 주고 이런 거 매뉴얼화를 잘 해야 함」
 *   · 정본은 이 파일. 각 시트의 「이 시트는」 탭(publish-sheet-identity-tab)과 원천대장 「시트 지도」 0장 「시트 명부」(publish-sheet-map-tab)는 여기서 나온다.
 *   · 새 규칙을 여기서 지어내지 않는다 — 정본 서열·차명 정제 흐름·매일 순서는 ai-operating-manual / vehicle-refine-flow 가 정본이고, 여기는 «이 시트 한 장»의 관점으로 요약만 한다.
 *   · 상태 어휘: 연동중(지금 읽는다) · 정본(운영)(문패·허브·판매시트·원천대장처럼 늘 쓰는 우리 시트) · 구버전·폐기(아무도 안 읽는다) · 외부 원본(공급사 소유, 우리는 읽기만).
 */
import { MIRROR_SOURCES, type MirrorSource } from './mirror-sources';
import { MIRROR_OWNER_RULE } from './mirror-sheet-mapping';
import { HUB_CODE_SHEET_ID, HUB_HUMAN_SHEET_ID, LEGACY_SHEETS, MASTER_SHEET_ID, SALES_SHEET_ID, type LegacySheet } from './legacy-sheets';
import { LEGACY_NOTICE_TAB, LEGACY_SHEET_PREFIX, SHEET_IDENTITY_TAB } from './supplier-template-sheet';

export type SheetStatus = '연동중' | '정본(운영)' | '구버전·폐기' | '외부 원본';
export type SheetKind = '제공시트' | '정제시트' | '문패' | '허브' | '판매시트' | '원천대장' | LegacySheet['kind'] | '외부 원본';

/** 「이 시트는」 한 장을 만들 재료 — 실측(탭 목록·문패 코드)은 발행기가 채워 넘긴다. */
export type SheetIdentityInput = {
  id: string;
  name: string;              // 지금 이름(표식 포함)
  kind: SheetKind;
  status: SheetStatus;
  code?: string;             // 공급사코드
  label?: string;            // 공급사 이름
  owner?: string;
  tabs?: string[];           // 실측 탭 목록(숨김은 「[숨김]」 접두)
  stockColumns?: number;     // 재고 탭 열 수(실측)
  mirror?: MirrorSource;     // 정제시트면 원본
  legacy?: LegacySheet;      // 구버전이면 그 줄
  replacementName?: string;  // 구버전 → 지금 쓰는 시트 이름
  replacementUrl?: string;
  legacyOfCode?: LegacySheet[]; // 이 공급사의 옛 시트(안 씀)
  editors?: string;          // 편집 권한 실측(anyone:writer 등)
  generatedAt?: string;      // KST
};

export const sheetUrl = (id: string, gid?: number) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid !== undefined ? `#gid=${gid}` : ''}`;
export const STATUS_HELP: Record<SheetStatus, string> = {
  '연동중': '지금 문패·발행기·상품마스터·ERP 가 읽는 시트. 이름 끝 「[연동중]」.',
  '정본(운영)': '늘 쓰는 우리 운영 시트(문패·허브·판매시트·원천대장). 이름 표식 없음.',
  '구버전·폐기': '아무도 읽지 않는 옛 시트. 이름 앞 「[구버전·폐기]」 + 첫 탭 「⚠ 구버전 — 안 씀」. 여기 적어도 어디에도 안 간다.',
  '외부 원본': '공급사 소유 시트/홈페이지. 우리는 읽기만(정제시트로 미러). 이름을 건드리지 않는다.',
};

const FLOW_OUT_SUPPLIER = (code: string, label: string) => [
  `문패 「공급사시트정리」의 ${code} ${label} 줄이 이 시트를 가리킨다 → 아래 셋이 이 시트를 읽는다`,
  '① 판매시트 「프리패스 상품리스트」 — 재고 탭 줄이 그대로(출고불가 제외 · 빈 대여료 「-」 · 차명은 정본→정제칸→원문). 탭 3개: 상품리스트 / 손오공 구독재고는 「손오공구독」(보증금 반납형·12~60개월 반납형·보증금 인수형·36/48/60개월 인수형) / 오토플러스는 「오플구독」(12개월 2만km … 36개월 3만km) — 갈래 탭엔 우리 공통 대여료 블록이 없고 그 공급사 기간별 대여료가 선다. 같은 차는 한 탭에만.',
  '② 원천대장 「상품마스터」 — 상태·정책·기간별 대여료/보증금(차종코드·차명 칸은 안 덮음) → 발행된 상품리스트 값으로 한 번 더 맞춤(⑤′) → ERP(매일 02:00 KST 일일 동기).',
  '③ 검수·채움 — 정제칸 채우기(fill-supplier-ai-columns) · 돈 대조(audit-sheet-vs-sales) · 빈 칸(audit-stock-gaps) · 정제칸 대조(audit-vehicle-refine).',
];
const CADENCE_SUPPLIER = '공급사(또는 원본)가 고치면 → 「일일 반영」(npx tsx scripts/run-daily.mts --apply, 자동은 sheet-sync.yml 매일 09:10) → 판매시트·상품마스터 → ERP 02:00. 급하면 사람이 run-daily 를 바로 돌린다.';

/** [항목, 내용, 링크/명령] */
export type IdentityRow = [string, string, string];

export function buildSheetIdentityRows(x: SheetIdentityInput): IdentityRow[] {
  const R: IdentityRow[] = [];
  const row = (a: string, b: string, c = '') => R.push([a, b, c]);
  const at = x.generatedAt ? ` · 갱신 ${x.generatedAt} KST` : '';
  row(`${SHEET_IDENTITY_TAB} — ${x.name}`, `정본 lib/domain/sheet-identity.ts · 이 탭은 기계가 통째로 다시 찍는다(사람 메모는 「AI 인계」에)${at}`, 'npx tsx scripts/publish-sheet-identity-tab.mts --apply');
  row('상태', `${x.status} — ${STATUS_HELP[x.status]}`, '');
  row('이 시트는', describe(x), sheetUrl(x.id));
  if (x.owner || x.editors) row('소유 · 편집', [x.owner ? `소유 ${x.owner}` : '', x.editors ? `편집 ${x.editors}` : ''].filter(Boolean).join(' · '), '');
  if (x.tabs?.length) row('구성(탭)', x.tabs.join(' · '), '');
  for (const r of composition(x)) row('구성(열·규격)', r[0], r[1]);
  for (const r of reads(x)) row('바라보는 곳(입력)', r[0], r[1]);
  for (const r of feeds(x)) row('주는 곳(출력)', r[0], r[1]);
  row('주기', cadence(x), '');
  for (const r of fixes(x)) row('틀리면 어디를 고치나', r[0], r[1]);
  for (const r of donts(x)) row('하지 말 것', r, '');
  if (x.legacyOfCode?.length) for (const l of x.legacyOfCode) row('옛 시트(안 씀)', `${LEGACY_SHEET_PREFIX}${l.name} — ${l.retiredOn} 부터 안 읽는다${l.note ? ` · ${l.note}` : ''}`, sheetUrl(l.id));
  if (x.replacementName) row('지금 쓰는 시트', x.replacementName, x.replacementUrl || '');
  row('더 보기', '전 시트 명부·정본 서열·매일 순서 = 원천대장 「시트 지도」 · 「AI 운영 매뉴얼」 탭', sheetUrl(MASTER_SHEET_ID));
  return R;
}

function describe(x: SheetIdentityInput): string {
  switch (x.kind) {
    case '제공시트': return `[제공] 프리패스가 만들어 ${x.label || '공급사'}에 준 재고 시트. 공급사 담당자가 재고·정책을 직접 적는다 → 이 시트가 곧 원본이자 정제시트다. 정제칸(구분선 「│」 오른쪽, 보라 머리)은 프리패스가 채운다.`;
    case '정제시트': return `[정제] ${x.label || '공급사'}는 자기 시트/홈페이지(원본)를 쓰고, 프리패스가 그걸 우리 규격으로 옮겨 담는 시트. 문패·발행기·상품마스터는 원본이 아니라 이 시트를 읽는다(「상품마스터로 올 때는 어찌됐든 정제시트 통해서」).`;
    case '문패': return '공급사코드 → 「발행기·상품마스터가 읽을 시트 주소」 표. 여기 적힌 주소가 그 공급사 재고의 정본이다(21곳 전부 우리 「프리패스 재고」 시트). 코드가 읽는 표 — 사람이 보는 정리표는 허브.';
    case '허브': return '사람이 보는 공급사 정리표(공급사명·코드·나눠 준 시트·지금 읽는 주소·대수·상태). publish-supplier-hub 가 찍는다. ERP 관리자 화면의 partner.sheet_url 동기(sheet-hub-sync)도 이 표를 읽는다.';
    case '판매시트': return '영업자가 보는 표 — 탭 3개(「상품리스트」·「손오공구독」·「오플구독」, 2026-08-19 회귀). 기계가 문패 21곳 재고를 모아 같은 발행기로 찍는 사본 — 손으로 고치지 않는다(다음 발행에 사라진다). ERP 는 세 탭의 합과 정확히 같아야 한다(⑤′).';
    case '원천대장': return '상품마스터(차량번호→ERP 차종코드 mf-) · 차종마스터 탭(mf- 보관, Gemini) · 규격검토/규격채택 · 시트 지도 · 정제칸 대조 · AI 운영 매뉴얼. 차명·제원 사전은 엔카 차종마스터 시트.';
    case '외부 원본': return `${x.label || '공급사'} 소유 원본. 프리패스는 읽기만 하고(정제시트로 옮김) 여기에 쓰지 않는다.`;
    default: return `${x.legacy?.kind || '옛 시트'} — ${x.legacy?.retiredOn || ''} 부터 프리패스 어디에서도 읽지 않는다(폐기). ${x.legacy?.note || ''}`.trim();
  }
}
function composition(x: SheetIdentityInput): [string, string][] {
  const cols = x.stockColumns ? ` (실측 ${x.stockColumns}열)` : '';
  switch (x.kind) {
    case '제공시트': return [[`재고 탭 = 렌트사 칸 28(차량번호…사진링크, 남색 머리) │ 정책코드 · 정제칸 11(차종코드~차종분류, 보라 머리) = 40열${cols}. 구독 상품이 따로면 「구독재고」 탭(대여료 블록만 인수형/반납형). 「정책」 탭 = 세로 항목·가로 정책, 재고 「정책코드」로 조인. 열 이름·차례는 웰릭스 표준 — 이름으로 읽는다. 표(Table)는 끝 열까지 한 덩어리(정렬해도 줄 전체 이동). 「상품시트」 탭 = 판매시트에 올라간 이 공급사 줄 그대로(발행마다 갱신). 「점검사항」 = 프리패스 요청 칸.`, 'lib/domain/supplier-template-sheet.ts (TEMPLATE_COLUMNS·AI_TAIL_COLUMNS) · sheet-reading-rules.ts']];
    case '정제시트': return [[`재고 탭 = 제공시트와 같은 40열 규격${cols}(대여료 블록만 원본 상품 구조를 따를 수 있다 — 오토플러스 12/18/24/36×2만/3만, 아이언 72·84개월 예비). 「정책」 탭 = 원본 줄별 조건을 접어 넣은 정책(정제시트 안내 참고).`, 'lib/domain/supplier-template-sheet.ts · mirror-sheet-mapping']];
    case '문패': return [['첫 탭 표: 공급사명 | 공급사코드 | 시트주소 (한 줄에 한 공급사). 뒤에 「AI 운영 매뉴얼」·「이 시트는」.', 'scripts/publish-origin-tab.mts · sync-product-master-live.mts 가 읽는 표']];
    case '허브': return [['「공급사연동」 규격 표(공급사명·코드·나눠 준 시트·지금 읽는 주소·대수·상태·비고) + AI 운영 매뉴얼 · 이 시트는.', 'scripts/publish-supplier-hub.mts']];
    case '판매시트': return [['「상품리스트 MM.DD HH:MM · N대」(21곳 − @제외, 열 = [숨김] AI 인계 @매핑이 정본 · 연식과 Km 사이 「차종구분」= 정제칸 차종분류) · 「손오공구독 …」(공통 대여료 블록 자리에 보증금 반납형·12~60개월 반납형·보증금 인수형·36/48/60개월 인수형) · 「오플구독 …」(그 자리에 보증금(산출 규칙 글자, 머리글 메모에 오플 보증금표) · 12개월 2만km … 36개월 3만km) · 탭 색 파랑/보라/초록 · 금액 칸은 우측+굵게, 기간은 배경색 · [숨김] AI 인계(@매핑·@제외) · AI 정제(치환 사전) · AI 운영 매뉴얼 · 이 시트는. 발행된 표 = 세 탭의 합(sales-published-tabs.ts).', 'lib/domain/sales-sheet-mapping.ts · sales-sheet-format.ts · sales-published-tabs.ts']];
    case '원천대장': return [['차종마스터(트림 한 줄=차종코드) · 차종마스터_규격검토 → 규격채택 · 상품마스터(50열, 탭 이름·머리행은 코드 상수와 같아야 ERP·갱신기가 돈다) · 상품 차종매칭(조회 뷰) · 시트 지도 · 공급사연동 · 공급사 데이터 매뉴얼 · 정제칸 대조 · AI 운영 매뉴얼.', 'lib/domain/product-master-sheet.ts (PRODUCT_MASTER_COLUMNS)']];
    case '외부 원본': return [['공급사 자기 구조(열·탭 이름이 우리와 다르다). 열 대응표는 정제시트의 「정제시트 안내」 탭.', 'lib/domain/mirror-sheet-mapping.ts']];
    default: return [[`옛 구조 그대로 두었다(값 보존). 첫 탭 「${LEGACY_NOTICE_TAB}」만 덧붙였다.`, '']];
  }
}
function reads(x: SheetIdentityInput): [string, string][] {
  switch (x.kind) {
    case '제공시트': return [
      ['재고 탭 렌트사 칸(차량번호·상태·차명·대여료·보증금…) · 정책 탭 = 공급사 담당자가 직접 적는다(링크로 편집). 원본은 이 시트 자체 — 다른 데서 오지 않는다.', ''],
      ['정제칸(차종코드·제조사(정제)·모델·세부모델·세부트림·연료·배기량…) ← 우리 차종마스터. 상품마스터 차종코드가 있으면 그 마스터 행 이름. 신규 차종은 마스터에 넣은 뒤에만 박고, 없으면 빈칸.', 'npx tsx scripts/fill-supplier-ai-columns.mts --apply'],
      ['정책코드 ← 이 시트 「정책」 탭의 코드(사람이 고른다). 비면 「(프리패스 기본)」.', ''],
    ];
    case '정제시트': {
      const m = x.mirror; const src = m?.kind === 'iron' ? 'ironrentcar.com(홈페이지 수집)' : m?.from ? `원본 시트 ${sheetUrl(m.from)}` : '원본(mirror-sources)';
      return [
        [`원본 = ${src} — ${MIRROR_OWNER_RULE}`, 'lib/domain/mirror-sources.ts · npx tsx scripts/sync-mirror-all.mts --apply (사장님이 수식 연동을 걸면 이 코드는 끈다 — 둘이 서로 덮는다)'],
        [m?.policies ? '정책 탭 ← 원본 줄별 조건 칸(대인·대물·자차…)을 접어 코드로(sync-mirror-policies).' : (m?.code === 'RP006' ? '정책 탭 = 홈페이지 공개조건을 RP006_WEB 에 손으로.' : '정책 탭 = 원본에 조건 칸이 없어 「(프리패스 기본)」.'), ''],
        ['정제칸 ← 우리 차종마스터(상품마스터 코드가 있으면 그 마스터 행 이름). 마스터에 없는 신규 차종은 먼저 마스터화하고, 그전엔 빈칸.', 'fill-supplier-ai-columns --apply --include-mirror'],
      ];
    }
    case '문패': return [['사람이 적는다(주소 정본). 공급사 시트를 새로 만들거나 바꾸면 여기 줄을 고친다 — 아직 비어 있는 새 시트를 적으면 그 공급사 재고가 통째로 0 이 된다.', 'switch-supplier-sheet.mts · tmp/hub-switch-log.txt(되돌릴 주소)']];
    case '허브': return [['문패 + 드라이브의 「프리패스 재고」 시트 + RTDB partners(대수) 를 읽어 찍는다.', 'npx tsx scripts/publish-supplier-hub.mts --apply']];
    case '판매시트': return [['문패 21곳 재고 탭(출고불가 제외) · 차명 정본(상품마스터 코드→규격채택 · 3축 결정) → 정제칸 → 원문 · 정책 43열은 각 시트 「정책」 탭 · 열 구성은 [숨김] AI 인계 @매핑 · 갈래 탭의 원본 요금 블록은 손오공 제공시트 「구독재고」/오플 정제시트 「재고」.', 'publish-origin-tab --apply → --only=RP012:구독 --tab=손오공구독 → publish-sonogong-tab → --only=RP023 --tab=오플구독 → publish-sonogong-tab --tab=오플구독']];
    case '원천대장': return [
      ['차종마스터 = Gemini/사람(원장). 상품마스터 = 문패 21곳(상태·정책·돈, sync-product-master-live) + 발행된 상품리스트 값(⑤′ sync-product-master-from-sales) + 결정 파일(차종코드).', 'run-daily ⑤·⑤′'],
    ];
    case '외부 원본': return [['공급사 담당자가 자기 방식으로 적는다.', '']];
    default: return [['아무것도 — 더 이상 갱신하지 않는다.', '']];
  }
}
function feeds(x: SheetIdentityInput): [string, string][] {
  switch (x.kind) {
    case '제공시트': case '정제시트': return FLOW_OUT_SUPPLIER(x.code || '', x.label || '').map((s) => [s, '']);
    case '문패': return [['발행기(판매시트) · 상품마스터 갱신기 · 감사 도구 — 「어느 시트를 읽을까」를 전부 여기서 정한다.', 'publish-origin-tab · sync-product-master-live · audit-*']];
    case '허브': return [['사람(사장님·팀) — 업체에 시트를 나눠 줄 때 본다. ERP partner.sheet_url 동기(관리자 화면).', 'lib/domain/sheet-hub-sync.ts']];
    case '판매시트': return [['영업자(링크 뷰어·다운로드 허용) · ⑤′ 상품마스터 맞춤(세 탭 합의 발행값이 정본 → 상품마스터 → ERP) · 돈 대조·ERP 대조도 세 탭 합.', 'sync-product-master-from-sales --apply · audit-sheet-vs-sales · audit-sales-vs-erp']];
    case '원천대장': return [['ERP v4(상품마스터 → 매일 02:00 KST 일일 동기 /api/sheet/sync-daily) · 정제칸 채우기(차량번호 정본) · 판매시트 차명(규격채택 이름).', 'vercel.json cron · sync-daily']];
    case '외부 원본': return [['우리 정제시트(미러) 한 곳뿐. 문패·발행기·상품마스터는 이 원본을 직접 읽지 않는다.', '']];
    default: return [['아무 데도 — 문패·판매시트·상품마스터·ERP 어느 것도 이 시트를 읽지 않는다.', '']];
  }
}
function cadence(x: SheetIdentityInput): string {
  switch (x.kind) {
    case '제공시트': return CADENCE_SUPPLIER;
    case '정제시트': return `원본 → 정제시트: 30분(mirror-sync.yml, main 에 있어야 돈다) 또는 사장님 수식 연동. 그 뒤는 제공시트와 같다 — ${CADENCE_SUPPLIER}`;
    case '문패': return '주소가 바뀔 때만(사람).';
    case '허브': return '문패·시트가 바뀐 뒤 publish-supplier-hub 로 다시 찍는다.';
    case '판매시트': return '매일 run-daily(자동 09:10 / 수동) 때 새 탭 「상품리스트 MM.DD HH:MM · N대」로 갈아 끼운다.';
    case '원천대장': return '상품마스터: run-daily 때 갱신·맞춤 → ERP 02:00. 원장 「차종마스터」 탭(mf-): 수시. 차명·제원 사전: 엔카 차종마스터 시트.';
    case '외부 원본': return '공급사 수시.';
    default: return '없음(폐기).';
  }
}
function fixes(x: SheetIdentityInput): [string, string][] {
  switch (x.kind) {
    case '제공시트': return [
      ['대여료·보증금·상태가 틀림 → 이 시트 재고 탭에서(판매시트·상품마스터에서 고치면 다음 발행에 사라진다). ERP 에 어떤 기간이 안 보이면 그 기간 보증금이 비어 있다(단기보증/장기보증, 무보증이면 「무보증」).', ''],
      ['정책 조건이 틀림/빔 → 이 시트 「정책」 탭. 차 이름이 틀림 → 정본(상품마스터 차종코드·결정 파일) — 정제칸을 손으로 고치지 말 것.', 'AI 운영 매뉴얼 7장'],
    ];
    case '정제시트': return [
      ['상태·대여료·차명·옵션 → 원본(공급사 시트/홈페이지)에서 — 여기서 고쳐도 다음 미러가 되돌린다. 색·연식·가격(once 칸)·정제칸·정책코드 → 여기서.', ''],
      ['원본 주소가 바뀜 → lib/domain/mirror-sources.ts(문패는 안 바뀐다).', ''],
    ];
    case '문패': return [['주소가 틀리면 여기 줄을 고치고 run-daily. 되돌릴 옛 주소는 tmp/hub-switch-log.txt.', '']];
    case '허브': return [['이 표에서 고치지 않는다 — 문패·시트를 고치고 다시 찍는다.', '']];
    case '판매시트': return [['여기서 고치지 않는다 — 공급사 시트(정제시트는 원본)·정본을 고치고 재발행. 열이 빠지면 [숨김] AI 인계 @매핑 → publish-handover-tab.', '']];
    case '원천대장': return [['차명·기간이 틀림 → 차종마스터_규격검토(Gemini) → 규격채택 재게시. 상품마스터 잠금칸(차종코드·차명)은 결정 파일 → coverage apply. ERP 가 영업자 표와 다르면 ⑤′를 돌린다(손대지 말 것).', 'AI 운영 매뉴얼 7장']];
    case '외부 원본': return [['공급사에게 — 우리는 쓰지 않는다.', '']];
    default: return [['고치지 않는다 — 지금 쓰는 시트에 적는다.', '']];
  }
}
function donts(x: SheetIdentityInput): string[] {
  switch (x.kind) {
    case '제공시트': return ['열 이름·차례 바꾸기 · 줄 지우기(안 파는 차는 상태만 출고불가) · 정제칸(보라)에 적기 · 표(Table) 삭제(값까지 지운다).'];
    case '정제시트': return ['여기서 상태·대여료·차명·옵션 고치기(되돌아간다) · 미러와 수식 연동을 같이 켜기 · 원본에 쓰기 · 열·줄 구조 바꾸기.'];
    case '문패': return ['비어 있는 새 시트 적기 · 정제시트 대신 원본 주소 적기(발행기가 원본 구조를 못 읽는다).'];
    case '허브': return ['이 표를 문패로 착각하기(코드는 「공급사시트정리」 1TVeVXyJ… 만 읽는다).'];
    case '판매시트': return ['손으로 값 고치기 · 탭 지우기 · @제외를 상품마스터 규칙으로 쓰기.'];
    case '원천대장': return ['「상품마스터」 탭 이름·머리행 바꾸기(ERP·갱신기 즉사) · 차종코드 삭제·재사용·의미변경 · 상품마스터 잠금칸 손대기.'];
    case '외부 원본': return ['우리가 여기에 쓰기.'];
    default: return ['여기에 적기 — 어디에도 반영되지 않는다.'];
  }
}

/** 구버전 시트 첫 탭 「⚠ 구버전 — 안 씀」 글(사람이 보는 4줄 + 이 시트는). */
export function buildLegacyNoticeRows(l: LegacySheet, replacement: { name: string; url: string } | null, generatedAt = ''): IdentityRow[] {
  const R: IdentityRow[] = [];
  const row = (a: string, b: string, c = '') => R.push([a, b, c]);
  row('⚠ 이 시트는 구버전입니다 — 쓰지 않습니다(폐기)', `${l.retiredOn} 부터 프리패스는 이 시트를 읽지 않습니다. 여기에 적어도 영업자 표·ERP 어디에도 반영되지 않습니다.`, '');
  row('지금 쓰는 시트', replacement ? replacement.name : '(문패 「공급사시트정리」에서 찾기)', replacement ? replacement.url : sheetUrl(HUB_CODE_SHEET_ID));
  row('왜', l.kind === '옛 제공시트' ? '2026-08-10~18 에 모든 공급사 시트를 웰릭스 표준 한 규격(「MMDD 공급사 프리패스 재고 [제공] [연동중]」)으로 새로 나눠 드렸습니다. 이 시트의 값은 새 시트로 옮겨 갔습니다(빈 칸만 채움 · 없는 차만 더함).' : `${l.kind} — ${l.note || '새 시트로 대체'}`, '');
  row('문의', '프리패스 담당자(팀제이피케이). 새 시트 링크가 필요하면 말씀해 주세요.', '');
  row('', '', '');
  const identity = buildSheetIdentityRows({ id: l.id, name: `${LEGACY_SHEET_PREFIX}${l.name}`, kind: l.kind, status: '구버전·폐기', code: l.code, owner: l.owner, legacy: l, replacementName: replacement?.name, replacementUrl: replacement?.url, generatedAt });
  R.push(...identity);
  return R;
}

/** 시트 명부 한 줄(원천대장 「시트 지도」 0장). */
export type SheetRosterRow = { status: SheetStatus; name: string; kind: SheetKind; code: string; owner: string; reads: string; feeds: string; url: string; note: string };
export const ROSTER_HEADER = ['상태', '시트', '종류', '코드', '소유', '바라보는 곳(입력)', '주는 곳(출력)', '링크', '비고'];
export const rosterRowToCells = (r: SheetRosterRow) => [r.status, r.name, r.kind, r.code, r.owner, r.reads, r.feeds, r.url, r.note];

export function rosterRowFor(x: SheetIdentityInput): SheetRosterRow {
  const readsS = reads(x).map((r) => r[0]).join(' / ');
  const feedsS = feeds(x).map((r) => r[0]).join(' / ');
  const short = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return { status: x.status, name: x.name, kind: x.kind, code: x.code || '', owner: x.owner || '', reads: short(readsS), feeds: short(feedsS), url: sheetUrl(x.id), note: x.legacy?.note || (x.mirror ? `원본: ${x.mirror.kind === 'iron' ? 'ironrentcar.com' : sheetUrl(x.mirror.from || '')}` : '') };
}

export const CORE_BOOKS: { id: string; kind: SheetKind; name: string; owner: string }[] = [
  { id: HUB_CODE_SHEET_ID, kind: '문패', name: '공급사시트정리', owner: 'dudguq@gmail.com' },
  { id: HUB_HUMAN_SHEET_ID, kind: '허브', name: '프리패스 공급사시트 정리', owner: 'pyh@teamjpk.com' },
  { id: SALES_SHEET_ID, kind: '판매시트', name: '프리패스 상품리스트', owner: 'pyh@teamjpk.com' },
  { id: MASTER_SHEET_ID, kind: '원천대장', name: '프리패스 차종마스터 원천대장', owner: 'pyh@teamjpk.com' },
];
export { LEGACY_SHEETS, MIRROR_SOURCES };
