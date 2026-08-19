/**
 * 상품마스터 → ERP 유입 변환.
 *
 * 공급사 원본의 열 위치나 문구는 여기서 다시 추정하지 않는다. 상품마스터에 한 번 확정된
 * 차량번호·공급사코드·차종코드와 상태/가격 원자만 읽고, 차종코드는 행 단위 차종마스터
 * 레코드에 정확히 조인한다. 따라서 공급사 시트 열이 움직여도 ERP 정본은 흔들리지 않는다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { PRODUCT_TYPES } from '@/lib/intake/entities';
import {
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_PERIODS,
  PRODUCT_MASTER_TAB,
  type ProductMasterManagementState,
  type ProductMasterVerificationState,
} from '@/lib/domain/product-master-sheet';
import { canonProductType, isExactRealPlate, normalizeProductOptionsText, normalizeWonPair } from '@/lib/domain/product';
import { canonSheetVehicleStatus } from '@/lib/domain/sheet-import';
import { classifyVehicleClass } from '@/lib/domain/vehicle-class';
import type { VehicleTrimMasterRecord } from '@/lib/domain/vehicle-trim-master';
import {
  sheetPartnerRosterRevision,
  type PartnerFetchLine,
  type PartnerSheetsFetch,
} from '@/lib/domain/sheet-sync-all';
import {
  normalizedNameForKey,
  type AdoptedSpecName,
} from '@/lib/domain/product-vehicle-normalization';
import type { ProductVehicleReviewDecision } from '@/lib/domain/product-vehicle-review-decisions';
import { applyColors } from '@/lib/domain/color-master';

const S = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const compact = (value: unknown) => S(value).replace(/\s+/g, '');
const plateKey = (value: unknown) => S(value).replace(/\s/g, '');
const meaningful = (value: unknown): string => {
  const text = S(value);
  return !text || /^(?:미입력|미분류|-|—|–)$/i.test(text) ? '' : text;
};

type HeaderIndex = Record<(typeof PRODUCT_MASTER_COLUMNS)[number], number>;

function headerIndex(table: string[][]): HeaderIndex {
  const header = table[0] || [];
  const duplicates = header.filter((name, index) => name && header.indexOf(name) !== index);
  if (duplicates.length) throw new Error(`상품마스터 헤더 중복(${[...new Set(duplicates)].join(', ')})`);
  const missing = PRODUCT_MASTER_COLUMNS.filter((name) => !header.includes(name));
  if (missing.length) throw new Error(`상품마스터 필수 열 없음(${missing.join(', ')})`);
  const unexpected = header.filter((name) => S(name) && !PRODUCT_MASTER_COLUMNS.includes(name as never));
  if (unexpected.length) throw new Error(`상품마스터 알 수 없는 열(${unexpected.join(', ')})`);
  if (header.length !== PRODUCT_MASTER_COLUMNS.length
    || PRODUCT_MASTER_COLUMNS.some((name, index) => header[index] !== name)) {
    throw new Error('상품마스터 열 순서가 규격과 다릅니다(A:AX 50열)');
  }
  return Object.fromEntries(PRODUCT_MASTER_COLUMNS.map((name, index) => [name, index])) as HeaderIndex;
}

function rawField(raw: unknown, labels: string[]): string {
  const text = S(raw);
  for (const part of text.split('|').map(S)) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const key = compact(part.slice(0, colon));
    if (labels.some((label) => key === compact(label))) return meaningful(part.slice(colon + 1));
  }
  return '';
}

function numericAtom(value: unknown, kind: 'plain' | 'mileage' = 'plain'): number | undefined {
  const raw = meaningful(value).replace(/,/g, '');
  if (!raw) return undefined;
  const tenThousand = kind === 'mileage' ? raw.match(/^([\d.]+)만(?:km)?$/i) : null;
  const number = tenThousand ? Number(tenThousand[1]) * 10_000 : Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
}

function yearAtom(value: unknown): string {
  const raw = meaningful(value);
  if (!raw) return '';
  const full = raw.match(/(?:19|20)\d{2}/)?.[0];
  if (full) return full;
  const short = raw.match(/(?:^|\D)(\d{2})(?:MY|년|$)/i)?.[1];
  return short ? `20${short}` : raw;
}

function money(value: unknown): number | undefined {
  const raw = meaningful(value);
  if (!raw) return undefined;
  const number = Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
}

function priceMap(
  cells: string[],
  at: HeaderIndex,
  providerCode: string,
  rowNumber: number,
): { price: Record<string, { rent: number; deposit: number }>; issues: string[] } {
  const price: Record<string, { rent: number; deposit: number }> = {};
  const issues: string[] = [];
  const put = (key: string, rentColumn: keyof HeaderIndex, depositColumn: keyof HeaderIndex) => {
    const rent = money(cells[at[rentColumn]]);
    const deposit = money(cells[at[depositColumn]]);
    if (rent === undefined && deposit === undefined) return;
    if (rent === undefined || deposit === undefined) {
      // 보증금 공란을 0원(무보증)으로 만들지 않는다. 그 기간만 ERP 가격에서 제외하고
      // 검수 메타에 남긴다. 나머지 기간과 차량상태는 계속 반영할 수 있어야 한다.
      issues.push(`${rowNumber}행 ${String(rentColumn).replace(' 대여료', '')} ${rent === undefined ? '대여료' : '보증금'} 미입력`);
      return;
    }
    if (rent <= 0) throw new Error(`상품마스터 ${rowNumber}행 대여료 오류(${rentColumn})`);
    price[key] = normalizeWonPair(rent, deposit);
  };

  for (const months of PRODUCT_MASTER_PERIODS) {
    // 상품마스터 표에서 오토플러스 12개월은 3만km 예외를 기본칸에 보관한다.
    // ERP에서는 조건을 잃지 않도록 12_3만, 나머지 기본가는 연 2만 키로 명시한다.
    const key = providerCode === 'RP023'
      ? `${months}_${months === 12 ? '3만' : '2만'}`
      : String(months);
    put(key, `${months}개월 대여료`, `${months}개월 보증금`);
  }
  for (const months of [18, 24, 36] as const) {
    put(`${months}_3만`, `${months}개월 3만km 대여료`, `${months}개월 3만km 보증금`);
  }
  for (const months of [36, 48, 60] as const) {
    put(`${months}_인수형`, `인수형 ${months}개월 대여료`, `인수형 ${months}개월 보증금`);
  }
  return { price, issues };
}

function trimIdentity(
  record: VehicleTrimMasterRecord,
  adopted?: Map<string, AdoptedSpecName>,
  preferMasterNames = false,
): EntityRecord {
  const named = adopted
    ? normalizedNameForKey(
      record.trim_row_key,
      new Map([[record.trim_row_key, record]]),
      adopted,
      { preferMasterNames },
    )
    : null;
  const identity: EntityRecord = {
    maker: named?.maker || record.maker,
    model: named?.model || record.model,
    sub_model: named?.sub_model || record.sub_model,
    catalog_id: record.master_id,
    trim_row_key: record.trim_row_key,
    variant: record.powertrain,
    trim_name: named?.trim || record.trim,
    fuel_type: record.fuel,
    engine_cc: record.engine_cc == null ? undefined : String(record.engine_cc),
    seats: record.seats == null ? undefined : String(record.seats),
    drive_type: record.drivetrain || undefined,
    gen_year_start: record.model_year_start || record.production_start || undefined,
    gen_year_end: record.model_year_end || record.production_end || undefined,
    _product_master_name_adopted: Boolean(named?.adopted),
  };
  identity.vehicle_class = classifyVehicleClass(identity);
  return identity;
}

function reviewIdentityFromDecision(d: ProductVehicleReviewDecision): EntityRecord | null {
  if (d.decision === 'HOLD') return null;
  if (d.decision === 'PARTIAL') {
    if (!(d.model && d.sub_model)) return null;
    return {
      maker: d.maker, model: d.model, sub_model: d.sub_model, trim_name: '',
      source: 'decision', decision: d.decision,
    };
  }
  if (!(d.model && d.sub_model && d.trim)) return null;
  return {
    maker: d.maker, model: d.model, sub_model: d.sub_model, trim_name: d.trim,
    source: 'decision', decision: d.decision,
  };
}

function rowProduct(input: {
  cells: string[];
  rowNumber: number;
  at: HeaderIndex;
  trimByCode: Map<string, VehicleTrimMasterRecord>;
  adopted?: Map<string, AdoptedSpecName>;
  decisionsByPlate?: Map<string, ProductVehicleReviewDecision>;
  preferMasterNames?: boolean;
}): { product: EntityRecord; providerName: string; management: ProductMasterManagementState } {
  const { cells, rowNumber, at, trimByCode } = input;
  const cell = (name: keyof HeaderIndex) => cells[at[name]];
  const carNumber = compact(cell('차량번호'));
  if (!isExactRealPlate(carNumber) && !/^100신\d{4,}$/.test(carNumber)) {
    throw new Error(`상품마스터 ${rowNumber}행 차량번호 오류(${carNumber || '공란'})`);
  }
  const providerCode = compact(cell('공급사코드'));
  if (!providerCode) throw new Error(`상품마스터 ${rowNumber}행 공급사코드 공란(${carNumber})`);
  const providerName = meaningful(cell('공급사명'));
  if (!providerName) throw new Error(`상품마스터 ${rowNumber}행 공급사명 공란(${carNumber})`);

  const verification = S(cell('검증상태')) as ProductMasterVerificationState;
  if (!['확정', '검수필요', '미매칭'].includes(verification)) {
    throw new Error(`상품마스터 ${rowNumber}행 검증상태 오류(${verification || '공란'})`);
  }
  const management = S(cell('관리상태')) as ProductMasterManagementState;
  if (!['운영', '검수필요', '중지'].includes(management)) {
    throw new Error(`상품마스터 ${rowNumber}행 관리상태 오류(${management || '공란'})`);
  }

  const masterCode = meaningful(cell('차종코드'));
  const master = masterCode ? trimByCode.get(masterCode) : undefined;
  if (masterCode && !master) throw new Error(`상품마스터 ${rowNumber}행 존재하지 않는 차종코드(${masterCode})`);
  if (verification === '미매칭' && masterCode) {
    throw new Error(`상품마스터 ${rowNumber}행 미매칭에 차종코드가 있음(${carNumber})`);
  }
  if (verification === '확정' && !master) {
    throw new Error(`상품마스터 ${rowNumber}행 확정 차량의 차종코드 누락(${carNumber})`);
  }
  if (master) {
    const expectedIdentity = [master.sub_model || master.model, master.powertrain, master.trim]
      .map(S)
      .filter(Boolean)
      .join(' · ');
    const sheetIdentity = meaningful(cell('차종마스터 적용값'));
    if (sheetIdentity !== expectedIdentity) {
      throw new Error(`상품마스터 ${rowNumber}행 차종코드·적용값 불일치(${carNumber})`);
    }
  }

  const raw = cell('공급사 원문보존');
  const sourceName = meaningful(cell('공급사 입력 차명'));
  const rawMaker = rawField(raw, ['제조사', '공급사 제조사']);
  const productTypeRaw = meaningful(cell('분류'));
  const productType = canonProductType(productTypeRaw);
  const validProductType = (PRODUCT_TYPES as readonly string[]).includes(productType) ? productType : '';
  const rawStatus = S(cell('차량상태'));
  const sourceContract = rawStatus === '계약중';
  const key = `${providerCode}_${carNumber}`;
  const confidence = verification === '확정' && master?.usage_tier === 'automatic'
    ? 'high'
    : master ? 'low' : 'none';
  const identityIssues = verification === '검수필요' && !master
    ? [`${rowNumber}행 ${carNumber} 검수필요 차종코드 없음`]
    : master && verification === '확정' && master.usage_tier !== 'automatic'
      ? [`${rowNumber}행 ${carNumber} 차종마스터 현재 ${master.management_status}/${master.verification_status}`]
      : [];
  const parsedMileage = numericAtom(rawField(raw, ['주행거리', '주행']), 'mileage');
  const parsedCc = numericAtom(rawField(raw, ['배기량', '배기', 'cc']));
  const parsedPrice = priceMap(cells, at, providerCode, rowNumber);
  const product: EntityRecord = {
    _key: key,
    product_code: key,
    car_number: carNumber,
    is_pending_plate: /^100신\d{4,}$/.test(carNumber),
    provider_company_code: providerCode,
    partner_code: providerCode,
    provider_name: providerName,
    source: 'sheet',
    source_schema: providerCode,
    status_label_raw: rawStatus,
    vehicle_status: management === '중지' ? '출고불가' : canonSheetVehicleStatus(rawStatus),
    ...(sourceContract ? { _sheet_contract_status: true } : {}),
    ...(validProductType ? { product_type: validProductType } : {}),
    _product_master_category: productTypeRaw,
    options: normalizeProductOptionsText(cell('옵션')),
    photo_link: meaningful(cell('사진링크')),
    arrival_date: meaningful(cell('입고일자')),
    policy_code: meaningful(cell('정책코드')),
    price: parsedPrice.price,
    _sheet_price_scope: 'product_master_all_periods',
    sheet_source_tab: PRODUCT_MASTER_TAB,
    sheet_source_row: rowNumber,
    _product_master_verification: verification,
    // 상품마스터에서 차종코드가 실제 차종마스터 행으로 검증된 경우에만
    // ERP의 정제 차종 식별자를 교정할 수 있다. 미매칭 원문은 기존 확정값을 덮지 않는다.
    _product_master_identity_authoritative: Boolean(master),
    _product_master_management: management,
    _product_master_review_reason: meaningful(cell('검수사유')),
    _product_master_price_issues: parsedPrice.issues,
    _product_master_identity_issues: identityIssues,
    _product_master_updated: meaningful(cell('최종갱신')),
    _product_master_origin: meaningful(cell('원천')),
    _snapped: Boolean(master),
    _snap_confidence: confidence,
    _needs_master_review: confidence !== 'high',
    _raw_vehicle: {
      maker: rawMaker,
      model: sourceName,
      year: yearAtom(rawField(raw, ['연식', '년식'])),
      fuel_type: rawField(raw, ['연료', '유종']),
      engine_cc: parsedCc,
      mileage: parsedMileage,
      ext_color: rawField(raw, ['외장', '외장색', '외부색상']),
      int_color: rawField(raw, ['내장', '내장색', '내부색상']),
      first_registration_date: rawField(raw, ['최초등록', '최초등록일']),
      source_text: meaningful(raw),
    },
  };
  if (master) Object.assign(product, trimIdentity(master, input.adopted, input.preferMasterNames));
  else {
    // 미매칭도 차번·가격·상태는 ERP에 올린다. 다만 차종을 지어내지 않고 공급사 입력 차명을
    // 검수용 모델 한 칸에만 보존해, 상품찾기에서 차량 자체가 사라지지 않게 한다.
    product.maker = rawMaker;
    product.model = sourceName;
    const decision = input.decisionsByPlate?.get(carNumber);
    if (decision) {
      const review = reviewIdentityFromDecision(decision);
      if (review) product._review_identity = review;
    }
  }
  if (parsedMileage !== undefined) product.mileage = parsedMileage;
  if (!product.engine_cc && parsedCc !== undefined) product.engine_cc = String(parsedCc);
  const parsedYear = yearAtom(rawField(raw, ['연식', '년식']));
  if (parsedYear) product.year = parsedYear;
  const firstRegistration = rawField(raw, ['최초등록', '최초등록일']);
  if (firstRegistration) product.first_registration_date = firstRegistration;
  const extColor = rawField(raw, ['외장', '외장색', '외부색상']);
  const intColor = rawField(raw, ['내장', '내장색', '내부색상']);
  // ★색상은 규격색으로(사장님 2026-08-19 「우유니화이트 → 화이트, 상품마스터에 정제된 색상으로 반영」) — 원문은 _raw_ext_color/_raw_int_color 에 보존, 규격 밖은 「기타」(applyColors).
  if (extColor) product.ext_color = extColor;
  if (intColor) product.int_color = intColor;
  if (extColor || intColor) Object.assign(product, applyColors(product));
  const rawFuel = rawField(raw, ['연료', '유종']);
  if (!product.fuel_type && rawFuel) product.fuel_type = rawFuel;
  return { product, providerName, management };
}

/** 상품마스터 한 탭을 공급사별 안전 스냅샷으로 바꾼다. 쓰기는 하지 않는다. */
export function importProductMasterSheet(input: {
  table: string[][];
  partners: EntityRecord[];
  trimRecords: VehicleTrimMasterRecord[];
  tabTitle?: string;
  tabGid?: string;
  providerCodes?: string[];
  /** 레거시 상품에는 존재하지만 파트너 명부 이관이 덜 된 공급사코드(예: 렌트존 PT-0001). */
  knownProviderCodes?: string[];
  /** 「차종마스터_규격채택」 — 있으면 코드→채택 이름으로 maker/model/sub_model/trim_name */
  adopted?: Map<string, AdoptedSpecName>;
  /** 원장 승격 후 true — artifact 이름 1순위 */
  preferMasterNames?: boolean;
  /** 코드 없는 차의 TRIPLE/PARTIAL 표시용(자동확정 아님) */
  decisions?: ProductVehicleReviewDecision[];
}): PartnerSheetsFetch {
  if (!input.trimRecords.length) throw new Error('행 단위 차종마스터 없음');
  const at = headerIndex(input.table);
  const trimByCode = new Map(input.trimRecords.map((row) => [row.trim_row_key, row]));
  if (trimByCode.size !== input.trimRecords.length) throw new Error('행 단위 차종마스터 코드 중복');
  const decisionsByPlate = new Map((input.decisions || []).map((d) => [plateKey(d.car_number), d]));
  const preferMasterNames = Boolean(input.preferMasterNames);
  const partnerByCode = new Map(input.partners
    .filter((row) => row._deleted !== true && !row.deletedAt && String(row.status || '') !== 'deleted')
    .map((row) => [S(row.partner_code || row._key), row]));
  const requested = new Set((input.providerCodes || []).map(S).filter(Boolean));
  const knownProviderCodes = new Set((input.knownProviderCodes || []).map(S).filter(Boolean));
  const grouped = new Map<string, {
    label: string;
    partnerRecordMissing: boolean;
    products: EntityRecord[];
    noPrice: number;
    priceIssues: string[];
    identityIssues: string[];
  }>();
  const keys = new Set<string>();
  let sourceRows = 0;

  for (const [offset, source] of input.table.slice(1).entries()) {
    if (source.every((cell) => !S(cell))) continue;
    // 공급사 단건 재시도는 다른 공급사의 깨진 행 때문에 함께 실패하면 안 된다.
    // exact 50열 헤더에서 공급사코드만 먼저 읽어 범위 밖 행은 엄격 파싱 전에 격리한다.
    // 코드 자체가 공란이면 어느 공급사 행인지 증명할 수 없으므로 기존처럼 fail-closed 한다.
    const sourceProviderCode = compact(source[at['공급사코드']]);
    if (requested.size && sourceProviderCode && !requested.has(sourceProviderCode)) continue;
    sourceRows++;
    const parsed = rowProduct({
      cells: source, rowNumber: offset + 2, at, trimByCode,
      adopted: input.adopted, decisionsByPlate, preferMasterNames,
    });
    const code = S(parsed.product.provider_company_code);
    const partner = partnerByCode.get(code);
    if (!partner && !knownProviderCodes.has(code)) {
      throw new Error(`상품마스터 ${offset + 2}행 ERP 공급사 설정 없음(${code})`);
    }
    const key = S(parsed.product.product_code);
    if (keys.has(key)) throw new Error(`상품마스터 상품키 중복(${key})`);
    keys.add(key);
    parsed.product.sheet_source_gid = input.tabGid || '';
    parsed.product.sheet_source_tab = input.tabTitle || PRODUCT_MASTER_TAB;
    const partnerName = S(partner?.name || partner?.partner_name);
    const group = grouped.get(code) || {
      // 일부 레거시 파트너 정본은 name 칸에 공급사코드만 들어 있다. 관리자 화면과
      // 감사로그에는 상품마스터가 명시한 실제 공급사명을 우선해 코드만 보이지 않게 한다.
      label: partnerName && compact(partnerName) !== compact(code)
        ? partnerName
        : S(parsed.providerName || partnerName || code),
      partnerRecordMissing: !partner,
      products: [],
      noPrice: 0,
      priceIssues: [],
      identityIssues: [],
    };
    group.products.push(parsed.product);
    if (!Object.keys(parsed.product.price as object).length) group.noPrice++;
    group.priceIssues.push(...((parsed.product._product_master_price_issues || []) as string[]));
    group.identityIssues.push(...((parsed.product._product_master_identity_issues || []) as string[]));
    grouped.set(code, group);
  }
  if (!sourceRows) throw new Error('상품마스터에 데이터 행이 없습니다');
  if (requested.size) {
    const unknownRequested = [...requested]
      .filter((code) => !partnerByCode.has(code) && !knownProviderCodes.has(code));
    if (unknownRequested.length) throw new Error(`ERP 공급사 설정 없음(${unknownRequested.join(', ')})`);
    const missing = [...requested].filter((code) => !grouped.has(code));
    if (missing.length) throw new Error(`상품마스터에 요청 공급사가 없습니다(${missing.join(', ')})`);
  }

  const lines: PartnerFetchLine[] = [...grouped.entries()].map(([code, group]) => ({
    code,
    label: group.label,
    ok: true,
    partnerRecordMissing: group.partnerRecordMissing,
    sourceRowCount: group.products.length,
    imported: group.products.length,
    excludedCount: 0,
    noPriceCount: group.noPrice,
    noPriceSkippedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    blockingDuplicateCount: 0,
    invalidCount: 0,
    issueSamples: [...group.priceIssues, ...group.identityIssues].slice(0, 12),
    message: `${group.partnerRecordMissing ? '⚠' : '✓'} ${group.label} [상품마스터] — ${group.products.length}매물${group.partnerRecordMissing ? ` · ERP 공급사 정본 없음(${code})` : ''}${group.priceIssues.length ? ` · 가격쌍 검수 ${group.priceIssues.length}` : ''}${group.identityIssues.length ? ` · 차종마스터 재검수 ${group.identityIssues.length}` : ''}`,
    products: group.products,
  })).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  if (!lines.length) throw new Error('상품마스터에서 연동할 차량을 찾지 못했습니다');
  const products = lines.flatMap((line) => line.products);
  const rosterRows = lines.map((line) => {
    const partner = partnerByCode.get(line.code);
    return {
      code: line.code,
      name: line.label,
      url: '',
      adapter: 'product_master',
      lastSyncedAt: partner?.last_synced_at != null ? Number(partner.last_synced_at) : null,
      syncRevision: JSON.stringify({
        code: line.code,
        name: S(partner?.name || partner?.partner_name || line.label),
        source: 'product_master',
      }),
    };
  });
  return {
    lines,
    products,
    partnerCount: lines.length,
    rosterRevision: sheetPartnerRosterRevision(rosterRows),
    sourceKind: 'product_master',
    sourceScope: requested.size ? 'providers' : 'all',
  };
}

