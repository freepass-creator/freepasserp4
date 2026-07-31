/**
 * sheet-import — 렌트사별 구글시트 → 매물 취합 엔진.
 *   공급사마다 고유 시트 + mapping_profile 학습. (v3 공용 source sync 없음)
 *   흐름: CSV → adapter.prepareTable → 헤더매핑 → 차종마스터 스냅 → 차번 dedup → 매물.
 *   ★ 저장은 여기 말고 master-ingress.commitSupplierProducts (입고 SSOT).
 */
import { snapToMaster, applySnap, fuelDisplay, fuelEmbeddedCc, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { applyColors } from '@/lib/domain/color-master';
import { type EntityRecord } from '@/lib/intake/entities';
import { normalizeProductOptionsText, isRealPlate } from '@/lib/domain/product';

// ── 헤더 별칭 사전 ── 렌트사 시트 컬럼명 → 프리패스 표준 필드. 국산 렌트 시트는 대동소이 → 자동 90%.
export const HEADER_ALIASES: Record<string, string> = {
  차량번호: 'car_number', 차번: 'car_number', 번호판: 'car_number', 등록번호: 'car_number',
  제조사: 'maker', 메이커: 'maker', 브랜드: 'maker', 제조회사: 'maker',
  모델: 'model', 차명: 'model',
  // 오토플러스: 차종=숏모델, 모델명(트림풀명)=풀표기→트림. 일반시트 모델명만 있으면 model(아래 정확키 우선).
  '모델명(트림풀명)': 'trim_name', 모델명: 'model',
  세부모델: 'sub_model', 세부: 'sub_model', 상세모델: 'sub_model', 세부차명: 'sub_model',
  트림: 'trim_name', 세부트림: 'trim_name', 등급: 'trim_name', 세부등급: 'trim_name',
  추가표기: 'trim_extra', 추가입력: 'trim_extra', 부가표기: 'trim_extra',
  연식: 'year', 년식: 'year',
  최초등록: 'first_registration_date', 최초등록일: 'first_registration_date', 등록일: 'first_registration_date', 등록년월: 'first_registration_date',
  연료: 'fuel_type', 유종: 'fuel_type', 연료타입: 'fuel_type',
  배기량: 'engine_cc', cc: 'engine_cc', 배기: 'engine_cc',
  주행: 'mileage', 주행거리: 'mileage', 누적주행: 'mileage', 키로수: 'mileage', km: 'mileage', 미터: 'mileage',
  색상: 'ext_color', 외장: 'ext_color', 외장색: 'ext_color', 외관색: 'ext_color', 컬러: 'ext_color', 외장색상: 'ext_color',
  내장: 'int_color', 내장색: 'int_color', 실내색: 'int_color', 내장색상: 'int_color',
  인승: 'seats', 승차인원: 'seats', 승차: 'seats',
  변속기: 'transmission', 변속: 'transmission', 미션: 'transmission',
  // 렌트시트 「차종」=모델명(쏘나타). 세그먼트×차형 = 차종분류(구 차급).
  차종: 'model',
  차종분류: 'vehicle_class', 차급: 'vehicle_class',
  상태: 'vehicle_status', 판매상태: 'vehicle_status', 재고상태: 'vehicle_status',
  구분: 'product_type', 상품구분: 'product_type', 렌트구분: 'product_type',
  사진: 'photo_link', 사진링크: 'photo_link', 이미지: 'photo_link', 사진url: 'photo_link', 이미지링크: 'photo_link',
  옵션: 'options', 선택옵션: 'options',
  메모: 'partner_memo', 비고: 'partner_memo', 특이사항: 'partner_memo',
};

// 매핑 대상 표준 필드(에디터 드롭다운). 라벨=한글, key=매물 필드.
export const IMPORT_FIELDS: { key: string; label: string }[] = [
  { key: 'car_number', label: '차량번호' }, { key: 'maker', label: '제조사' }, { key: 'model', label: '모델' },
  { key: 'sub_model', label: '세부모델' }, { key: 'trim_name', label: '트림' }, { key: 'trim_extra', label: '추가표기' }, { key: 'year', label: '연식' },
  { key: 'first_registration_date', label: '최초등록일' }, { key: 'fuel_type', label: '연료' }, { key: 'engine_cc', label: '배기량' },
  { key: 'mileage', label: '주행거리' }, { key: 'ext_color', label: '외장색' }, { key: 'int_color', label: '내장색' },
  { key: 'seats', label: '인승' }, { key: 'transmission', label: '변속기' }, { key: 'vehicle_class', label: '차종분류' },
  { key: 'vehicle_status', label: '상태' }, { key: 'product_type', label: '구분' }, { key: 'photo_link', label: '사진링크' },
  { key: 'options', label: '옵션' }, { key: 'partner_memo', label: '메모' },
];

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

/**
 * 시트 판매상태 → VEHICLE_STATES.
 * 연동 판단 SSOT: 시트에 차번이 있으면 데이터화하고, **출고불가 여부**만 규격 상태로 맞춘다.
 *  · 보류·불가·완료 → 출고불가
 *  · 계약중 → 계약중
 *  · 판매중·할인판매·가능·빈값 → 출고가능 (오토플러스 등)
 *  · 이미 규격값이면 그대로
 */
/**
 * 시트 상태 → 상품상태(VEHICLE_STATES 6종). **운영 규칙 2026-07-31 확정.**
 *
 * 큰 원칙: **출고불가가 아니면 다 올린다.** 애매하면 출고협의로 올려 두고 영업자가 확인한다.
 * 예전엔 배차중·운행중을 유입에서 아예 걸렀는데(isSheetExcluded), 그건 틀렸다 —
 * **배차중 = 단기·월렌트로 잠깐 나가 있는 차**라서 반납 시점 협의가 가능한 상품이다.
 * 실측(16개 공급사 시트)에서 배차중이 1,832대로 최다였고, 그걸 버리면 카탈로그의 대부분이 사라졌다.
 *
 * 판정 순서(위가 우선):
 *   1. 6종 정확 일치 → 그대로
 *   2. 이미 나간 차(출고완·판매완료·반납·폐차·말소) → 출고불가
 *   3. '불가' 포함 → 출고불가
 *   4. 지금 팔 수 있다는 표현(판매중·할인판매) → 출고가능   ← 오토플러스 87대
 *   5. 상품화 → 상품화중                                  ← "상품화 준비중"
 *   6. 계약 → 계약중
 *   7. 나머지 전부 → 출고협의  (배차중·배차대기·보류·재렌트·"8월3일이후출고가능" 등)
 */
export function canonSheetVehicleStatus(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '출고협의'; // 상태칸이 없는 시트 — 함부로 출고가능으로 보지 않는다
  if (s === '즉시출고' || s === '출고가능' || s === '상품화중' || s === '출고협의' || s === '계약중' || s === '출고불가') return s;
  // ① '출고가능'으로 시작하면 뒤에 뭐가 붙어도 출고가능(erp3 이식).
  //    '출고가능(대차중)'·'출고가능3일이내'·'출고가능(정비중)' 이 아래 불가 regex 의 '대차'에
  //    먼저 걸려 뒤집히는 사고를 막는 순서다 — 이 줄을 아래로 내리면 안 된다.
  if (/^출고\s?가능/.test(s)) return '출고가능';
  // ② 이미 나갔거나 팔린 차 — '불가'라는 말이 없어도 상품이 아니다.
  //    실측 어휘(2026-07-31 전 공급사 시트): 출고완료 140 · 매각 14 · 매각검토 7 · 판매완료 3 · 사고대차 1 · 차량미정 1
  if (/출고완|판매완료|매각|반납|폐차|말소|회수|사고|보류|미정|대차|sold/i.test(s)) return '출고불가';
  // ③ '불가' 계열 — 오타 포함. 실측: 출보불가 1 · 출고블가 2 · '출고 불가' 4 · 출고불 1
  if (/불\s?가|블가|보불가|^출고불$/.test(s)) return '출고불가';
  if (/판매중|할인판매|promo/i.test(s)) return '출고가능';
  if (/상품화/.test(s)) return '상품화중';
  if (/^계약/.test(s)) return '계약중';
  return '출고협의';
}

/**
 * 유입에서 제외할 행 — **상태가 출고불가로 판정되는 것.**
 * 운영 규칙(2026-07-31): "출고불가가 아니면 다 올린다" = 출고불가는 올리지 않는다.
 * 판정은 canonSheetVehicleStatus 하나로 통일한다 —
 * '출고불가'·'~불가'·'출고완료'·'판매완료'·'폐차'·'말소'가 전부 여기로 모인다.
 *
 * ※ 시트에 아예 없는 차를 출고불가로 내리는 **부재처리와는 다른 이야기다**(그건 기존 매물의 상태 변경).
 */
export function isSheetExcluded(raw: unknown): boolean {
  return canonSheetVehicleStatus(raw) === '출고불가';
}

/** 헤더 자동매핑 — 정확일치 → 정규화일치 → 부분일치(별칭 긴 키 우선). 반환 = {표준필드: 컬럼인덱스}(첫 매칭 우선). */
/**
 * 헤더칸이 상태 컬럼명이 아니라 상태값 자체인 경우(아이카: 0번 열 헤더 = "즉시출고").
 * 이런 열은 상태값이 들어있는 상태 컬럼이므로 vehicle_status로 인식.
 * (상태 별칭 상태·판매상태·재고상태가 우선. 이건 그게 없을 때의 폴백)
 */
const STATUS_VALUE_HEADER = /^(즉시출고|출고가능|출고불가|출고협의|상품화중|계약중|배차중|배차대기|입고대기|판매중|할인판매|출고상태|배차상태|출고현황)$/;

/**
 * 판매 가능 여부를 담은 컬럼 — **정확일치·우선순위 탐색**(erp3 STATUS_COL_NAMES 이식).
 *
 * ⚠ 부분일치로 '상태'를 찾으면 안 된다. 종합시트 표준 헤더는
 *   `차량상태 | 배차상태 | 입고일자 | 구분 | 차량번호 | …` 로 상태칸이 **둘**인데,
 *   차량상태는 정상/정비중/대차중/매각검토(물리 컨디션)이고 배차상태가 출고가능/출고불가다.
 *   앞에 있는 차량상태를 잡으면 전 매물이 "정상 → 출고협의"로 뭉개진다.
 */
const STATUS_COL_PRIORITY = ['배차상태', '상태', '판매상태', '즉시출고', '재고상태', '출고상태', '출고현황'];

/** 상태 컬럼으로 **쓰면 안 되는** 헤더 — 판매 가능 여부가 아닌 다른 축. */
const NOT_STATUS_COL = /^(차량상태|정비상태|사고상태)$/;

export function autoMapHeaders(headers: string[]): MappingProfile {
  const map: MappingProfile = {};
  const norms = headers.map((h) => norm(String(h ?? '').trim()));
  // 1) 상태 컬럼 먼저 — 우선순위대로 정확일치. 뒤 루프의 부분일치가 못 덮게 선점한다.
  for (const name of STATUS_COL_PRIORITY) {
    const i = norms.indexOf(norm(name));
    if (i >= 0) { map.vehicle_status = i; break; }
  }
  const aliasKeys = Object.keys(HEADER_ALIASES).sort((a, b) => b.length - a.length);
  headers.forEach((h, i) => {
    const t = String(h ?? '').trim();
    if (!t) return;
    let field = HEADER_ALIASES[t] || HEADER_ALIASES[norm(t)];
    if (!field) {
      const k = aliasKeys.find((a) => norm(t).includes(norm(a)));
      if (k) field = HEADER_ALIASES[k];
    }
    // 폴백: 헤더가 상태값 자체면 상태 컬럼(아이카 (구)종합: 0번 열 헤더 = "즉시출고").
    if (!field && !('vehicle_status' in map) && STATUS_VALUE_HEADER.test(norm(t))) field = 'vehicle_status';
    if (field === 'vehicle_status' && NOT_STATUS_COL.test(norm(t))) return;
    if (field && !(field in map)) map[field] = i;
  });
  return map;
}

/** 클라이언트: 구글시트 URL → 표(table). /api/sheet 경유(CORS 회피). 실패 시 throw(사유 포함). */
export async function fetchSheetTable(url: string, gid?: string): Promise<string[][]> {
  const r = await fetch(`/api/sheet?url=${encodeURIComponent(url)}${gid ? `&gid=${encodeURIComponent(gid)}` : ''}`);
  const d = await r.json().catch(() => ({ ok: false, error: '응답 파싱 실패' }));
  if (!d.ok) throw new Error(d.error || `시트 로드 실패 (${r.status})`);
  return parseDelimited(String(d.csv || ''));
}

/** CSV/TSV 파서 — 따옴표 안 콤마·개행 처리. 빈 행 제거. */
export function parseDelimited(text: string, delim = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

/** 매핑 프로파일 = {표준필드: 컬럼인덱스}. partner.mapping_profile 에 JSON 저장 → 다음 당길 때 재사용(학습). */
export type MappingProfile = Record<string, number>;

export type ImportResult = {
  products: EntityRecord[];
  mapping: MappingProfile;   // 사용된 매핑(자동이면 이걸 프로파일로 저장)
  total: number; imported: number; skipped: number;
  excludedCount: number;    // 배차중·운행중·렌트중 등 '이미 나간 차' — 상품 아님(유입 제외)
  snap: { high: number; medium: number; low: number; none: number };
};

// 수입 브랜드(v3 IMPORT_BRAND_KEYWORDS 이식) — 보증금 컬럼 없는 시트에서 배율 판정(수입3·국산2).
const IMPORT_BRANDS = ['bmw', 'benz', 'mercedes', '벤츠', 'audi', '아우디', 'volvo', '볼보', 'lexus', '렉서스',
  'porsche', '포르쉐', 'jaguar', '재규어', 'land rover', '랜드로버', 'mini', '미니', 'volkswagen', '폭스바겐', 'peugeot',
  '푸조', 'maserati', '마세라티', 'bentley', '벤틀리', 'rolls', '롤스', 'ferrari', '페라리', 'lamborghini', '람보르기니',
  'tesla', '테슬라', 'lincoln', '링컨'];
export function isImportBrand(name: string): boolean {
  const nl = String(name || '').toLowerCase();
  return IMPORT_BRANDS.some((b) => nl.includes(b));
}
const digits = (s: unknown) => Number(String(s ?? '').replace(/[^\d]/g, '')) || 0;

/**
 * 보증금 칸 — **숫자 칸일 때만** 값으로 인정한다.
 *
 * 실측(손오공·종합시트): 장기보증 칸에 금액이 아니라 규칙 문장이 들어 있다 —
 *   "12개월 : 1개월치 / 24개월 : 2개월치 / 36개월 : 3개월치 …"
 * digits() 를 그대로 먹이면 1212243364485605 같은 숫자가 보증금으로 게시된다.
 * 그래서 콤마·공백·원/만원 정도만 붙은 순수 금액 칸만 통과시킨다.
 */
function depositCell(s: unknown): number {
  const t = String(s ?? '').trim();
  if (!t) return 0;
  if (!/^[\d,\s]+(원|만원)?$/.test(t)) return 0;
  const n = digits(t);
  return n > 0 && n <= 100_000_000 ? n : 0;
}
// 결정적 짧은 해시 — 번호없는 신차 임시번호(재동기화 멱등: 같은 신원 → 같은 번호).
function shortHash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 4).toUpperCase().padStart(4, '0');
}

