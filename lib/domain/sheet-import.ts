/**
 * sheet-import — 렌트사별 구글시트 → 매물 취합 엔진. "오플처럼" 공급사마다 양식 학습해 불러오기.
 *   흐름: CSV파싱 → 헤더 자동매핑(공급사별 프로파일) → 차종마스터 스냅(값 정규화) → 차번 dedup → 매물.
 *   학습 2겹: ① 컬럼매핑(어느 칸이 뭔지 = 공급사별 profile) ② 값정규화(차종마스터 = 공통).
 */
import { snapToMaster, applySnap, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { type EntityRecord } from '@/lib/intake/entities';

// ── 헤더 별칭 사전 ── 렌트사 시트 컬럼명 → 프리패스 표준 필드. 국산 렌트 시트는 대동소이 → 자동 90%.
export const HEADER_ALIASES: Record<string, string> = {
  차량번호: 'car_number', 차번: 'car_number', 번호판: 'car_number', 등록번호: 'car_number',
  제조사: 'maker', 메이커: 'maker', 브랜드: 'maker', 제조회사: 'maker',
  모델: 'model', 차명: 'model', 모델명: 'model',
  세부모델: 'sub_model', 세부: 'sub_model', 상세모델: 'sub_model', 세부차명: 'sub_model',
  트림: 'trim_name', 등급: 'trim_name', 세부등급: 'trim_name',
  연식: 'year', 년식: 'year',
  최초등록: 'first_registration_date', 최초등록일: 'first_registration_date', 등록일: 'first_registration_date', 등록년월: 'first_registration_date',
  연료: 'fuel_type', 유종: 'fuel_type', 연료타입: 'fuel_type',
  배기량: 'engine_cc', cc: 'engine_cc', 배기: 'engine_cc',
  주행: 'mileage', 주행거리: 'mileage', 키로수: 'mileage', km: 'mileage', 미터: 'mileage',
  색상: 'ext_color', 외장색: 'ext_color', 외관색: 'ext_color', 컬러: 'ext_color', 외장색상: 'ext_color',
  내장색: 'int_color', 실내색: 'int_color', 내장색상: 'int_color',
  인승: 'seats', 승차인원: 'seats', 승차: 'seats',
  변속기: 'transmission', 미션: 'transmission',
  차종: 'vehicle_class', 차급: 'vehicle_class',
  상태: 'vehicle_status', 판매상태: 'vehicle_status', 재고상태: 'vehicle_status',
  구분: 'product_type', 상품구분: 'product_type', 렌트구분: 'product_type',
  사진: 'photo_link', 사진링크: 'photo_link', 이미지: 'photo_link', 사진url: 'photo_link', 이미지링크: 'photo_link',
  옵션: 'options', 선택옵션: 'options',
  메모: 'partner_memo', 비고: 'partner_memo', 특이사항: 'partner_memo',
};

// 매핑 대상 표준 필드(에디터 드롭다운). 라벨=한글, key=매물 필드.
export const IMPORT_FIELDS: { key: string; label: string }[] = [
  { key: 'car_number', label: '차량번호' }, { key: 'maker', label: '제조사' }, { key: 'model', label: '모델' },
  { key: 'sub_model', label: '세부모델' }, { key: 'trim_name', label: '트림' }, { key: 'year', label: '연식' },
  { key: 'first_registration_date', label: '최초등록일' }, { key: 'fuel_type', label: '연료' }, { key: 'engine_cc', label: '배기량' },
  { key: 'mileage', label: '주행거리' }, { key: 'ext_color', label: '외장색' }, { key: 'int_color', label: '내장색' },
  { key: 'seats', label: '인승' }, { key: 'transmission', label: '변속기' }, { key: 'vehicle_class', label: '차종' },
  { key: 'vehicle_status', label: '상태' }, { key: 'product_type', label: '구분' }, { key: 'photo_link', label: '사진링크' },
  { key: 'options', label: '옵션' }, { key: 'partner_memo', label: '메모' },
];

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

/** 헤더 자동매핑 — 정확일치 → 정규화일치 → 부분일치. 반환 = {표준필드: 컬럼인덱스}(첫 매칭 우선). */
export function autoMapHeaders(headers: string[]): MappingProfile {
  const map: MappingProfile = {};
  const used = new Set<number>();
  headers.forEach((h, i) => {
    const t = String(h ?? '').trim();
    if (!t) return;
    let field = HEADER_ALIASES[t] || HEADER_ALIASES[norm(t)];
    if (!field) { const k = Object.keys(HEADER_ALIASES).find((a) => norm(t).includes(norm(a))); if (k) field = HEADER_ALIASES[k]; }
    if (field && !(field in map)) { map[field] = i; used.add(i); }
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

/**
 * 시트 표 → 매물 취합. delimited(header행+데이터행) → 매핑 → 차종스냅 → 차번 dedup.
 *   opts.profile 있으면 그걸로(학습된 매핑), 없으면 autoMap. entries 있으면 차종마스터 스냅.
 */
export function importSheetTable(table: string[][], opts: {
  providerCode: string; entries?: MasterEntry[] | null; profile?: MappingProfile;
}): ImportResult {
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
    const car = String(rec.car_number || '').replace(/\s/g, '');
    if (!car) { skipped++; continue; }
    if (seen.has(car)) { skipped++; continue; }   // 시트 내 차번 중복 제거
    seen.add(car);
    rec.provider_company_code = opts.providerCode;
    rec.partner_code = opts.providerCode;
    rec.product_code = `${opts.providerCode}_${car}`;      // 식별 = 공급사_차번(오플식)
    rec.source = 'sheet';
    rec.source_schema = opts.providerCode;                 // 공급사별 소스 태깅 → "이 렌트사만 빼기" 한방
    if (!rec.vehicle_status) rec.vehicle_status = '출고가능';
    if (!rec.product_type) rec.product_type = '재렌트';
    // 값 정규화 = 차종마스터 스냅(공통 학습)
    if (opts.entries && opts.entries.length) {
      const res = snapToMaster(rec, opts.entries);
      if (res) { Object.assign(rec, applySnap(rec, res)); snap[res.confidence]++; } else snap.none++;
    }
    products.push(rec);
  }
  return { products, mapping, total: dataRows.length, imported: products.length, skipped, snap };
}
