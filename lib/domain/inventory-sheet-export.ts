/**
 * 재고 → 영업자용 구글시트 (순수 함수 · 네트워크 없음).
 *
 * CLI(`scripts/export-products-to-sheet.mts`)와 앱 버튼(`/api/inventory/sheet-export`)이
 * **이 파일 하나**를 쓴다. 두 경로가 각자 표를 만들면 영업자가 보는 시트가 갈린다.
 *
 * ── 화면 구성 (탭 한 장) ──────────────────────────────────────────────
 *   제목 → 조회바(드롭다운·숫자·검색·정렬) → 요약칩 → 결과표 → 오른쪽 상세 패널
 *   원본 31열은 같은 시트 오른쪽 끝(AO~)에 **숨겨** 두고 수식이 읽는다.
 *
 * 탭을 둘로 나누지 않는 이유: 영업자가 오갈 곳이 늘고, 원본 탭을 실수로 고치면
 * 결과가 조용히 틀어진다. 한 장에서 끝낸다.
 *
 * ★내보내지 않는 것 — 원가·수수료·차대번호·내부메모.
 *   링크만 있으면 열리는 외부 문서다. HEADERS 에 원가성 필드를 추가하지 마라.
 */
import { canonProductType, creditDisplay, excelCondSignals, priceList } from '@/lib/domain/product';
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : '';
};

/** 앱 엑셀보기와 같은 기간열. 그 밖의 기간은 「기타기간」 한 칸에 모은다. */
export const MONTHS = [12, 18, 24, 36, 48, 60];

/**
 * 원본(숨김) 열 구성. 앞 17열은 앱 «엑셀보기»(`features/finder/ExcelResultsTable.tsx`)와
 * **완전히 같은 순서** — 화면과 시트를 나란히 놓고 대조할 수 있어야 한다. 끼워넣지 마라.
 *
 * 보증금은 기간마다 다르다(실측 348대 중 220대). 그래서 기간마다 짝으로 붙인다 —
 * 하나만 고르면 다른 기간의 보증금이 사라져 영업자가 틀린 금액을 안내하게 된다.
 */
export const HEADERS = [
  // 상품코드 = 손님 카탈로그 링크(/q/{코드})를 만드는 데만 쓴다. 표에서는 숨긴다.
  '상품코드',
  '차량번호', '상태', '상품', '제조사', '모델', '세부모델', '파워', '트림', '옵션',
  '외장', '내장', '연식', '주행', '연료', '공급사', '심사', '조건',
  ...MONTHS.flatMap((m) => [`${m}개월`, `${m}개월 보증금`]),
  '기타기간',
  '운전연령', '연령하향', '면허경력', '보험', '자차부담', '운전범위',
  '비고',
];
export const COL = (name: string) => HEADERS.indexOf(name);

/** 원본이 시작하는 열(0-based) — 결과 표와 겹치지 않게 멀찍이 두고 숨긴다. */
const RAW_START = 40;

/**
 * 정책 조인 — 연령·보험·심사는 전부 `policies` 에 있고 매물엔 `policy_code` 만 있다.
 * 앱은 어댑터가 읽으면서 `_policy` 를 붙이지만(`lib/firebase/rtdb-records.ts` toV4Record),
 * RTDB 를 raw 로 읽는 서버·CLI 는 직접 붙여야 한다. 안 붙이면 심사·연령·보험이 통째로 빈다.
 */
export function attachPolicy(p: EntityRecord, policies: Record<string, EntityRecord>): EntityRecord {
  const rec = p as Rec;
  if (rec._policy && typeof rec._policy === 'object') return p;
  const code = S(rec.policy_code);
  const found = code ? policies[code] : undefined;
  return found ? ({ ...rec, _policy: found } as EntityRecord) : p;
}

/** 정책 맵 — v3 `policies` ∪ v4 `v4/policies`, 키는 policy_code. */
export function policyMap(...sources: Record<string, Rec>[]): Record<string, EntityRecord> {
  const out: Record<string, EntityRecord> = {};
  for (const src of sources) {
    for (const [key, row] of Object.entries(src || {})) {
      if (!row || typeof row !== 'object') continue;
      const code = S((row as Rec).policy_code) || key;
      out[code] = { ...(out[code] || {}), ...(row as EntityRecord) };
    }
  }
  return out;
}

