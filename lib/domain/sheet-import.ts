/**
 * sheet-import — 렌트사별 구글시트 → 매물 취합 엔진.
 *   공급사마다 고유 시트 + mapping_profile 학습. (v3 공용 source sync 없음)
 *   흐름: CSV → adapter.prepareTable → 헤더매핑 → 차종마스터 스냅 → 차번 dedup → 매물.
 *   ★ 저장은 여기 말고 master-ingress.commitSupplierProducts (입고 SSOT).
 */
import { snapToMaster, applySnap, fuelDisplay, fuelEmbeddedCc, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { applyColors } from '@/lib/domain/color-master';
import { type EntityRecord } from '@/lib/intake/entities';

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
  // 렌트시트 「차종」=모델명(쏘나타). 세그먼트는 차급만. 차종분류=종합표 모델칸.
  차종분류: 'model', 차종: 'model', 차급: 'vehicle_class',
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
  { key: 'seats', label: '인승' }, { key: 'transmission', label: '변속기' }, { key: 'vehicle_class', label: '차급' },
  { key: 'vehicle_status', label: '상태' }, { key: 'product_type', label: '구분' }, { key: 'photo_link', label: '사진링크' },
  { key: 'options', label: '옵션' }, { key: 'partner_memo', label: '메모' },
];

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

/** 헤더 자동매핑 — 정확일치 → 정규화일치 → 부분일치(별칭 긴 키 우선). 반환 = {표준필드: 컬럼인덱스}(첫 매칭 우선). */
export function autoMapHeaders(headers: string[]): MappingProfile {
  const map: MappingProfile = {};
  const aliasKeys = Object.keys(HEADER_ALIASES).sort((a, b) => b.length - a.length);
  headers.forEach((h, i) => {
    const t = String(h ?? '').trim();
    if (!t) return;
    let field = HEADER_ALIASES[t] || HEADER_ALIASES[norm(t)];
    if (!field) {
      const k = aliasKeys.find((a) => norm(t).includes(norm(a)));
      if (k) field = HEADER_ALIASES[k];
    }
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
  const cols: { key: string; period: number; idx: number }[] = [];
  let shortDep = -1, longDep = -1, flatDep = -1;
  headers.forEach((h, i) => {
    // 공백·슬래시 변형 흡수: "12개월 3만" · "12개월3만" · 오토플러스 "12/3만"
    const t = String(h ?? '').trim().replace(/\s+/g, '');
    const pm = /^(\d+)개월([1-9]\d*만)?/.exec(t) || /^(\d+)[/／]([1-9]\d*만)/.exec(t);
    if (pm) {
      const period = Number(pm[1]);
      const km = pm[2] || '';
      cols.push({ key: km ? `${period}_${km}` : String(period), period, idx: i });
      return;
    }
    if (/단기.*보증/.test(t)) shortDep = i;
    else if (/장기.*보증/.test(t)) longDep = i;
    else if (/보증/.test(t)) flatDep = i;
  });
  if (!cols.length) return null;
  // 수입판정 = 스냅 후 maker + 원본 모델/트림 표기(시트에 제조사칸 없을 때)
  const brandBlob = `${rec.maker || ''} ${rec.model || ''} ${rec.sub_model || ''} ${rec.trim_name || ''} ${(rec._raw_vehicle as EntityRecord | undefined)?.trim_name || ''}`;
  const depMult = isImportBrand(brandBlob) ? 3 : 2;
  const sDep = shortDep >= 0 ? digits(cells[shortDep]) : 0;
  const lDep = longDep >= 0 ? digits(cells[longDep]) : 0;
  const fDep = flatDep >= 0 ? digits(cells[flatDep]) : 0;
  const price: Record<string, { rent: number; deposit: number }> = {};
  for (const { key, period, idx } of cols) {
    const rent = digits(cells[idx]);
    if (!rent) continue;
    // 보증 컬럼 값 있으면 우선, 헤더만 있고 칸이 비면(오토플러스식) 대여료×배율
    const colDep = fDep || (period >= 24 ? lDep : sDep) || 0;
    const deposit = colDep || rent * depMult;
    price[key] = { rent, deposit };
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
  const mapping = (opts.profile && Object.keys(opts.profile).length) ? opts.profile : autoMapHeaders(headers);
  const products: EntityRecord[] = [];
  const seen = new Set<string>();
  const snap = { high: 0, medium: 0, low: 0, none: 0 };
  let skipped = 0;
  for (const cells of dataRows) {
    const rec: EntityRecord = {};
    for (const [field, idx] of Object.entries(mapping)) { const v = String(cells[idx] ?? '').trim(); if (v) rec[field] = v; }
    let car = String(rec.car_number || '').replace(/\s/g, '');
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
    if (!rec.vehicle_status) rec.vehicle_status = '출고가능';
    if (!rec.product_type) rec.product_type = '재렌트';
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
  return { products, mapping, total: dataRows.length, imported: products.length, skipped, snap };
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
