import type { EntityRecord } from '@/lib/intake/entities';
import { sheetProviderOf } from '@/lib/domain/sheet-merge';

export type DuplicateReferenceScan = {
  contracts: boolean;
  rooms: boolean;
  quotes: boolean;
  productPrivate: boolean;
};

export type DuplicateMigrationRecord = {
  carNumber: string;
  provider: string;
  representativeCandidate: string;
  candidateReason: string;
  groupDecision: string;
  productKey: string;
  vehicleStatus: string;
  source: string;
  contractLock: string;
  openContractRefs: string[];
  historicalContractRefs: string[];
  roomRefs: string[];
  quoteRefs: string[];
  hasPrivateRecord: boolean;
  plateOnlyReferences: number;
  action: string;
};

export type DuplicateMigrationGroup = {
  carNumber: string;
  provider: string;
  representativeCandidate: string;
  candidateReason: string;
  decision: string;
  blockers: string[];
  plateOnlyReferences: number;
  records: DuplicateMigrationRecord[];
};

const text = (value: unknown): string => String(value ?? '').trim();
const keyOf = (row: EntityRecord): string => text(row._key || row.product_code);
const plateOf = (row: EntityRecord): string => text(
  row.car_number || row.car_number_snapshot || row.vehicle_number,
).replace(/\s/g, '');
const safeCell = (value: unknown): string => text(value).replace(/[\t\r\n]+/g, ' ');

function recordReferenceValues(row: EntityRecord): string[] {
  return [row.product_code, row.product_uid, row.product_id]
    .map(text)
    .filter(Boolean);
}

function isOpenContract(row: EntityRecord): boolean {
  if (row._deleted === true || row.deletedAt || text(row.status) === 'deleted') return false;
  const status = text(row.contract_status || row.status).toLowerCase();
  return ![
    '계약완료', '완료', '계약취소', '취소',
    'completed', 'complete', 'cancelled', 'canceled',
  ].includes(status);
}

function referencesForKey(rows: EntityRecord[], productKey: string): EntityRecord[] {
  return rows.filter((row) => recordReferenceValues(row).includes(productKey));
}

function refLabel(row: EntityRecord): string {
  return text(
    row.contract_code
      || row.room_id
      || row.quote_code
      || row._key,
  ) || '키없음';
}

function exactCanonicalKey(provider: string, carNumber: string): string {
  return provider && carNumber ? `${provider}_${carNumber}` : '';
}

function scanBlockers(scan: DuplicateReferenceScan): string[] {
  const labels: Array<[keyof DuplicateReferenceScan, string]> = [
    ['contracts', '계약'],
    ['rooms', '채팅방'],
    ['quotes', '견적'],
    ['productPrivate', '비공개 원가'],
  ];
  return labels.filter(([key]) => !scan[key]).map(([, label]) => `${label} 참조 스캔 미완료`);
}

/**
 * 같은 공급사 안에서 같은 실차번을 가진 활성 상품의 대표키·참조 이관 계획을 만든다.
 * 결과는 검토용일 뿐 write/delete 명령이 아니다. 참조 스캔이 하나라도 빠지면 실행 금지로 판정한다.
 */
