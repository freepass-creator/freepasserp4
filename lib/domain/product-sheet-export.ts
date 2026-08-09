/**
 * 「프리패스 상품리스트」 시트로 내보낼 «우리 규격» 표 — 순수 변환만 한다(네트워크 없음).
 *
 * 규격의 근거는 `docs/SUPPLIER_STANDARD_SHEET.md` §3 이다. 거기서 정한 필수 4(차량번호·제조사·
 * 모델·상태) + 가격(보증금·12~60개월) + 권장 열을 그대로 쓰고, «우리» 리스트라 앞에 공급사·
 * 상품코드를 붙였다. 새 필드를 만들지 않았다 — 전부 `IMPORT_FIELDS` 에 이미 있는 키다.
 *
 * 왜 이 순서인가: 왼쪽부터 «누구 차인가 → 어떤 차인가 → 팔 수 있나 → 얼마인가» 로 읽힌다.
 * 상태를 가격 바로 왼쪽에 둔 건 필터로 「출고가능」만 고른 뒤 바로 가격을 보게 하려는 것이다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { priceList } from '@/lib/domain/product';

export type SheetColumnKind = 'text' | 'number' | 'won';
export type SheetColumn = { label: string; kind: SheetColumnKind; width: number };

/** 계약 기간 — 시트에 한 열씩. 규격이 못 박은 다섯 개뿐이다(열을 두 벌 만들지 않는다). */
export const SHEET_MONTHS = [12, 24, 36, 48, 60] as const;

export const PRODUCT_SHEET_COLUMNS: SheetColumn[] = [
  { label: '공급사', kind: 'text', width: 110 },
  { label: '상품코드', kind: 'text', width: 120 },
  { label: '차량번호', kind: 'text', width: 95 },
  /**
   * ★차대번호 — 공급사가 채워 주면 차종 매칭이 «추측»에서 «규칙»이 된다(2026-08-09 사장님 지시).
   *
   * VIN 17자리는 제조사·차종·연식을 자리로 말해 준다(10번째 자리가 연식).
   * 지금은 이름 글자를 맞추느라 오탈자·별칭·초성까지 방어하는데, 이 칸이 차면 그게 다 필요 없다.
   * 차량번호는 바뀌지만 VIN 은 안 바뀌어서 **같은 차를 잇는 열쇠**로도 이게 정답이다.
   *
   * 공급사는 이미 갖고 있다 — 자동차등록증에 적혀 있다.
   * ⚠ 받아서 우리만 쓴다. 손님 카탈로그·영업자 시트 어느 쪽으로도 안 내보낸다.
   */
  { label: '차대번호', kind: 'text', width: 175 },
  { label: '제조사', kind: 'text', width: 80 },
  { label: '모델', kind: 'text', width: 110 },
  { label: '세부모델', kind: 'text', width: 150 },
  // ★파워트레인이 통째로 빠져 있었다(2026-08-09). 차종 5단계는
  //   제조사 → 모델 → 세부모델 → **파워트레인** → 세부트림 이다.
  //   이 열이 없으면 「2.5 가솔린」과 「2.5 디젤」이 같은 차로 보인다.
  { label: '파워트레인', kind: 'text', width: 130 },
  { label: '세부트림', kind: 'text', width: 120 },
  { label: '연식', kind: 'text', width: 60 },
  { label: '연료', kind: 'text', width: 70 },
  { label: '주행거리', kind: 'number', width: 85 },
  { label: '외장색', kind: 'text', width: 80 },
  { label: '인승', kind: 'text', width: 55 },
  { label: '변속기', kind: 'text', width: 75 },
  { label: '상태', kind: 'text', width: 80 },
  { label: '보증금', kind: 'won', width: 95 },
  ...SHEET_MONTHS.map((m) => ({ label: `${m}개월`, kind: 'won' as const, width: 90 })),
  { label: '메모', kind: 'text', width: 200 },
  { label: '갱신', kind: 'text', width: 90 },
];

/** 상태 열 인덱스 — 조건부서식이 이 열을 본다. 라벨로 찾아 열 순서가 바뀌어도 따라간다. */
export const STATUS_COLUMN_INDEX = PRODUCT_SHEET_COLUMNS.findIndex((c) => c.label === '상태');

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : '';
};

/** 갱신일시는 날짜까지만 — 시분초는 시트에서 열 너비만 먹고 판단에 안 쓰인다. */
function dayOf(v: unknown): string {
  const s = S(v);
  if (!s) return '';
  const d = new Date(/^\d+$/.test(s) ? Number(s) : s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * 보증금 한 칸 — 기간마다 보증금이 다른 상품이 실제로 있다.
 * 전부 같으면 그 값, 다르면 «가장 싼 기간»의 보증금을 쓴다(손님이 실제로 고르는 쪽).
 * 규격이 보증금을 한 칸으로 못 박았기 때문에 여기서 하나를 골라야 한다.
 */
function depositOf(rows: { m: number; rent: number; deposit: number }[]): number | '' {
  const priced = rows.filter((r) => r.rent > 0);
  if (!priced.length) return '';
  const set = new Set(priced.map((r) => r.deposit));
  if (set.size === 1) return priced[0].deposit || '';
  const cheapest = priced.reduce((a, b) => (b.rent < a.rent ? b : a));
  return cheapest.deposit || '';
}

/** 상품 한 건 → 시트 한 행. 열 순서는 PRODUCT_SHEET_COLUMNS 와 1:1 이다. */
export function productSheetRow(p: EntityRecord, providerName: string): (string | number)[] {
  const prices = priceList(p);
  const byMonth = new Map(prices.map((x) => [x.m, x]));
  return [
    providerName || S(p.provider_company_code),
    S(p.product_code || p._key),
    S(p.car_number),
    S(p.vin),
    S(p.maker),
    S(p.model),
    S(p.sub_model),
    S(p.variant),
    S(p.trim_name),
    S(p.year),
    S(p.fuel_type),
    N(p.mileage),
    S(p.ext_color),
    S(p.seats),
    S(p.transmission),
    S(p.vehicle_status),
    depositOf(prices),
    ...SHEET_MONTHS.map((m) => {
      const rent = byMonth.get(m)?.rent || 0;
      return rent > 0 ? rent : '';
    }),
    S(p.partner_memo),
    dayOf(p.updatedAt || p.updated_at || p.createdAt),
  ];
}

/**
 * 정렬 — 공급사 → 제조사 → 모델 → 차량번호.
 * 시트는 사람이 눈으로 훑는 물건이라 «같은 공급사의 같은 차»가 붙어 있어야 한다.
 * 필터를 걸어도 기본 정렬이 어지러우면 못 쓴다.
 */
export function sortForSheet(rows: (string | number)[][]): (string | number)[][] {
  const k = (r: (string | number)[], i: number) => String(r[i] ?? '');
  return [...rows].sort(
    (a, b) => k(a, 0).localeCompare(k(b, 0), 'ko')
      || k(a, 3).localeCompare(k(b, 3), 'ko')
      || k(a, 4).localeCompare(k(b, 4), 'ko')
      || k(a, 2).localeCompare(k(b, 2), 'ko'),
  );
}

export const PRODUCT_SHEET_HEADER = PRODUCT_SHEET_COLUMNS.map((c) => c.label);
