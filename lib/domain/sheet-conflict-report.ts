import type { EntityRecord } from '@/lib/intake/entities';
import { sheetProviderOf } from '@/lib/domain/sheet-merge';
import type { SheetSyncExistingConflicts } from '@/lib/domain/sheet-sync-all';
import { priceList } from '@/lib/domain/product';

export type SheetConflictReportRow = {
  category: string;
  decision: string;
  carNumber: string;
  provider: string;
  productKey: string;
  storageKey: string;
  vehicleStatus: string;
  source: string;
  contractProtection: string;
  priceImpact: string;
  affectedPricePeriods: string;
  raw: string;
};

const text = (value: unknown): string => String(value ?? '').trim();
const plate = (row: EntityRecord): string => text(row.car_number || row.car_number_snapshot).replace(/\s/g, '');
const recordKey = (row: EntityRecord): string => text(row._key || row.product_code);
const safeCell = (value: unknown): string => text(value).replace(/[\t\r\n]+/g, ' ');
const conflictPlate = (value: string): string => text(value).split(' (')[0].split('|').at(-1) || '';
const conflictProvider = (value: string): string => {
  const head = text(value).split(' (')[0];
  const separator = head.indexOf('|');
  return separator > 0 ? head.slice(0, separator) : '';
};

function isOpenContract(row: EntityRecord): boolean {
  if (row._deleted === true || row.deletedAt) return false;
  const status = text(row.contract_status || row.status);
  return !['계약완료', '완료', '계약취소', '취소'].includes(status);
}

function contractProtection(row: EntityRecord, contracts: EntityRecord[]): string {
  const lock = text(row.locked_by_contract);
  if (lock) return `계약락 ${lock}`;
  const key = recordKey(row);
  const carNumber = plate(row);
  const linked = contracts.find((contract) => isOpenContract(contract) && [
    text(contract.product_uid),
    text(contract.product_code),
    text(contract.car_number_snapshot).replace(/\s/g, ''),
    text(contract.car_number).replace(/\s/g, ''),
  ].some((value) => !!value && (value === key || value === carNumber)));
  return linked ? `진행계약 ${text(linked.contract_code || linked._key) || '확인필요'}` : '';
}

function detailRow(
  category: string,
  decision: string,
  raw: string,
  row: EntityRecord | undefined,
  providerCodes: Set<string>,
  contracts: EntityRecord[],
): SheetConflictReportRow {
  if (!row) return {
    category, decision, carNumber: conflictPlate(raw), provider: conflictProvider(raw), productKey: '', storageKey: '',
    vehicleStatus: '', source: '', contractProtection: '', priceImpact: '', affectedPricePeriods: '', raw,
  };
  const protection = contractProtection(row, contracts);
  return {
    category,
    decision: protection ? '계약보호 · 자동수정 금지' : decision,
    carNumber: plate(row) || conflictPlate(raw),
    provider: sheetProviderOf(row, providerCodes) || text(row.provider_company_code || row.partner_code) || '미확정',
    productKey: recordKey(row),
    storageKey: text(row._rtdb_key || row._key || row.product_code),
    vehicleStatus: text(row.vehicle_status || row.status),
    source: text(row.source || row.source_schema),
    contractProtection: protection,
    priceImpact: '',
    affectedPricePeriods: '',
    raw,
  };
}

function priceImpact(before: EntityRecord | undefined, incoming: EntityRecord | undefined): {
  impact: string;
  periods: string;
} {
  if (!before || !incoming) return { impact: '원본 연결 확인필요', periods: '' };
  const beforePrices = new Map(priceList(before).map((entry) => [entry.m, entry]));
  const incomingPrices = new Map(priceList(incoming).map((entry) => [entry.m, entry]));
  const removed = [...beforePrices.keys()].filter((month) => !incomingPrices.has(month));
  const changed = [...beforePrices.entries()].filter(([month, value]) => {
    const next = incomingPrices.get(month);
    return !!next && (next.rent !== value.rent || next.deposit !== value.deposit);
  }).map(([month]) => month);
  const labels: string[] = [];
  // 실제 soft-merge는 누락기간을 삭제하지 않고 기존값으로 보존한다. 여기서는
  // incoming 단독 구조가 현재 화면 가격과 어떻게 다른지 승인자가 판단할 문구로 표시한다.
  if (removed.length) labels.push('시트 누락기간 기존가 유지 필요');
  if (changed.length) labels.push('새 기본가격 적용 확인 필요');
  if (!labels.length) labels.push('표시 기본가격 동일');
  return {
    impact: labels.join(' · '),
    periods: [...new Set([...removed, ...changed])].sort((a, b) => a - b).map((month) => `${month}개월`).join(', '),
  };
}