/**
 * 시트 가격 컬럼 파싱(v3 오토플러스식 이식) — 기간별 대여료(+주행 변형 24개월_3만) → price 맵.
 * 보증금: 단기/장기보증·보증금 컬럼 있으면 그 값, 없으면(오토플러스식) 대여료×배율(수입3·국산2, isImportBrand 판정).
 * 원단위 정규화·이상치는 priceList가 read-time으로 처리 → 여기선 원시 추출만.
 */
export function parsePriceColumns(headers: string[], cells: string[], rec: EntityRecord): Record<string, { rent: number; deposit: number }> | null {
  // 보증 컬럼은 **자기 뒤의 기간 컬럼들을 관할한다**(블록 스코프).
  //  실측 레이아웃이 전부 이 모양이다:
  //   아이카/우리캐피탈  단기보증 | 1·6·12개월 | 장기보증 | 24·36·48·60개월
  //   손오공/웰릭스      보증금 | 12~60개월(인수형) | 보증금 | 12~60개월(반납형)
  //  예전엔 보증 컬럼을 시트 전체에서 하나로 뭉쳐(flatDep) **뒤에 나온 게 앞을 이겼다.**
  //  그래서 손오공 인수형 요율에 반납형 빈 보증금칸이 붙고, 빈칸이라 아래 ×배율 폴백이 걸려
  //  **시트 어디에도 없는 보증금이 만들어졌다**(375어8056: 시트 3,150,000 → 저장 1,814,000).
  const cols: { key: string; period: number; idx: number; dep: number }[] = [];
  let curDep = -1;          // 지금 블록을 관할하는 보증 컬럼
  let shortDep = -1, longDep = -1;
  let anyDepCol = false;
  headers.forEach((h, i) => {
    // 공백·슬래시 변형 흡수: "12개월 3만" · "12개월3만" · 오토플러스 "12/3만"
    const t = String(h ?? '').trim().replace(/\s+/g, '');
    const pm = /^(\d+)개월([1-9]\d*만)?/.exec(t) || /^(\d+)[/／]([1-9]\d*만)/.exec(t);
    if (pm) {
      const period = Number(pm[1]);
      const km = pm[2] || '';
      cols.push({
        key: km ? `${period}_${km}` : String(period),
        period, idx: i,
        dep: curDep >= 0 ? curDep : (period >= 24 ? longDep : shortDep),
      });
      return;
    }
    if (/단기.*보증/.test(t)) { shortDep = i; curDep = i; anyDepCol = true; }
    else if (/장기.*보증/.test(t)) { longDep = i; curDep = i; anyDepCol = true; }
    else if (/보증/.test(t)) { curDep = i; anyDepCol = true; }
  });
  if (!cols.length) return null;
  // 수입판정 = 스냅 후 maker + 원본 모델/트림 표기(시트에 제조사칸 없을 때)
  const brandBlob = `${rec.maker || ''} ${rec.model || ''} ${rec.sub_model || ''} ${rec.trim_name || ''} ${(rec._raw_vehicle as EntityRecord | undefined)?.trim_name || ''}`;
  const depMult = isImportBrand(brandBlob) ? 3 : 2;
  const price: Record<string, { rent: number; deposit: number }> = {};
  // 같은 기간이 여러 블록에 있으면 **값이 있는 마지막 블록**을 쓴다.
  //  손오공·웰릭스는 인수형(왼쪽)·반납형(오른쪽) 두 벌인데, 종합시트가 실제로 게시하는 건 반납형이다
  //  (실측 375어8056: 종합 12개월 907,000 = 개별시트 반납형 값). 차마다 한쪽만 채우기도 해서
  //  "행에 값이 있는 쪽"을 골라야 한다 — 헤더만 보고 한 블록을 통째로 버리면 161허1397 처럼
  //  반납형에만 값이 있는 차가 가격 없이 올라간다.
  for (const { key, idx, dep } of cols) {
    const rent = digits(cells[idx]);
    if (!rent) continue;
    const colDep = dep >= 0 ? depositCell(cells[dep]) : 0;
    if (colDep) { price[key] = { rent, deposit: colDep }; continue; }
    // 보증 컬럼이 시트에 **아예 없으면** 오토플러스식 — 대여료×배율(수입3·국산2)이 그 시트의 규칙이다.
    if (!anyDepCol) { price[key] = { rent, deposit: rent * depMult }; continue; }
    // 보증 컬럼은 있는데 이 행·이 블록만 비었다 → **숫자를 만들어내지 않는다.**
    //  deposit:0 은 화면에서 무보증을 뜻하므로(product.ts isDepositFree) 0으로도 쓰면 안 된다.
    //  예전엔 여기서 rent×배율로 채워 시트에 없는 보증금을 게시했다
    //  (375어8056: 시트 3,150,000 → 저장 1,814,000). 보증금을 말할 수 없는 기간은 빼고 간다.
    delete price[key];
  }
  return Object.keys(price).length ? price : null;
}