const plateOf = (p: Rec) => S(p.car_number || p.car_number_snapshot);
const ageNum = (v: unknown) => { const m = S(v).match(/(\d{2})/); return m ? Number(m[1]) : 0; };
const joinDot = (...parts: unknown[]) => parts.map((x) => S(x)).filter(Boolean).join(' · ');

/**
 * 차종마스터에 아직 못 붙은 매물은 제조사·모델 원자가 비어 있다(목록엔 그대로 뜬다).
 * 빈 칸으로 내보내면 영업자가 «무슨 차인지 모르는 줄»을 보게 되므로, 공급사가 원본에 적은
 * 표기(`_raw_vehicle`)를 대신 싣고 비고로 미확정임을 밝힌다. 없는 정보를 지어내지 않는다.
 */
function identity(p: Rec) {
  const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : {}) as Rec;
  if (S(p.maker) || S(p.model)) {
    return { maker: S(p.maker), model: S(p.model), sub: S(p.sub_model), trim: S(p.trim_name), note: '' };
  }
  return {
    maker: S(raw.maker), model: S(raw.model), sub: S(raw.sub_model), trim: S(raw.trim_name),
    note: '차종 확인중(공급사 표기)',
  };
}

/** 영업자가 손님에게 바로 답해야 하는 정책값만 6칸으로 압축한다. */
function policyCells(pol: Rec): string[] {
  const basic = ageNum(pol.basic_driver_age);
  const upper = ageNum(pol.driver_age_upper_limit);
  const age = basic && upper ? `만${basic}~${upper}세`
    : basic ? `만${basic}세 이상`
      : joinDot(pol.basic_driver_age, pol.driver_age_upper_limit);
  const lowering = ageNum(pol.driver_age_lowering);
  return [
    age,
    joinDot(lowering ? `만${lowering}세` : pol.driver_age_lowering, pol.age_lowering_cost),
    S(pol.license_period),
    joinDot(
      S(pol.insurance_included).replace(/보험료\s*/, ''),
      S(pol.injury_compensation_limit) && `대인 ${S(pol.injury_compensation_limit)}`,
      S(pol.property_compensation_limit) && `대물 ${S(pol.property_compensation_limit)}`,
    ),
    joinDot(S(pol.own_damage_repair_ratio), S(pol.own_damage_min_deductible) && `최소 ${S(pol.own_damage_min_deductible)}`),
    joinDot(
      pol.personal_driver_scope,
      S(pol.additional_driver_allowance_count) && `추가 ${S(pol.additional_driver_allowance_count)}${S(pol.additional_driver_cost) ? `(${S(pol.additional_driver_cost)})` : ''}`,
    ),
  ];
}

export function exportRow(p: EntityRecord, providerName: string): (string | number)[] {
  const rec = p as Rec;
  const prices = priceList(p);
  const byMonth = new Map(prices.map((e) => [e.m, e]));
  const extra = prices.filter((e) => !MONTHS.includes(e.m)).map((e) => `${e.m}개월 ${e.rent}`).join(' / ');
  const cond = excelCondSignals(p).map((s) => s.label).join('·');
  const id = identity(rec);
  return [
    S(rec.product_code || rec._key),
    plateOf(rec), S(rec.vehicle_status), canonProductType(rec.product_type) || S(rec.product_type),
    id.maker, id.model, id.sub, S(rec.variant), id.trim, S(rec.options),
    S(rec.ext_color), S(rec.int_color), N(rec.year), N(rec.mileage), S(rec.fuel_type),
    providerName || S(rec.provider_company_code), creditDisplay(p), cond,
    ...MONTHS.flatMap((m) => {
      const e = byMonth.get(m);
      // 그 기간을 «안 파는 것»과 «보증금 0원»은 다르다. 없는 기간은 빈칸, 있으면 0도 0으로.
      return e ? [N(e.rent) || '', Number(e.deposit) || 0] : ['', ''];
    }),
    extra,
    ...policyCells((rec._policy && typeof rec._policy === 'object' ? rec._policy : {}) as Rec),
    id.note,
  ];
}

/** 영업자는 «무슨 차»로 찾는다 — 제조사·모델 순, 같은 차는 연식 최신 먼저. */
export function sortForSales(rows: EntityRecord[]): EntityRecord[] {
  return [...rows].sort((a, b) => S(a.maker).localeCompare(S(b.maker), 'ko')
    || S(a.model).localeCompare(S(b.model), 'ko')
    || S(b.year).localeCompare(S(a.year))
    || plateOf(a as Rec).localeCompare(plateOf(b as Rec)));
}