export function buildSheetConflictReportRows(input: {
  conflicts: SheetSyncExistingConflicts;
  existing: EntityRecord[];
  deleted: EntityRecord[];
  incoming?: EntityRecord[];
  contracts?: EntityRecord[];
  providerCodes?: Iterable<string>;
}): SheetConflictReportRow[] {
  const contracts = input.contracts || [];
  const providerCodes = new Set(input.providerCodes || []);
  const rows: SheetConflictReportRow[] = [];
  const existingByKey = new Map(input.existing.map((row) => [recordKey(row), row]));

  for (const raw of input.conflicts.activeTwins) {
    const group = raw.split(' (')[0];
    const separator = group.indexOf('|');
    const provider = separator >= 0 ? group.slice(0, separator) : '';
    const carNumber = separator >= 0 ? group.slice(separator + 1) : conflictPlate(raw);
    const matches = input.existing.filter((row) => plate(row) === carNumber
      && sheetProviderOf(row, providerCodes) === provider);
    if (!matches.length) rows.push(detailRow('활성 중복차번', '대표키·참조 이관 후 중복 정리', raw, undefined, providerCodes, contracts));
    for (const row of matches) rows.push(detailRow(
      '활성 중복차번',
      '대표키·참조 이관 후 중복 정리',
      raw,
      row,
      providerCodes,
      contracts,
    ));
  }

  for (const raw of input.conflicts.crossProviderPlateConflicts) {
    const carNumber = conflictPlate(raw);
    const matches = input.existing.filter((row) => plate(row) === carNumber);
    if (!matches.length) rows.push(detailRow('공급사 소유 충돌', '실소유 공급사 확인', raw, undefined, providerCodes, contracts));
    for (const row of matches) rows.push(detailRow(
      '공급사 소유 충돌', '실소유 공급사 확인', raw, row, providerCodes, contracts,
    ));
  }

  for (const raw of input.conflicts.deletedCollisions) {
    const carNumber = conflictPlate(raw);
    const matches = input.deleted.filter((row) => plate(row) === carNumber || recordKey(row) === raw);
    if (!matches.length) rows.push(detailRow('삭제이력 재등장', '복구 또는 신규생성 승인', raw, undefined, providerCodes, contracts));
    for (const row of matches) rows.push(detailRow(
      '삭제이력 재등장', '복구 또는 신규생성 승인', raw, row, providerCodes, contracts,
    ));
  }

  const keyedCategories: Array<[string, string, string[]]> = [
    ['수기 출고불가 해제 후보', '상태 유지·해제 결정', input.conflicts.manualReactivations],
    ['수기 출고불가 유지', '현재 내부 상태 유지', input.conflicts.manualHoldsPreserved],
  ];
  for (const [category, decision, values] of keyedCategories) {
    for (const raw of values) rows.push(detailRow(
      category, decision, raw, existingByKey.get(raw), providerCodes, contracts,
    ));
  }

  const summaryCategories: Array<[string, string, string[]]> = [
    ['공급사 미확정 삭제이력', '기존 삭제 소유 확인', input.conflicts.unownedDeletedMatches],
    ['임시번호→실차번', '동일 차량 수동 연결', input.conflicts.pendingIdentityTransitions],
    ['번호미정 식별변경', '기존·신규 차량 수동 연결', input.conflicts.pendingIdentityDrifts],
    ['임시번호 신원불일치', '최초 신원서명 확인', input.conflicts.pendingSignatureConflicts],
    ['공급사 미확정 기존차', '기존차 공급사 귀속 확정', input.conflicts.unownedLegacyMatches],
  ];
  for (const [category, decision, values] of summaryCategories) {
    for (const raw of values) rows.push(detailRow(
      category, decision, raw, undefined, providerCodes, contracts,
    ));
  }

  // 가격기간 충돌은 `공급사|차량번호 (기간...)` 형식이므로 기존 상품까지 연결한다.
  // 그래야 공급사별 작업량, 상품키, 계약보호 여부가 상세 보고서에서 유실되지 않는다.
  for (const raw of input.conflicts.missingPricePeriods) {
    const provider = conflictProvider(raw);
    const carNumber = conflictPlate(raw);
    const matches = input.existing.filter((row) => plate(row) === carNumber
      && sheetProviderOf(row, providerCodes) === provider);
    const incoming = input.incoming?.find((row) => plate(row) === carNumber
      && sheetProviderOf(row, providerCodes) === provider);
    if (!matches.length) {
      const reportRow = detailRow(
        '기존 가격기간 누락', '원본 복구 또는 기간삭제 승인', raw, undefined, providerCodes, contracts,
      );
      const impact = priceImpact(undefined, incoming);
      rows.push({ ...reportRow, priceImpact: impact.impact, affectedPricePeriods: impact.periods });
    }
    for (const row of matches) {
      const reportRow = detailRow(
        '기존 가격기간 누락', '원본 복구 또는 기간삭제 승인', raw, row, providerCodes, contracts,
      );
      const impact = priceImpact(row, incoming);
      rows.push({ ...reportRow, priceImpact: impact.impact, affectedPricePeriods: impact.periods });
    }
  }
  return rows;
}

