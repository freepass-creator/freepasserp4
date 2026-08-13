/**
 * 영업자 상품리스트 → ERP 유입 정본.
 *
 * 공급사 원본은 사람이 비교하는 참고자료다. 실제 ERP 반영은 판매용 워크북의 운영 4개 탭만 읽는다.
 * 탭 이름의 날짜·대수는 매번 바뀌므로 이름 prefix로 고르고, 공급사 표기는 파트너명에
 * 정확히 대응시킨다. 이름이 없거나 두 곳에 걸리면 잘못된 공급사로 저장하지 않고 전부 막는다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import { importSheetTable } from '@/lib/domain/sheet-import';
import { importAutoplusTables } from '@/lib/domain/sheet-autoplus';
import {
  sheetPartnerRosterRevision,
  type PartnerFetchLine,
  type PartnerSheetsFetch,
} from '@/lib/domain/sheet-sync-all';

export const DEFAULT_SALES_INVENTORY_SHEET_ID = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
export const DEFAULT_SALES_INVENTORY_TAB_PREFIX = '상품리스트';
export const SALES_SONOGONG_TAB_PREFIX = '손오공구독';
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

function normalizeSalesRows(table: string[][]): string[][] {
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
  entries: MasterEntry[];
  tabTitle: string;
  tabGid: string;
  providerCodes?: string[];
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
  const lines: PartnerFetchLine[] = [];
  for (const [code, group] of grouped) {
    const partner = partnerByCode.get(code);
    if (!partner) throw new Error(`영업자 상품리스트 공급사 설정 없음(${code})`);
    const result = importSheetTable(normalizeSalesRows(group.rows), {
      providerCode: code,
      entries: input.entries,
      acceptAssignedPendingPlate: true,
      compactPriceCells: true,
      preserveCanonicalContractStatus: true,
    });
    for (const product of result.products) {
      // 이 표가 표현하는 가격 범위는 표준 1·12·24·36·48·60개월뿐이다.
      // 6개월·주행거리 변형 같은 기존 상세가는 지우지 않고 ERP에 보존한다.
      product._sheet_price_scope = 'sales_standard_months';
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
    before.message = `✓ ${before.label} [영업자 상품리스트] — ${before.imported}매물`;
  }
  return [...byCode.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

/** 판매용 워크북의 4개 운영 탭을 탭별 규격으로 읽고 한 ERP 정본으로 합친다. */
export function importSalesInventoryWorkbook(input: {
  main: SalesInventoryWorkbookTab;
  sonogong: SalesInventoryWorkbookTab;
  autoplusMain: SalesInventoryWorkbookTab;
  autoplusPromo: SalesInventoryWorkbookTab;
  partners: EntityRecord[];
  entries: MasterEntry[];
  providerCodes?: string[];
}): PartnerSheetsFetch {
  const requested = new Set((input.providerCodes || []).map(S).filter(Boolean));
  const wants = (code: string) => !requested.size || requested.has(code);
  const base = importSalesInventorySheet({
    table: input.main.rows,
    partners: input.partners,
    entries: input.entries,
    tabTitle: input.main.title,
    tabGid: input.main.gid,
  });
  const fetchedLines = base.lines.filter((line) => wants(line.code));
  const partnerByCode = new Map(input.partners.map((partner) => [S(partner.partner_code || partner._key), partner]));

  if (wants('RP012')) {
    const partner = partnerByCode.get('RP012');
    if (!partner) throw new Error('영업자 상품리스트 공급사 설정 없음(RP012)');
    const result = importSheetTable(normalizeSalesRows(input.sonogong.rows), {
      providerCode: 'RP012',
      entries: input.entries,
      acceptAssignedPendingPlate: true,
      compactPriceCells: true,
      preserveCanonicalContractStatus: true,
      depositRule: 'months_per_year',
      photoByPlate: input.sonogong.photoByPlate,
    });
    for (const product of result.products) {
      product._sheet_price_scope = 'sales_all_periods';
      product.sheet_source_gid = input.sonogong.gid;
      product.sheet_source_tab = input.sonogong.title;
    }
    fetchedLines.push({
      code: 'RP012',
      label: S(partner.name || partner.partner_name || '손오공'),
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
      message: `✓ ${S(partner.name || partner.partner_name || '손오공')} [손오공구독] — ${result.imported}매물`,
      products: result.products,
    });
  }

  if (wants('RP023')) {
    const partner = partnerByCode.get('RP023');
    if (!partner) throw new Error('영업자 상품리스트 공급사 설정 없음(RP023)');
    const result = importAutoplusTables({
      mainRaw: input.autoplusMain.rows,
      promoRaw: input.autoplusPromo.rows,
      providerCode: 'RP023',
      entries: input.entries,
      depositRule: 'rent_multiple',
      mainPhotos: input.autoplusMain.photoByPlate,
      promoPhotos: input.autoplusPromo.photoByPlate,
      mainGid: input.autoplusMain.gid,
      promoGid: input.autoplusPromo.gid,
      mainTabTitle: input.autoplusMain.title,
      promoTabTitle: input.autoplusPromo.title,
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
      blockingDuplicateCount: result.blockingDuplicateCount,
      invalidCount: result.invalidCount,
      issueSamples: result.issueSamples,
      message: `✓ ${S(partner.name || partner.partner_name || '오토플러스')} [오플 2탭] — ${result.imported}매물`,
      products: result.products,
    });
  }

  const lines = mergePartnerLines(fetchedLines);
  if (requested.size) {
    const missing = [...requested].filter((code) => !lines.some((line) => line.code === code));
    if (missing.length) throw new Error(`영업자 상품리스트 4개 탭에 요청 공급사가 없습니다(${missing.join(', ')})`);
  }
  const products = lines.flatMap((line) => line.products);
  const codes = new Set(lines.map((line) => line.code));
  return {
    lines,
    products,
    partnerCount: lines.length,
    rosterRevision: sheetPartnerRevision(input.partners, codes),
    sourceKind: 'sales_inventory',
  };
}
