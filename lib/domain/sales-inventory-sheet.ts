/**
 * 레거시 영업자 상품리스트 파서.
 *
 * 현행 ERP 직접 정본은 판매시트 3탭이며, 이 모듈이 그 값을 재해석 없이 ERP 입력으로 바꾼다.
 * 탭 이름의 날짜·대수는 매번 바뀌므로 이름 prefix로 고르고, 공급사 표기는 파트너명에
 * 정확히 대응시킨다. 이름이 없거나 두 곳에 걸리면 잘못된 공급사로 저장하지 않고 전부 막는다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import { importSheetTable } from '@/lib/domain/sheet-import';
import { importAutoplusTables } from '@/lib/domain/sheet-autoplus';
import { createPlateAllocator, type PlateAllocator } from '@/lib/domain/pending-plate';
import {
  sheetPartnerRosterRevision,
  type PartnerFetchLine,
  type PartnerSheetsFetch,
} from '@/lib/domain/sheet-sync-all';

export const DEFAULT_SALES_INVENTORY_SHEET_ID = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
export const DEFAULT_SALES_INVENTORY_TAB_PREFIX = '상품리스트';
export const SALES_SONOGONG_TAB_PREFIX = '손오공구독';
export const SALES_PICKUP_TAB_PREFIX = '픽업구독';
export const SALES_AUTOPLUS_MAIN_TAB_PREFIX = '오플구독';
export const SALES_AUTOPLUS_PROMO_TAB_PREFIX = '오플프로모션';

const S = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) => S(value)
  .toLowerCase()
  .replace(/\(주\)|（주）/g, '')
  .replace(/[\s()（）\[\]{}·._-]+/g, '')
  .replace(/주식회사|유한회사|합자회사|합명회사|렌터카|렌트카|모빌리티|캐피탈/g, '');

/** 운영 화면에서 쓰는 안정된 짧은 이름. 동의어는 코드가 유일할 때만 붙인다. */
const PROVIDER_NAME_ALIASES: Record<string, string[]> = {
  RP006: ['아이언'],
  RP021: ['빌린카'],
  RP030: ['J&J', '제이앤제이'],
  'PT-0023': ['에스에이', 'SA'],
};

function numericCell(value: unknown): string {
  const raw = S(value).replace(/,/g, '');
  if (!raw || /^(미입력|-|—)$/.test(raw)) return '';
  const tenThousands = raw.match(/^([\d.]+)만(?:km)?$/i);
  if (tenThousands) return String(Math.round(Number(tenThousands[1]) * 10_000));
  const numeric = raw.match(/^[\d.]+/i)?.[0] || '';
  return numeric && Number.isFinite(Number(numeric)) ? String(Number(numeric)) : '';
}

export function normalizeSalesRows(table: string[][]): string[][] {
  const headers = table[0] || [];
  const mileage = headers.findIndex((header) => /^(주행|주행거리)$/.test(S(header)));
  const engine = headers.findIndex((header) => /^(배기량|배기|cc)$/i.test(S(header)));
  const photo = headers.findIndex((header) => /^(사진|사진링크|이미지)$/.test(S(header)));
  return [headers, ...table.slice(1).map((row) => {
    const next = [...row];
    if (mileage >= 0) next[mileage] = numericCell(next[mileage]);
    if (engine >= 0) next[engine] = numericCell(next[engine]);
    if (photo >= 0 && !/^https?:\/\//i.test(S(next[photo]))) next[photo] = '';
    return next;
  })];
}

export function salesSheetProviderIndex(partners: EntityRecord[]): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  const add = (label: unknown, code: string) => {
    const key = norm(label);
    if (!key) return;
    const codes = candidates.get(key) || new Set<string>();
    codes.add(code);
    candidates.set(key, codes);
  };
  for (const partner of partners) {
    if (partner._deleted === true || partner.deletedAt || S(partner.status) === 'deleted') continue;
    const code = S(partner.partner_code || partner._key);
    if (!code || /영업|sales/i.test(S(partner.partner_type))) continue;
    add(code, code);
    add(partner.name, code);
    add(partner.partner_name, code);
    for (const alias of PROVIDER_NAME_ALIASES[code] || []) add(alias, code);
  }
  const index = new Map<string, string>();
  for (const [key, codes] of candidates) {
    if (codes.size === 1) index.set(key, [...codes][0]);
  }
  const existingCodes = new Set(partners.map((partner) => S(partner.partner_code || partner._key)));
  for (const [code, aliases] of Object.entries(PROVIDER_NAME_ALIASES)) {
    if (!existingCodes.has(code)) continue;
    for (const alias of aliases) index.set(norm(alias), code);
  }
  return index;
}