/**
 * 「반영하면 손님에게 나가는 금액이 실제로 바뀌는가」 — 가격기간 충돌의 승인 요구 여부 SSOT.
 *
 * soft-merge 는 시트에서 사라진 기간을 **삭제하지 않고 기존값으로 보존**한다(위 `priceImpact` 주석).
 * 그래서 금액이 안 바뀌는 건은 승인해도 결과가 같다 — 승인을 요구할 이유가 없다.
 *
 * ★네 곳(미리보기·반영 전 재검증·커밋 경계·일일 자동연동)이 **같은 판정**을 써야 한다.
 *   한 곳만 이 함수를 안 쓰면 「화면엔 승인할 것이 없는데 반영은 막히는」 데드락이 된다
 *   (실측 2026-08-07: 차단 39건 전부가 무변화 건이라 승인 후보가 0건이었다).
 */
export function buildPriceChangesValue(
  input: Parameters<typeof buildSheetConflictReportRows>[0],
): (raw: string) => boolean {
  return priceChangesValueFromRows(buildSheetConflictReportRows(input));
}

/**
 * 이미 만들어 둔 리포트 행에서 같은 판정을 뽑는다(화면용).
 *
 * 미리보기는 표를 그리려고 행을 이미 계산해 뒀다. 그렇다고 판정식을 그 자리에 다시 쓰면
 * **규칙이 두 벌이 된다** — 「새 기본가격 적용」이라는 문구가 바뀌는 날 한쪽만 고쳐지고,
 * 그때 다시 「화면엔 승인할 것이 없는데 반영은 막히는」 데드락으로 돌아온다.
 * 계산은 재사용하고 **판정은 한 곳**에 둔다.
 */
export function priceChangesValueFromRows(
  rows: { raw: string; priceImpact?: string }[],
): (raw: string) => boolean {
  const impactByRaw = new Map(rows.map((row) => [row.raw, String(row.priceImpact || '')]));
  return (raw: string) => (impactByRaw.get(raw) || '').includes('새 기본가격 적용');
}

export function sheetConflictReportTsv(rows: SheetConflictReportRow[]): string {
  return [
    ['구분', '판단', '차량번호', '공급사', '상품키', '저장키', '차량상태', '출처', '계약보호', '가격영향', '영향기간', '원본충돌'],
    ...rows.map((row) => [
      row.category, row.decision, row.carNumber, row.provider, row.productKey, row.storageKey,
      row.vehicleStatus, row.source, row.contractProtection, row.priceImpact, row.affectedPricePeriods, row.raw,
    ]),
  ].map((cells) => cells.map(safeCell).join('\t')).join('\n');
}
