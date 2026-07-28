/**
 * 오토플러스 시트 — 2탭 병합 · 무라벨 가격열 라벨 · 재고 집계.
 * main(gid=284963459 판매차량리스트) ∪ 전기차프로모션(gid=2018553731, 메인 미포함 차번만).
 * commit/merge/absent 로직은 건드리지 않음 — 유입 표·제품 배열만 만든다.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { isRealPlate } from '@/lib/domain/product';
import {
  importSheetTable,
  type ImportResult,
  type MappingProfile,
} from '@/lib/domain/sheet-import';
import {
  AUTOPLUS_PRICE_HEADERS,
  SHEET_ADAPTERS,
  labelAutoplusHeaderRow,
} from '@/lib/domain/sheet-adapters';
import type { MasterEntry } from '@/lib/domain/vehicle-master-match';

/** 판매차량리스트 */
export const AUTOPLUS_GID_MAIN = '284963459';
/** 전기차 프로모션 */
export const AUTOPLUS_GID_PROMO = '2018553731';

export { AUTOPLUS_PRICE_HEADERS, labelAutoplusHeaderRow };

export function isAutoplusPartner(p: { adapter_id?: unknown; partner_code?: unknown; name?: unknown; partner_name?: unknown } | string): boolean {
  if (typeof p === 'string') {
    return /autoplus|오토플러스|RP023/i.test(p);
  }
  const id = String(p.adapter_id || '');
  if (id === 'autoplus') return true;
  return /autoplus|오토플러스|RP023/i.test(`${p.partner_code || ''} ${p.name || ''} ${p.partner_name || ''}`);
}

const PROMO_BASE_HEADER = [
  '순번', '차량번호', '차종', '모델명', '색상', '연료',
  '최초등록일', '주행거리', '판매상태', '가격',
  '', ...AUTOPLUS_PRICE_HEADERS,
];

/** 프로모션 탭 — 위치 컬럼 + 실번호판만. */
export function prepareAutoplusPromoTable(raw: string[][]): string[][] {
  const body = raw.filter((r) => isRealPlate(String(r[1] || '').replace(/\s/g, '')));
  return [labelAutoplusHeaderRow([...PROMO_BASE_HEADER]), ...body];
}

/** 메인∪프로모션(메인에 없는 차번만). */
export function mergeAutoplusProducts(
  main: EntityRecord[],
  promo: EntityRecord[],
): { products: EntityRecord[]; promoOnlyN: number } {
  const mainCars = new Set(main.map((p) => String(p.car_number || '').replace(/\s/g, '')));
  const promoOnly = promo.filter((p) => !mainCars.has(String(p.car_number || '').replace(/\s/g, '')));
  return { products: [...main, ...promoOnly], promoOnlyN: promoOnly.length };
}

/**
 * 실무 재고 대수 = 출고가능(할인판매·판매중→출고가능) + 보류(→출고불가).
 * 계약중은 별도(포함하지 않음).
 */
export function countAutoplusStock(products: EntityRecord[]): number {
  let n = 0;
  for (const p of products) {
    const st = String(p.vehicle_status || '');
    if (st === '출고가능' || st === '즉시출고' || st === '출고불가') n++;
  }
  return n;
}

export type AutoplusImportResult = ImportResult & {
  mainN: number;
  promoOnlyN: number;
  stock: number; // 출고가능+보류
  byStatus: Record<string, number>;
};

function tallyStatus(products: EntityRecord[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const p of products) {
    const st = String(p.vehicle_status || '') || '(빈)';
    by[st] = (by[st] || 0) + 1;
  }
  return by;
}

function mergeSnap(
  a: ImportResult['snap'],
  b: ImportResult['snap'],
): ImportResult['snap'] {
  return {
    high: a.high + b.high,
    medium: a.medium + b.medium,
    low: a.low + b.low,
    none: a.none + b.none,
  };
}

/**
 * 오토플러스 URL → main+프로모 fetch · prepare · import · 차번 dedup 병합.
 * fetchTable = 클라이언트 fetchSheetTable 또는 스크립트 CSV fetch.
 */
export async function importAutoplusMerged(opts: {
  url: string;
  providerCode: string;
  entries: MasterEntry[];
  profile?: MappingProfile;
  fetchTable: (url: string, gid?: string) => Promise<string[][]>;
  /** 메인 헤더 행(0=어댑터 자동탐지) */
  headerRow?: number;
}): Promise<AutoplusImportResult> {
  const headerRow = opts.headerRow ?? 0;
  const mainRaw = await opts.fetchTable(opts.url, AUTOPLUS_GID_MAIN);
  const promoRaw = await opts.fetchTable(opts.url, AUTOPLUS_GID_PROMO);
  const mainT = SHEET_ADAPTERS.autoplus.prepareTable(mainRaw, { headerRow });
  const promoT = prepareAutoplusPromoTable(promoRaw);
  if (mainT.length < 2) throw new Error('오토플러스 본탭 헤더+데이터 없음');

  const main = importSheetTable(mainT, {
    providerCode: opts.providerCode,
    entries: opts.entries,
    profile: opts.profile,
  });
  const promo = promoT.length >= 2
    ? importSheetTable(promoT, {
      providerCode: opts.providerCode,
      entries: opts.entries,
      profile: opts.profile,
    })
    : {
      products: [] as EntityRecord[],
      mapping: {},
      total: 0,
      imported: 0,
      skipped: 0,
      rentedExcluded: 0,
      snap: { high: 0, medium: 0, low: 0, none: 0 },
    };

  const { products, promoOnlyN } = mergeAutoplusProducts(main.products, promo.products);
  const byStatus = tallyStatus(products);
  return {
    products,
    mapping: main.mapping,
    total: main.total + promo.total,
    imported: products.length,
    skipped: main.skipped + promo.skipped,
    rentedExcluded: main.rentedExcluded + promo.rentedExcluded,
    snap: mergeSnap(main.snap, {
      high: promo.snap.high,
      medium: promo.snap.medium,
      low: promo.snap.low,
      none: promo.snap.none,
    }),
    mainN: main.products.length,
    promoOnlyN,
    stock: countAutoplusStock(products),
    byStatus,
  };
}