export function resolveSalesSheetProvider(label: unknown, index: Map<string, string>): string {
  return index.get(norm(label)) || '';
}

function sheetPartnerRevision(partners: EntityRecord[], codes: Set<string>): string {
  return sheetPartnerRosterRevision(partners
    .filter((partner) => codes.has(S(partner.partner_code || partner._key)))
    .map((partner) => ({
      code: S(partner.partner_code || partner._key),
      name: S(partner.name || partner.partner_name || partner.partner_code || partner._key),
      url: '',
      adapter: 'sales_sheet',
      lastSyncedAt: partner.last_synced_at != null ? Number(partner.last_synced_at) : null,
      syncRevision: JSON.stringify({
        code: S(partner.partner_code || partner._key),
        name: S(partner.name || partner.partner_name),
        pending_plates: partner.pending_plates || {},
        pending_plate_seq: Number(partner.pending_plate_seq) || 0,
        last_sheet_rows: Number(partner.last_sheet_rows) || 0,
        last_sheet_imported: Number(partner.last_sheet_imported) || 0,
      }),
    })));
}

export function importSalesInventorySheet(input: {
  table: string[][];
  partners: EntityRecord[];
  /** 하위호환 인자. 판매시트 직접 유입에서는 차종마스터를 읽지 않는다. */
  entries?: MasterEntry[];
  tabTitle: string;
  tabGid: string;
  providerCodes?: string[];
  /** 워크북 여러 탭에서 같은 공급사의 번호미정 순번을 공유한다. */
  plateAllocators?: Map<string, PlateAllocator>;
  pendingOccurrences?: Map<string, Map<string, number>>;
}): PartnerSheetsFetch {
  const headers = input.table[0] || [];
  const providerColumn = headers.findIndex((header) => /^(공급사|렌트사|제공사|업체명)$/.test(S(header)));
  if (providerColumn < 0) throw new Error('영업자 상품리스트에 공급사 열이 없습니다');
  const index = salesSheetProviderIndex(input.partners);
  const requested = new Set((input.providerCodes || []).map(S).filter(Boolean));
  const grouped = new Map<string, { rows: string[][]; sourceRows: number[] }>();
  const unknown: string[] = [];
  let inScopeRows = 0;
  for (const [offset, row] of input.table.slice(1).entries()) {
    if (row.every((cell) => !S(cell))) continue;
    const label = S(row[providerColumn]);
    const code = resolveSalesSheetProvider(label, index);
    if (!code) {
      if (unknown.length < 12) unknown.push(`${offset + 2}행 ${label || '공급사 미입력'}`);
      continue;
    }
    if (requested.size && !requested.has(code)) continue;
    inScopeRows++;
    const group = grouped.get(code) || { rows: [headers], sourceRows: [] };
    group.rows.push(row);
    group.sourceRows.push(offset + 2);
    grouped.set(code, group);
  }
  if (unknown.length) {
    throw new Error(`영업자 상품리스트 공급사 매칭 실패 — ${unknown.join(' · ')}`);
  }
  if (!inScopeRows) throw new Error('영업자 상품리스트에서 연동할 차량을 찾지 못했습니다');
  if (requested.size) {
    const missing = [...requested].filter((code) => !grouped.has(code));
    if (missing.length) throw new Error(`영업자 상품리스트에 요청 공급사가 없습니다(${missing.join(', ')})`);
  }

  const partnerByCode = new Map(input.partners.map((partner) => [S(partner.partner_code || partner._key), partner]));
  const allocators = input.plateAllocators || new Map<string, PlateAllocator>();
  const occurrences = input.pendingOccurrences || new Map<string, Map<string, number>>();
  const allocatorFor = (code: string, partner: EntityRecord): PlateAllocator => {
    let allocator = allocators.get(code);
    if (!allocator) {
      allocator = createPlateAllocator(
        partner.pending_plates as Record<string, string[]> | undefined,
        Number(partner.pending_plate_seq) || 0,
      );
      allocators.set(code, allocator);
    }
    return allocator;
  };
  const lines: PartnerFetchLine[] = [];
  for (const [code, group] of grouped) {
    const partner = partnerByCode.get(code);
    if (!partner) throw new Error(`영업자 상품리스트 공급사 설정 없음(${code})`);
    const allocator = allocatorFor(code, partner);
    const pendingOccurrence = occurrences.get(code) || new Map<string, number>();
    occurrences.set(code, pendingOccurrence);
    const result = importSheetTable(normalizeSalesRows(group.rows), {
      providerCode: code,
      entries: [],
      authoritativeRefinedRows: true,
      plateAllocator: allocator,
      pendingOccurrence,
      acceptAssignedPendingPlate: true,
      compactPriceCells: true,
      preserveCanonicalContractStatus: true,
    });
    for (const product of result.products) {
      // 판매시트에 있는 기간·금액 전체가 현재값이다. 표에서 사라진 옛 ERP 기간을
      // 보존하면 영업자 표와 ERP가 다시 갈리므로 별도 가격 범위를 두지 않는다.
      const localRow = Number(product.sheet_source_row) || 0;
      product.sheet_source_row = group.sourceRows[localRow - 2] || localRow;
      product.sheet_source_gid = input.tabGid;
      product.sheet_source_tab = input.tabTitle;
    }
    result.issueSamples = result.issueSamples.map((issue) => issue.replace(/^행 (\d+)/, (_, raw) => {
      const localRow = Number(raw);
      return `행 ${group.sourceRows[localRow - 2] || localRow}`;
    }));
    const label = S(partner.name || partner.partner_name || code);
    lines.push({
      code,
      label,
      ok: true,
      sourceRowCount: result.total,
      imported: result.imported,
      excludedCount: result.excludedCount,
      noPriceCount: result.noPriceCount,
      noPriceSkippedCount: result.noPriceSkippedCount,
      skippedCount: result.skipped,
      duplicateCount: result.duplicateCount,
      blockingDuplicateCount: result.duplicateCount,
      invalidCount: result.invalidCount,
      issueSamples: result.issueSamples,
      plateAlloc: result.products.some((product) => product.is_pending_plate === true) ? allocator.snapshot() : undefined,
      message: `✓ ${label} [영업자 상품리스트] — ${result.imported}매물`,
      products: result.products,
    });
  }
  lines.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  const products = lines.flatMap((line) => line.products);
  const codes = new Set(lines.map((line) => line.code));
  return {
    lines,
    products,
    partnerCount: lines.length,
    rosterRevision: sheetPartnerRevision(input.partners, codes),
    sourceKind: 'sales_inventory',
    sourceScope: requested.size ? 'providers' : 'all',
  };
}