/** 탭 이름 = 「몇 대·언제 기준」. */
export function exportTabName(count: number, at: Date = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const kst = new Date(at.getTime() + (9 * 60 + at.getTimezoneOffset()) * 60_000);
  return `${p2(kst.getMonth() + 1)}-${p2(kst.getDate())} ${p2(kst.getHours())}:${p2(kst.getMinutes())} · ${count}대`;
}

/* ── 서식 팔레트 ── */
const rgb = (hex: string) => ({
  red: parseInt(hex.slice(0, 2), 16) / 255,
  green: parseInt(hex.slice(2, 4), 16) / 255,
  blue: parseInt(hex.slice(4, 6), 16) / 255,
});
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  출고가능: { bg: 'DCFCE7', fg: '166534' },
  판매중: { bg: 'DBEAFE', fg: '1E40AF' },
  할인판매: { bg: 'DBEAFE', fg: '1E40AF' },
  출고협의: { bg: 'FEF3C7', fg: '92400E' },
  계약중: { bg: 'FEF3C7', fg: '92400E' },
  출고불가: { bg: 'FEE2E2', fg: '991B1B' },
};
const BG_PAGE = 'EEF2F6';   // 시트 바탕 — 그 위에 흰 카드가 떠 보이게
const BG_CARD = 'FFFFFF';
const INK = '0F172A';
const LINE = 'CBD5E1';

/** 0-based 열 번호 → A1 표기 열 문자. */
function colLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}


/**
 * 표 열 = 앱 «엑셀보기»(`features/finder/ExcelResultsTable.tsx` thead)와 **같은 순서**.
 *   차량번호 상태 상품 제조사 모델 세부모델 파워 트림 옵션 외장 내장 연식 주행 연료 공급사 심사 조건 · 기간별
 * 그 앞에 순번·카탈로그 두 칸만 덧붙인다. 중간에 열을 끼워넣지 마라 — 화면과 나란히 못 본다.
 *
 * 기간 칸은 앱과 같이 **한 칸에 두 줄**(대여료↵보증금)이다. 보증금 별도 열을 만들지 않는다.
 */
const TABLE_COLUMNS = [
  '차량번호', '상태', '상품', '제조사', '모델', '세부모델', '파워', '트림', '옵션',
  '외장', '내장', '연식', '주행', '연료', '공급사', '심사', '조건',
  ...MONTHS.map((m) => `${m}개월`),
];
/**
 * 열 너비 — 실제 값 길이에 맞춘다.
 *  · 트림·옵션·세부모델은 길다(「디 올 뉴 니로 SG2」·옵션 나열) → 넓게
 *  · 상태·연식·연료·심사는 두세 글자 → 좁게
 * 넉넉하면 훑을 때 눈이 멀리 가고, 좁으면 잘려서 다시 눌러 봐야 한다.
 */
const TABLE_WIDTH: Record<string, number> = {
  차량번호: 88, 상태: 68, 상품: 72, 제조사: 68, 모델: 96, 세부모델: 150, 파워: 92, 트림: 104,
  옵션: 190, 외장: 60, 내장: 60, 연식: 50, 주행: 78, 연료: 66, 공급사: 132, 심사: 62, 조건: 74,
};

/* 화면 좌표 — 제목줄 없음. 「몇 대·언제」는 탭 이름이 이미 말한다(중복 금지). */
const COL_NO = 0;
const COL_PHOTO = 1;     // 사진 썸네일(=IMAGE)
const COL_NAME = 2;      // 차량명 — 제조사+모델+세부모델을 한 칸으로
const COL_BEST = 3;      // 최저 월대여료(기간·보증금 포함)
const COL_LINK = 4;      // 손님 카탈로그
const COL_CODE = 5;      // 상품코드 — 링크 재료. 숨긴다.
const COL_TABLE = 6;     // 표 시작
const ROW_HEAD = 0;
const ROW_DATA = 1;

export type SheetBuild = { values: (string | number)[][]; requests: Rec[] };
export type PriorFormats = {
  bandedRangeIds: number[];
  conditionalCount: number;
  merges: number;
  filterViewIds?: number[];
};