export function planProductDuplicateMigration(input: {
  products: EntityRecord[];
  contracts?: EntityRecord[];
  rooms?: EntityRecord[];
  quotes?: EntityRecord[];
  productPrivate?: EntityRecord[];
  providerCodes?: Iterable<string>;
  scan?: Partial<DuplicateReferenceScan>;
}): DuplicateMigrationGroup[] {
  const contracts = input.contracts || [];
  const rooms = input.rooms || [];
  const quotes = input.quotes || [];
  const productPrivate = input.productPrivate || [];
  const scan: DuplicateReferenceScan = {
    contracts: input.scan?.contracts ?? input.contracts !== undefined,
    rooms: input.scan?.rooms ?? input.rooms !== undefined,
    quotes: input.scan?.quotes ?? input.quotes !== undefined,
    productPrivate: input.scan?.productPrivate ?? input.productPrivate !== undefined,
  };
  const providerCodes = new Set(input.providerCodes || []);
  const groups = new Map<string, EntityRecord[]>();
  const providersByPlate = new Map<string, Set<string>>();

  for (const product of input.products) {
    if (product._deleted === true || product.deletedAt || text(product.status) === 'deleted') continue;
    const carNumber = plateOf(product);
    if (!carNumber) continue;
    const provider = sheetProviderOf(product, providerCodes)
      || text(product.provider_company_code || product.partner_code)
      || '미확정';
    const plateProviders = providersByPlate.get(carNumber) || new Set<string>();
    plateProviders.add(provider);
    providersByPlate.set(carNumber, plateProviders);
    const id = `${provider}|${carNumber}`;
    groups.set(id, [...(groups.get(id) || []), product]);
  }

  const output: DuplicateMigrationGroup[] = [];
  for (const [id, products] of groups) {
    if (products.length < 2) continue;
    const [provider, carNumber] = id.split('|');
    const keys = new Set(products.map(keyOf).filter(Boolean));
    const perKey = new Map(products.map((product) => {
      const productKey = keyOf(product);
      const exactContracts = referencesForKey(contracts, productKey);
      const openContracts = exactContracts.filter(isOpenContract);
      const historicalContracts = exactContracts.filter((row) => !isOpenContract(row));
      const exactRooms = referencesForKey(rooms, productKey);
      const exactQuotes = referencesForKey(quotes, productKey);
      const hasPrivateRecord = productPrivate.some((row) => keyOf(row) === productKey);
      return [productKey, {
        product,
        openContracts,
        historicalContracts,
        rooms: exactRooms,
        quotes: exactQuotes,
        hasPrivateRecord,
        exactReferenceCount: exactContracts.length + exactRooms.length + exactQuotes.length + Number(hasPrivateRecord),
      }] as const;
    }));
    const protectedKeys = products
      .map(keyOf)
      .filter((productKey) => {
        const item = perKey.get(productKey);
        return !!text(item?.product.locked_by_contract) || !!item?.openContracts.length;
      });
    const uniqueProtected = [...new Set(protectedKeys)];
    const canonical = exactCanonicalKey(provider, carNumber);
    const canonicalKeys = products.map(keyOf).filter((productKey) => productKey === canonical);
    const rankedByReferences = [...perKey.entries()]
      .sort((a, b) => b[1].exactReferenceCount - a[1].exactReferenceCount);

    let representativeCandidate = '';
    let candidateReason = '';
    if (uniqueProtected.length === 1) {
      representativeCandidate = uniqueProtected[0];
      candidateReason = '진행계약 또는 계약락 보존';
    } else if (uniqueProtected.length === 0 && canonicalKeys.length === 1) {
      representativeCandidate = canonicalKeys[0];
      candidateReason = '공급사_차번 표준키';
    } else if (
      uniqueProtected.length === 0
      && rankedByReferences[0]?.[1].exactReferenceCount > 0
      && rankedByReferences[0][1].exactReferenceCount > (rankedByReferences[1]?.[1].exactReferenceCount || 0)
    ) {
      representativeCandidate = rankedByReferences[0][0];
      candidateReason = '정확 참조가 가장 많은 기존키';
    }

    const blockers = scanBlockers(scan);
    if (provider === '미확정') blockers.push('공급사 귀속 미확정');
    const competingProviders = [...(providersByPlate.get(carNumber) || [])];
    if (competingProviders.length > 1) {
      blockers.push(`차번의 공급사 소유권 충돌 (${competingProviders.join(', ')})`);
    }
    if (uniqueProtected.length > 1) blockers.push('둘 이상의 상품키가 진행계약으로 보호됨');
    if (!representativeCandidate) blockers.push('대표키 자동 후보 없음');

    const plateOnlyReferences = [...contracts, ...rooms, ...quotes].filter((row) => {
      if (plateOf(row) !== carNumber) return false;
      return !recordReferenceValues(row).some((value) => keys.has(value));
    }).length;
    if (plateOnlyReferences) blockers.push(`상품키 없는 차번 참조 ${plateOnlyReferences}건 수동 확인`);

    const decision = blockers.length
      ? '사람·Claude 확인 전 실행 금지'
      : '대표키 후보 검토 후 참조 이관';
    const records = products
      .map((product): DuplicateMigrationRecord => {
        const productKey = keyOf(product);
        const refs = perKey.get(productKey)!;
        const isCandidate = productKey === representativeCandidate;
        const protectedRecord = !!text(product.locked_by_contract) || refs.openContracts.length > 0;
        return {
          carNumber,
          provider,
          representativeCandidate,
          candidateReason,
          groupDecision: decision,
          productKey,
          vehicleStatus: text(product.vehicle_status || product.status),
          source: text(product.source || product.source_schema),
          contractLock: text(product.locked_by_contract),
          openContractRefs: refs.openContracts.map(refLabel),
          historicalContractRefs: refs.historicalContracts.map(refLabel),
          roomRefs: refs.rooms.map(refLabel),
          quoteRefs: refs.quotes.map(refLabel),
          hasPrivateRecord: refs.hasPrivateRecord,
          plateOnlyReferences,
          action: isCandidate
            ? '유지 후보'
            : protectedRecord
              ? '계약보호 · 자동이관 금지'
              : '참조 이관 검토 후 중복정리 후보',
        };
      })
      .sort((a, b) => Number(b.productKey === representativeCandidate)
        - Number(a.productKey === representativeCandidate)
        || a.productKey.localeCompare(b.productKey));

    output.push({
      carNumber,
      provider,
      representativeCandidate,
      candidateReason,
      decision,
      blockers: [...new Set(blockers)],
      plateOnlyReferences,
      records,
    });
  }
  return output.sort((a, b) => a.provider.localeCompare(b.provider) || a.carNumber.localeCompare(b.carNumber));
}

export function productDuplicateMigrationTsv(groups: DuplicateMigrationGroup[]): string {
  return [
    [
      '차량번호', '공급사', '대표키후보', '후보근거', '그룹판정', '차단사유', '상품키',
      '차량상태', '출처', '계약락', '진행계약참조', '과거계약참조', '채팅방참조',
      '견적참조', '비공개원가', '차번전용참조', '레코드조치',
    ],
    ...groups.flatMap((group) => group.records.map((row) => [
      row.carNumber,
      row.provider,
      row.representativeCandidate,
      row.candidateReason,
      row.groupDecision,
      group.blockers.join(' · '),
      row.productKey,
      row.vehicleStatus,
      row.source,
      row.contractLock,
      row.openContractRefs.join(', '),
      row.historicalContractRefs.join(', '),
      row.roomRefs.join(', '),
      row.quoteRefs.join(', '),
      row.hasPrivateRecord ? '있음' : '없음',
      row.plateOnlyReferences,
      row.action,
    ])),
  ].map((cells) => cells.map(safeCell).join('\t')).join('\n');
}