/**
 * 상품마스터와 같은 문서의 공급사 데이터 매뉴얼을 커밋 게이트로 연결한다.
 *
 * 매뉴얼에 없는 공급사코드나 `자동반영 금지`가 명시된 공급사는 목록에는 보여 주되
 * 상품·상태 저장은 fail-closed 한다. `검수필요`만으로 막지 않는 이유는 차량번호 없는
 * 안내행처럼 상품마스터에 이미 안전하게 제외된 원본 검수도 같은 판정을 쓰기 때문이다.
 */
export function applyProductMasterManualGate(
  fetched: PartnerSheetsFetch,
  manualTable: string[][],
): PartnerSheetsFetch {
  const headerRow = manualTable.findIndex((row) => {
    const cells = row.map(S);
    return cells.includes('판정') && cells.includes('코드') && cells.includes('현재 누락·주의');
  });
  if (headerRow < 0) throw new Error('공급사 데이터 매뉴얼 헤더 없음');
  const header = manualTable[headerRow].map(S);
  const codeAt = header.indexOf('코드');
  const noteAt = header.indexOf('현재 누락·주의');
  const rowsByCode = new Map<string, string[]>();
  for (const row of manualTable.slice(headerRow + 1)) {
    const code = S(row[codeAt]);
    if (!code) continue;
    const notes = rowsByCode.get(code) || [];
    notes.push(S(row[noteAt]));
    rowsByCode.set(code, notes);
  }
  const explicitBlock = /(?:자동[^\n]{0,60}(?:갱신|반영)[^\n]{0,30}금지)|(?:(?:상품|상태|가격)(?:[·/]|\s)*(?:상품|상태|가격)?\s*반영\s*차단)|연동\s*차단/i;
  return {
    ...fetched,
    manualVerified: true,
    lines: fetched.lines.map((line) => {
      const notes = rowsByCode.get(line.code);
      const reason = !notes
        ? `공급사 데이터 매뉴얼 누락(${line.code})`
        : notes.find((note) => explicitBlock.test(note))
          ? `공급사 데이터 매뉴얼 자동반영 금지(${line.code})`
          : '';
      return {
        ...line,
        manualBlockReason: reason || undefined,
        message: reason ? `${line.message} · ${reason}` : line.message,
      };
    }),
  };
}