const won = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('ko-KR') : '';
};

/**
 * 시트 한 장 — 순번 · 카탈로그 링크 · 앱 엑셀보기와 같은 표.
 *
 * 값은 **정적**으로 쓴다(수식 없음). 그래야 구글시트 **기본 헤더 필터**가 그대로 걸린다 —
 * 수식 결과 위에서는 정렬이 에러 나고, 자체 필터 줄을 만들면 조건이 두 벌이 된다.
 */
export function buildInventorySheet(
  gid: number,
  rows: EntityRecord[],
  providerNameOf: (code: string) => string,
  prev: PriorFormats = { bandedRangeIds: [], conditionalCount: 0, merges: 0 },
  /**
   * 카탈로그 링크의 주소. **박아 두면 안 된다** — `freepasserp.com` 은 도메인 전환 전까지
   * erp3 를 가리키고, 거기엔 v4 상품키가 없어 링크를 눌러도 매물이 안 나온다(실측 2026-08-07).
   * 호출자가 «지금 fp4 를 서비스하는 주소»를 넘긴다. 전환 뒤에는 그 값만 바꾸면 된다.
   * 비어 있으면 링크 칸을 만들지 않는다 — 안 열리는 링크를 주는 것보다 없는 편이 낫다.
   */
  origin = '',
  /**
   * 차번 → 대표 사진 URL. `scripts/build-photo-map.mts` 가 만든다.
   * 사진 출처는 v3 의 `photo_link`(드라이브 폴더·공급사 상세페이지)뿐이고 그대로는 이미지가
   * 아니어서 `/api/extract-photos` 로 풀어야 한다 — 느려서 미리 캐시해 두고 여기서 읽는다.
   */
  photoByPlate: Record<string, string> = {},
): SheetBuild {
  const base = String(origin).trim().replace(/\/+$/, '');
  const raw = rows.map((row) => exportRow(row, providerNameOf(S((row as Rec).provider_company_code))));
  const at = (name: string) => COL(name);

  const width = COL_TABLE + TABLE_COLUMNS.length;
  const values: (string | number)[][] = [];
  const blank = () => Array(width).fill('') as (string | number)[];

  const head = blank();
  head[COL_NO] = 'No.';
  head[COL_PHOTO] = '사진';
  head[COL_NAME] = '차량명';
  head[COL_BEST] = '최저 월대여료';
  head[COL_LINK] = '카탈로그';
  head[COL_CODE] = '상품코드';
  TABLE_COLUMNS.forEach((name, i) => { head[COL_TABLE + i] = name; });
  values.push(head);

  raw.forEach((row, r) => {
    const line = blank();
    line[COL_NO] = r + 1;
    const code = S(row[at('상품코드')]);
    const plate = S(row[at('차량번호')]).replace(/\s/g, '');

    // 사진 — 셀 안에 맞춰 넣는다(mode 1). 없으면 빈 칸.
    const photo = S(photoByPlate[plate]);
    line[COL_PHOTO] = photo ? `=IMAGE("${photo.replace(/"/g, '""')}",1)` : '';

    // 차량명 — 제조사·모델·세부모델이 세 칸에 흩어져 있어 한눈에 안 읽힌다. 한 칸으로 합친다.
    line[COL_NAME] = [S(row[at('제조사')]), S(row[at('모델')]), S(row[at('세부모델')])]
      .filter(Boolean).join(' ');

    // 최저 월대여료 — 손님이 처음 묻는 값. 기간·보증금까지 한 칸에.
    let best: { m: number; rent: number; dep: number } | null = null;
    for (const m of MONTHS) {
      const rent = Number(row[at(`${m}개월`)]) || 0;
      if (rent <= 0) continue;
      if (!best || rent < best.rent) best = { m, rent, dep: Number(row[at(`${m}개월 보증금`)]) || 0 };
    }
    line[COL_BEST] = best
      ? `${best.rent.toLocaleString('ko-KR')}\n${best.m}개월 · 보증 ${best.dep > 0 ? best.dep.toLocaleString('ko-KR') : '0'}`
      : '';

    // 손님 카탈로그(/q) — 로그인 없이 열리는 공개 견적. 손님에게 그대로 보내도 된다.
    line[COL_LINK] = code && base
      ? `=HYPERLINK("${base}/q/"&ENCODEURL("${code.replace(/"/g, '""')}"),"열기")`
      : '';
    line[COL_CODE] = code;
    TABLE_COLUMNS.forEach((name, i) => {
      if (/개월$/.test(name)) {
        // 앱과 같은 두 줄 — 위 대여료, 아래 보증금. 값이 없으면 빈 칸.
        const rent = won(row[at(name)]);
        if (!rent) { line[COL_TABLE + i] = ''; return; }
        const dep = Number(row[at(`${name} 보증금`)]) || 0;
        line[COL_TABLE + i] = `${rent}\n${dep > 0 ? dep.toLocaleString('ko-KR') : '0'}`;
        return;
      }
      line[COL_TABLE + i] = row[at(name)] ?? '';
    });
    values.push(line);
  });

  /* ── 서식 ── */
  const lastRow = Math.max(values.length, ROW_DATA + 1);
  const box = (r1: number, r2: number, c1: number, c2: number) =>
    ({ sheetId: gid, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 });
  const tableEnd = COL_TABLE + TABLE_COLUMNS.length;
  const headRange = box(ROW_HEAD, ROW_HEAD + 1, 0, tableEnd);
  const bodyRange = box(ROW_DATA, lastRow, 0, tableEnd);

  const requests: Rec[] = [
    ...prev.bandedRangeIds.map((id) => ({ deleteBanding: { bandedRangeId: id } })),
    ...Array.from({ length: prev.conditionalCount }, () => ({ deleteConditionalFormatRule: { sheetId: gid, index: 0 } })),
    ...(prev.merges ? [{ unmergeCells: { range: { sheetId: gid } } }] : []),
    ...(prev.filterViewIds || []).map((id) => ({ deleteFilterView: { filterId: id } })),
    { clearBasicFilter: { sheetId: gid } },

    // 격자선을 끄고 제목·헤더·앞 네 칸을 고정한다.
    {
      updateSheetProperties: {
        properties: { sheetId: gid, gridProperties: { hideGridlines: true, frozenRowCount: ROW_DATA, frozenColumnCount: COL_TABLE + 1 } },
        fields: 'gridProperties(hideGridlines,frozenRowCount,frozenColumnCount)',
      },
    },
    {
      repeatCell: {
        range: headRange,
        cell: { userEnteredFormat: { backgroundColor: rgb(INK), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP', textFormat: { foregroundColor: rgb('FFFFFF'), bold: true, fontSize: 10 } } },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)',
      },
    },
    // 본문 — 기간 칸이 두 줄이므로 줄바꿈을 허용하고 행 높이를 그에 맞춘다.
    {
      repeatCell: {
        range: bodyRange,
        cell: { userEnteredFormat: { backgroundColor: rgb(BG_CARD), wrapStrategy: 'CLIP', verticalAlignment: 'MIDDLE', textFormat: { fontSize: 10 } } },
        fields: 'userEnteredFormat(backgroundColor,wrapStrategy,verticalAlignment,textFormat)',
      },
    },
    { repeatCell: { range: box(ROW_DATA, lastRow, COL_NO, COL_NO + 1), cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { fontSize: 9, foregroundColor: rgb('94A3B8') } } }, fields: 'userEnteredFormat(horizontalAlignment,textFormat)' } },
    { repeatCell: { range: box(ROW_DATA, lastRow, COL_LINK, COL_LINK + 1), cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { fontSize: 10, foregroundColor: rgb('1E40AF'), underline: true } } }, fields: 'userEnteredFormat(horizontalAlignment,textFormat)' } },
    // 사진 — 셀 가운데. =IMAGE(…,1) 이 셀 크기에 맞춰 줄인다.
    { repeatCell: { range: box(ROW_DATA, lastRow, COL_PHOTO, COL_PHOTO + 1), cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)' } },
    // 차량명 — 이 표에서 가장 먼저 읽는 칸이라 굵게.
    { repeatCell: { range: box(ROW_DATA, lastRow, COL_NAME, COL_NAME + 1), cell: { userEnteredFormat: { wrapStrategy: 'CLIP', textFormat: { bold: true, fontSize: 10 } } }, fields: 'userEnteredFormat(wrapStrategy,textFormat)' } },
    // 최저 월대여료 — 두 줄(금액↵기간·보증)이라 줄바꿈 허용.
    { repeatCell: { range: box(ROW_DATA, lastRow, COL_BEST, COL_BEST + 1), cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT', wrapStrategy: 'WRAP', textFormat: { fontSize: 10 } } }, fields: 'userEnteredFormat(horizontalAlignment,wrapStrategy,textFormat)' } },
    { repeatCell: { range: box(ROW_DATA, lastRow, COL_TABLE, COL_TABLE + 1), cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat' } },
    { addBanding: { bandedRange: { range: box(ROW_HEAD, lastRow, 0, tableEnd), rowProperties: { headerColor: rgb(INK), firstBandColor: rgb('FFFFFF'), secondBandColor: rgb('F8FAFC') } } } },
    // ★기본 헤더 필터 — 각 열 머리의 화살표로 거른다. 값이 정적이라 정렬도 그대로 된다.
    { setBasicFilter: { filter: { range: box(ROW_HEAD, lastRow, 0, tableEnd) } } },
    // 상품코드는 링크 재료일 뿐 — 숨긴다.
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: COL_CODE, endIndex: COL_CODE + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: ROW_HEAD, endIndex: ROW_HEAD + 1 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } },
    // 두 줄(대여료·보증금)이 들어가는 높이.
    // 사진이 보이려면 행이 높아야 한다 — 썸네일 기준으로 잡고 기간 두 줄도 여기 들어간다.
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: ROW_DATA, endIndex: lastRow }, properties: { pixelSize: 62 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: COL_NO, endIndex: COL_NO + 1 }, properties: { pixelSize: 42 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: COL_PHOTO, endIndex: COL_PHOTO + 1 }, properties: { pixelSize: 92 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: COL_NAME, endIndex: COL_NAME + 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: COL_BEST, endIndex: COL_BEST + 1 }, properties: { pixelSize: 116 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: COL_LINK, endIndex: COL_LINK + 1 }, properties: { pixelSize: 58 }, fields: 'pixelSize' } },
  ];

  TABLE_COLUMNS.forEach((name, i) => {
    const c = COL_TABLE + i;
    const money = /개월$/.test(name);
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 },
        properties: { pixelSize: TABLE_WIDTH[name] || (money ? 84 : 88) }, fields: 'pixelSize',
      },
    });
    const center = ['상태', '상품', '심사', '연료', '연식'].includes(name);
    requests.push({
      repeatCell: {
        range: box(ROW_DATA, lastRow, c, c + 1),
        cell: {
          userEnteredFormat: {
            horizontalAlignment: money || name === '주행' ? 'RIGHT' : center ? 'CENTER' : 'LEFT',
            // 기간 칸은 두 줄이라 줄바꿈을 허용한다. 나머지는 자른다(행 높이가 들쭉날쭉하면 훑을 수 없다).
            wrapStrategy: money ? 'WRAP' : 'CLIP',
            ...(name === '주행' ? { numberFormat: { type: 'NUMBER', pattern: '#,##0"km";;"—"' } } : {}),
            ...(name === '연식' ? { numberFormat: { type: 'NUMBER', pattern: '0;;"—"' } } : {}),
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,wrapStrategy,numberFormat)',
      },
    });
  });

  // 상태 색 — «팔 수 있나»를 한눈에.
  //  ⚠ 조건부서식 format 은 굵기·기울임·취소선·글자색·배경색만 받는다(글자크기 넣으면 400).
  let index = 0;
  const statusCol = COL_TABLE + TABLE_COLUMNS.indexOf('상태');
  for (const [label, tone] of Object.entries(STATUS_TONE)) {
    requests.push({
      addConditionalFormatRule: {
        index: index++,
        rule: {
          ranges: [box(ROW_DATA, lastRow, statusCol, statusCol + 1)],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: label }] },
            format: { backgroundColor: rgb(tone.bg), textFormat: { foregroundColor: rgb(tone.fg), bold: true } },
          },
        },
      },
    });
  }
  const creditCol = COL_TABLE + TABLE_COLUMNS.indexOf('심사');
  requests.push({
    addConditionalFormatRule: {
      index: index++,
      rule: {
        ranges: [box(ROW_DATA, lastRow, creditCol, creditCol + 1)],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '무심사' }] },
          format: { textFormat: { foregroundColor: rgb('166534'), bold: true } },
        },
      },
    },
  });
  return { values, requests };
}
