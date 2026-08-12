/**
 * 오토플러스 시트 — 2탭 병합 · 무라벨 가격열 라벨 · 재고 집계.
 * main(gid=284963459 판매차량리스트) ∪ 전기차프로모션(gid=2018553731, 메인 미포함 차번만).
 * commit/merge/absent 로직은 건드리지 않음 — 유입 표·제품 배열만 만든다.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import {
  assertDistinctSheetTable,
  importSheetTable,
  type DepositRule,
  type ImportResult,
  type MappingHeaderSignature,
  type MappingProfile,
  type SheetTableFetcher,
} from '@/lib/domain/sheet-import';
import type { PlateAllocator } from '@/lib/domain/pending-plate';
import {
  AUTOPLUS_PRICE_HEADERS,
  SHEET_ADAPTERS,
  firstPlateBlockAfterHeader,
  findPlateHeaderRow,
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
  '순번', '차량번호', '차종', '모델명(트림풀명)', '색상', '연료',
  '최초등록일', '주행거리', '판매상태', '가격',
  '', ...AUTOPLUS_PRICE_HEADERS,
];

/**
 * 프로모션 탭 — 차량번호 헤더 아래에서 첫 유효 데이터 블록을 찾아 읽는다.
 * 헤더와 데이터 사이의 안내·여백은 허용하되, 데이터가 시작된 뒤 빈 행/비데이터 행을
 * 만나면 종료한다. 그래야 위쪽 행이 밀려도 현재 재고는 읽고 하단 과거 이력은 제외된다.
 */
export function prepareAutoplusPromoTable(raw: string[][]): string[][] {
  const headerRow = findPlateHeaderRow(raw);
  if (headerRow < 0) throw new Error('오토플러스 프로모션 차량번호 헤더 행 없음');
  const block = firstPlateBlockAfterHeader(raw.slice(headerRow));
  return [labelAutoplusHeaderRow([...PROMO_BASE_HEADER]), ...block.slice(1)];
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
  /** 각 탭 내부의 실제 중복. main↔promo 정상 겹침은 제외한다. */
  blockingDuplicateCount: number;
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
  profileHeaders?: MappingHeaderSignature;
  fetchTable: SheetTableFetcher;
  /** 메인 헤더 행(0=어댑터 자동탐지) */
  headerRow?: number;
  /** 일괄 저장 경로의 영구 번호미정 할당기 */
  plateAllocator?: PlateAllocator;
  /** 본탭·프로모션 탭이 공유하는 동일스펙 occurrence */
  pendingOccurrence?: Map<string, number>;
  /** AutoPlus 보증금 규칙. 미설정은 금액을 추정하지 않고 가격없음으로 차단한다. */
  depositRule?: DepositRule;
}): Promise<AutoplusImportResult> {
  const headerRow = opts.headerRow ?? 0;
  // 오토플러스는 공급사가 행을 숨기거나 필터로 내리는 방식으로 판매 목록을 운영한다.
  // CSV export는 그 행까지 되살리므로, 이 어댑터만 Sheets 행 메타데이터 경로를 강제한다.
  // 사진은 열이 아니라 차번 셀 링크(드라이브 폴더 스마트칩)에 있다 — 같은 fetch 에서 받는다.
  let mainPhotos: Record<string, string> | undefined;
  let promoPhotos: Record<string, string> | undefined;
  const mainRaw = await opts.fetchTable(opts.url, AUTOPLUS_GID_MAIN, {
    visibleRowsOnly: true,
    onPhotoByPlate: (map) => { mainPhotos = map; },
  });
  const promoRaw = await opts.fetchTable(opts.url, AUTOPLUS_GID_PROMO, {
    visibleRowsOnly: true,
    onPhotoByPlate: (map) => { promoPhotos = map; },
  });
  const tabResponses = new Map<string, string>();
  assertDistinctSheetTable(tabResponses, mainRaw, `본탭 gid ${AUTOPLUS_GID_MAIN}`);
  assertDistinctSheetTable(tabResponses, promoRaw, `프로모션 gid ${AUTOPLUS_GID_PROMO}`);
  const mainT = SHEET_ADAPTERS.autoplus.prepareTable(mainRaw, { headerRow });
  const promoT = prepareAutoplusPromoTable(promoRaw);
  if (mainT.length < 2) throw new Error('오토플러스 본탭 헤더+데이터 없음');

  const main = importSheetTable(mainT, {
    providerCode: opts.providerCode,
    entries: opts.entries,
    profile: opts.profile,
    profileHeaders: opts.profileHeaders,
    depositRule: opts.depositRule,
    plateAllocator: opts.plateAllocator,
    pendingOccurrence: opts.pendingOccurrence,
    photoByPlate: mainPhotos,
  });
  const promo = importSheetTable(promoT, {
      providerCode: opts.providerCode,
      entries: opts.entries,
      // 프로모션은 코드가 만든 고정 헤더다. 본탭의 저장 index/signature를 재사용하면
      // 모델명·트림 열 의미가 달라 정상 2탭이 헤더 변경으로 오인된다.
      depositRule: opts.depositRule,
      plateAllocator: opts.plateAllocator,
      pendingOccurrence: opts.pendingOccurrence,
      // 프로모션 탭에 링크가 없으면 본탭 지도로 메운다 — 같은 차라 차번 키가 같다.
      photoByPlate: { ...(mainPhotos || {}), ...(promoPhotos || {}) },
    });

  const { products, promoOnlyN } = mergeAutoplusProducts(main.products, promo.products);
  const promoDuplicates = promo.products.length - promoOnlyN;
  const mainCars = new Set(main.products.map((p) => String(p.car_number || '').replace(/\s/g, '')));
  const promoDuplicateSamples = promo.products
    .map((p) => String(p.car_number || '').replace(/\s/g, ''))
    .filter((plate) => plate && mainCars.has(plate))
    .slice(0, 6)
    .map((plate) => `프로모션 중복 · ${plate}`);
  const byStatus = tallyStatus(products);
  return {
    products,
    mapping: main.mapping,
    total: main.total + promo.total,
    imported: products.length,
    skipped: main.skipped + promo.skipped + promoDuplicates,
    duplicateCount: main.duplicateCount + promo.duplicateCount + promoDuplicates,
    blockingDuplicateCount: main.duplicateCount + promo.duplicateCount,
    invalidCount: main.invalidCount + promo.invalidCount,
    issueSamples: [...main.issueSamples, ...promo.issueSamples, ...promoDuplicateSamples].slice(0, 12),
    excludedCount: main.excludedCount + promo.excludedCount,
    noPriceCount: main.noPriceCount + promo.noPriceCount,
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