export type ProductMasterBlockedProvider = {
  code: string;
  label: string;
  reason: string;
};

/**
 * 상품마스터 전체 중 ERP 공급사 정본 자체가 없는 공급사만 보류한다.
 *
 * 매뉴얼의 `자동반영 금지`는 공급사 원본 → 상품마스터 자동 수집 경계에만 적용한다.
 * 이미 정제된 상품마스터 → ERP까지 같은 문구로 다시 막으면 SSOT를 두 번 검증하는
 * 셈이 되어 안전한 이력 행도 영구 보류된다. 경고 표시는 유지하되 ERP 반영 게이트로
 * 재사용하지 않는다.
 */
export function isolateProductMasterBlockedProviders(fetched: PartnerSheetsFetch): {
  fetched: PartnerSheetsFetch;
  blocked: ProductMasterBlockedProvider[];
} {
  if (fetched.sourceKind !== 'product_master') return { fetched, blocked: [] };
  const blocked = fetched.lines.flatMap((line): ProductMasterBlockedProvider[] => {
    const reason = line.partnerRecordMissing ? `ERP 공급사 정본 없음(${line.code})` : '';
    return reason ? [{ code: line.code, label: line.label, reason }] : [];
  });
  if (!blocked.length) return { fetched, blocked };
  const blockedCodes = new Set(blocked.map((item) => item.code));
  const lines = fetched.lines.filter((line) => !blockedCodes.has(line.code));
  return {
    blocked,
    fetched: {
      ...fetched,
      lines,
      products: lines.flatMap((line) => line.products),
      partnerCount: lines.length,
      // 일부 공급사를 의도적으로 보류했으므로 문서 전체 부재 판정을 절대 실행하지 않는다.
      sourceScope: 'providers',
    },
  };
}