export type SalesInventoryWorkbookTab = {
  title: string;
  gid: string;
  rows: string[][];
  photoByPlate?: Record<string, string>;
};

function mergePartnerLines(lines: PartnerFetchLine[]): PartnerFetchLine[] {
  const byCode = new Map<string, PartnerFetchLine>();
  for (const line of lines) {
    const before = byCode.get(line.code);
    if (!before) {
      byCode.set(line.code, { ...line, products: [...line.products], issueSamples: [...line.issueSamples] });
      continue;
    }
    const seen = new Set(before.products.map((product) => S(product.car_number).replace(/\s/g, '')));
    const duplicateAcrossTabs: string[] = [];
    const additions = line.products.filter((product) => {
      const plate = S(product.car_number).replace(/\s/g, '');
      if (!plate || !seen.has(plate)) {
        if (plate) seen.add(plate);
        return true;
      }
      if (duplicateAcrossTabs.length < 6) duplicateAcrossTabs.push(`탭 간 중복 · ${plate}`);
      return false;
    });
    const across = line.products.length - additions.length;
    before.products.push(...additions);
    before.sourceRowCount += line.sourceRowCount;
    before.imported += additions.length;
    before.excludedCount += line.excludedCount;
    before.noPriceCount += line.noPriceCount;
    before.noPriceSkippedCount = (before.noPriceSkippedCount || 0) + (line.noPriceSkippedCount || 0);
    before.skippedCount += line.skippedCount + across;
    before.duplicateCount += line.duplicateCount + across;
    before.blockingDuplicateCount = (before.blockingDuplicateCount || 0) + (line.blockingDuplicateCount || 0);
    before.invalidCount += line.invalidCount;
    before.issueSamples = [...before.issueSamples, ...line.issueSamples, ...duplicateAcrossTabs].slice(0, 12);
    if (line.plateAlloc) before.plateAlloc = line.plateAlloc;
    before.message = `✓ ${before.label} [영업자 상품리스트] — ${before.imported}매물`;
  }
  return [...byCode.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

/** 판매용 워크북의 3개 운영 탭을 탭별 규격으로 읽고 한 ERP 정본으로 합친다. */
export function importSalesInventoryWorkbook(input: {
  main: SalesInventoryWorkbookTab;
  sonogong: SalesInventoryWorkbookTab;
  autoplusMain: SalesInventoryWorkbookTab;
  /** 과거 호출 호환 전용. ERP 판매시트 경로에서는 전달하지 않는다. */
  autoplusPromo?: SalesInventoryWorkbookTab;
  /** 손오공 픽업(T카) — RP012에 손오공구독과 합쳐 ERP에 반영한다(2026-08-27). */
  pickup?: SalesInventoryWorkbookTab;
  partners: EntityRecord[];
  /** 하위호환 인자. 판매시트 직접 유입에서는 차종마스터를 읽지 않는다. */
  entries?: MasterEntry[];
  providerCodes?: string[];
}): PartnerSheetsFetch {
  const requested = new Set((input.providerCodes || []).map(S).filter(Boolean));
  const wants = (code: string) => !requested.size || requested.has(code);
  const partnerByCode = new Map(input.partners.map((partner) => [S(partner.partner_code || partner._key), partner]));
  const plateAllocators = new Map<string, PlateAllocator>();
  const pendingOccurrences = new Map<string, Map<string, number>>();
  const allocatorFor = (code: string, partner: EntityRecord): PlateAllocator => {
    let allocator = plateAllocators.get(code);
    if (!allocator) {
      allocator = createPlateAllocator(
        partner.pending_plates as Record<string, string[]> | undefined,
        Number(partner.pending_plate_seq) || 0,
      );
      plateAllocators.set(code, allocator);
    }
    return allocator;
  };
  const base = importSalesInventorySheet({
    table: input.main.rows,
    partners: input.partners,
    entries: input.entries,
    tabTitle: input.main.title,
    tabGid: input.main.gid,
    plateAllocators,
    pendingOccurrences,
  });
  const fetchedLines = base.lines.filter((line) => wants(line.code));

  if (wants('RP012')) {
    const partner = partnerByCode.get('RP012');
    if (!partner) throw new Error('영업자 상품리스트 공급사 설정 없음(RP012)');
    const allocator = allocatorFor('RP012', partner);
    const pendingOccurrence = pendingOccurrences.get('RP012') || new Map<string, number>();
    pendingOccurrences.set('RP012', pendingOccurrence);
    const rp012Opts = {
      providerCode: 'RP012',
      // `as const` 가 빈 배열을 readonly 로 굳혀 importSheetTable 의 MasterEntry[] 에 안 들어간다.
      // 명시 단언으로 가변 배열임을 못 박는다(차종마스터는 이 경로에서 쓰지 않는다 — 정제행이 정본).
      entries: [] as MasterEntry[],
      authoritativeRefinedRows: true,
      plateAllocator: allocator,
      pendingOccurrence,
      acceptAssignedPendingPlate: true,
      compactPriceCells: true,
      preserveCanonicalContractStatus: true,
      depositRule: 'months_per_year',
    } as const;
    const result = importSheetTable(normalizeSalesRows(input.sonogong.rows), { ...rp012Opts });
    for (const product of result.products) {
      product._sheet_price_scope = 'sales_all_periods';
      product.sheet_source_gid = input.sonogong.gid;
      product.sheet_source_tab = input.sonogong.title;
    }
    // ★손오공 픽업(T카) — 같은 RP012. 손오공구독과 «합쳐» ERP에 함께 반영한다(2026-08-27).
    //   구독(SON)·픽업(T카)은 서로 다른 차라 차번이 겹치지 않는다. 요금 블록만 반납형/인수형으로 같은 꼴.
    const pickup = input.pickup
      ? importSheetTable(normalizeSalesRows(input.pickup.rows), { ...rp012Opts })
      : null;
    if (pickup && input.pickup) {
      for (const product of pickup.products) {
        product._sheet_price_scope = 'sales_all_periods';
        product.sheet_source_gid = input.pickup.gid;
        product.sheet_source_tab = input.pickup.title;
      }
    }
    const rp012Products = pickup ? [...result.products, ...pickup.products] : result.products;
    const sum = (a: number, b: number | undefined) => a + (b || 0);
    fetchedLines.push({
      code: 'RP012',
      label: S(partner.name || partner.partner_name || '손오공'),
      ok: true,
      sourceRowCount: sum(result.total, pickup?.total),
      imported: sum(result.imported, pickup?.imported),
      excludedCount: sum(result.excludedCount, pickup?.excludedCount),
      noPriceCount: sum(result.noPriceCount, pickup?.noPriceCount),
      noPriceSkippedCount: sum(result.noPriceSkippedCount, pickup?.noPriceSkippedCount),
      skippedCount: sum(result.skipped, pickup?.skipped),
      duplicateCount: sum(result.duplicateCount, pickup?.duplicateCount),
      blockingDuplicateCount: sum(result.duplicateCount, pickup?.duplicateCount),
      invalidCount: sum(result.invalidCount, pickup?.invalidCount),
      issueSamples: [...result.issueSamples, ...(pickup?.issueSamples || [])],
      plateAlloc: rp012Products.some((product) => product.is_pending_plate === true) ? allocator.snapshot() : undefined,
      message: `✓ ${S(partner.name || partner.partner_name || '손오공')} [손오공구독+픽업구독] — ${sum(result.imported, pickup?.imported)}매물`,
      products: rp012Products,
    });
  }

  if (wants('RP023')) {
    const partner = partnerByCode.get('RP023');
    if (!partner) throw new Error('영업자 상품리스트 공급사 설정 없음(RP023)');
    const allocator = allocatorFor('RP023', partner);
    const pendingOccurrence = pendingOccurrences.get('RP023') || new Map<string, number>();
    pendingOccurrences.set('RP023', pendingOccurrence);
    /**
     * ★오플구독은 「12개월 2만km」처럼 **주행 구간별 요금**이라 오플 전용 파서로 읽는다(일반 파서는 그 요금을 못 읽어 전부 «가격없음»이 된다).
     *   보증금은 시트에 글자(「국산: 월 대여료×2」)로 적히므로 규칙으로 만든다(depositRule).
     *   프로모션 탭이 없으면 본탭만 읽는다(2026-08-19 탭 3개 확정).
     */
    const result = importAutoplusTables({
      mainRaw: input.autoplusMain.rows,
      promoRaw: input.autoplusPromo?.rows || [],
      providerCode: 'RP023',
      entries: [],
      authoritativeRefinedRows: true,
      plateAllocator: allocator,
      pendingOccurrence,
      depositRule: 'rent_multiple',
      mainGid: input.autoplusMain.gid,
      promoGid: input.autoplusPromo?.gid,
      mainTabTitle: input.autoplusMain.title,
      promoTabTitle: input.autoplusPromo?.title,
    });
    fetchedLines.push({
      code: 'RP023',
      label: S(partner.name || partner.partner_name || '오토플러스'),
      ok: true,
      sourceRowCount: result.total,
      imported: result.imported,
      excludedCount: result.excludedCount,
      noPriceCount: result.noPriceCount,
      noPriceSkippedCount: result.noPriceSkippedCount,
      skippedCount: result.skipped,
      duplicateCount: result.duplicateCount,
      blockingDuplicateCount: result.duplicateCount,
      invalidCount: result.invalidCount,
      issueSamples: result.issueSamples,
      plateAlloc: result.products.some((product) => product.is_pending_plate === true) ? allocator.snapshot() : undefined,
      message: `✓ ${S(partner.name || partner.partner_name || '오토플러스')} [오플구독] — ${result.imported}매물`,
      products: result.products,
    });
  }

  const lines = mergePartnerLines(fetchedLines);
  if (requested.size) {
    const missing = [...requested].filter((code) => !lines.some((line) => line.code === code));
    if (missing.length) throw new Error(`영업자 상품리스트 3개 탭에 요청 공급사가 없습니다(${missing.join(', ')})`);
  }
  const products = lines.flatMap((line) => line.products);
  const codes = new Set(lines.map((line) => line.code));
  return {
    lines,
    products,
    partnerCount: lines.length,
    rosterRevision: sheetPartnerRevision(input.partners, codes),
    sourceKind: 'sales_inventory',
    sourceScope: requested.size ? 'providers' : 'all',
  };
}