/**
 * 시트 표 → 매물 취합. delimited → 매핑 → 차종스냅 → 차번 dedup.
 *   ★ entries(마스터) 필수. 저장은 master-ingress.commitSupplierProducts.
 */
export function importSheetTable(table: string[][], opts: {
  providerCode: string; entries: MasterEntry[]; profile?: MappingProfile;
}): ImportResult {
  if (!opts.entries?.length) throw new Error('차종마스터 필수 — importSheetTable');
  const headers = table[0] || [];
  const dataRows = table.slice(1);
  const mapping = (opts.profile && Object.keys(opts.profile).length) ? { ...opts.profile } : autoMapHeaders(headers);
  // 저장된 프로파일에 상태열이 없으면(구버전 매핑) 상태열 자동탐지로 보강.
  // 없으면 rec.vehicle_status가 안 채워져 출고불가 제외·상태동기화가 통째로 안 걸림(아이카 "즉시출고" 헤더 케이스).
  if (!('vehicle_status' in mapping)) {
    const autoStatus = autoMapHeaders(headers).vehicle_status;
    if (autoStatus !== undefined) mapping.vehicle_status = autoStatus;
  }
  const products: EntityRecord[] = [];
  const seen = new Set<string>();
  const snap = { high: 0, medium: 0, low: 0, none: 0 };
  let skipped = 0;
  let excludedCount = 0;
  for (const cells of dataRows) {
    const rec: EntityRecord = {};
    for (const [field, idx] of Object.entries(mapping)) { const v = String(cells[idx] ?? '').trim(); if (v) rec[field] = v; }
    if (rec.options) rec.options = normalizeProductOptionsText(rec.options);
    // **출고불가는 올리지 않는다**(2026-07-31 규칙). 그 외는 다 올린다 —
    //  배차중은 단기·월렌트로 잠깐 나간 차라 출고협의 상품이다(예전엔 여기서 버려 아이카 1,832대가 사라졌다).
    if (isSheetExcluded(rec.vehicle_status)) { excludedCount++; continue; }
    let car = String(rec.car_number || '').replace(/\s/g, '');
    // 안내문구·배너가 차량번호 칸에 들어온 경우 버림(오토플러스 ★★★프로모션… 등)
    if (car && !isRealPlate(car)) {
      rec.car_number = '';
      car = '';
    }
    if (!car) {
      // 번호없는 신차 구제(v3 이식) — 차종정보 있으면 100신XXXX 임시번호(멱등: 공급사+신원 해시)+신차렌트. 진짜 빈행만 skip.
      const ident = `${rec.maker || ''}${rec.model || ''}${rec.sub_model || ''}${rec.trim_name || ''}${rec.year || ''}`.replace(/\s/g, '');
      if (!ident) { skipped++; continue; }
      car = `100신${shortHash(opts.providerCode + ident)}`;
      rec.car_number = car;
      rec.is_pending_plate = true;
      rec.product_type = '신차렌트';
    }
    if (seen.has(car)) { skipped++; continue; }   // 시트 내 차번(임시번호 포함) 중복 제거
    seen.add(car);
    rec.provider_company_code = opts.providerCode;
    rec.partner_code = opts.providerCode;
    rec.product_code = `${opts.providerCode}_${car}`;      // 식별 = 공급사_차번(오플식)
    rec.source = 'sheet';
    rec.source_schema = opts.providerCode;                 // 공급사별 소스 태깅 → "이 렌트사만 빼기" 한방
    if (rec.vehicle_status) {
      rec.status_label_raw = String(rec.vehicle_status);
      rec.vehicle_status = canonSheetVehicleStatus(rec.vehicle_status);
    } else {
      rec.vehicle_status = '출고가능';
    }
    if (!rec.product_type) rec.product_type = '중고렌트';
    // 연료칸 "가솔린1.0"·"LPG3.0" → 연료/배기 분리
    if (rec.fuel_type) {
      const fuel = fuelDisplay(rec.fuel_type);
      const cc = fuelEmbeddedCc(rec.fuel_type);
      if (fuel) rec.fuel_type = fuel;
      if (cc > 0 && !rec.engine_cc) rec.engine_cc = String(cc);
    }
    // 값 정규화 = 차종마스터 스냅 — 항상(entries 필수)
    const res = snapToMaster(rec, opts.entries);
    if (res) { Object.assign(rec, applySnap(rec, res, { source: 'ingress' })); snap[res.confidence]++; } else snap.none++;
    Object.assign(rec, applyColors(rec));
    // 가격 — 기간별 대여료 컬럼 파싱(+보증금 컬럼 or 오토플러스식 배율 파생). snap 후 maker 확정 시점.
    const price = parsePriceColumns(headers, cells, rec);
    if (price) rec.price = price;
    products.push(rec);
  }
  return { products, mapping, total: dataRows.length, imported: products.length, skipped, excludedCount, snap };
}

/**
 * 입고 직전 — 마스터 틀에 확정된 것(high·중) vs 검수 필요(검토·미매칭) 표시.
 * 공급사 기본정보는 모두 저장하되, 확정만 규격 경로·검수는 _needs_master_review.
 */
export function prepareMasterIngress(products: EntityRecord[]): {
  products: EntityRecord[];
  confirmed: number;
  review: number;
} {
  let confirmed = 0;
  let review = 0;
  const out = products.map((p) => {
    const c = String(p._snap_confidence || '');
    const ok = !!p._snapped && (c === 'high' || c === 'medium');
    if (ok) {
      confirmed++;
      return { ...p, _needs_master_review: false };
    }
    review++;
    return { ...p, _needs_master_review: true };
  });
  return { products: out, confirmed, review };
}
