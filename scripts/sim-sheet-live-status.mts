import type { EntityRecord } from '../lib/intake/entities';
import { planSheetLiveStatusSync } from '../lib/domain/sheet-live-status';
import type { PartnerFetchLine, PartnerSheetsFetch } from '../lib/domain/sheet-sync-all';

const cases: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => cases.push({ name, ok, detail });
const provider = 'RP100';

const product = (plate: string, extra: EntityRecord = {}): EntityRecord => ({
  _key: `${provider}_${plate}`,
  product_code: `${provider}_${plate}`,
  provider_company_code: provider,
  partner_code: provider,
  source: 'sheet',
  source_schema: provider,
  car_number: plate,
  maker: '현대',
  model: '아반떼',
  vehicle_status: '출고가능',
  price: { '36': { rent: 500_000 } },
  ...extra,
});

const line = (rows: EntityRecord[], over: Partial<PartnerFetchLine> = {}): PartnerFetchLine => ({
  code: provider,
  label: '테스트 공급사',
  ok: true,
  sourceRowCount: rows.length,
  imported: rows.length,
  excludedCount: 0,
  noPriceCount: 0,
  noPriceSkippedCount: 0,
  skippedCount: 0,
  duplicateCount: 0,
  blockingDuplicateCount: 0,
  invalidCount: 0,
  issueSamples: [],
  message: '',
  products: rows,
  ...over,
});

const fetched = (rows: EntityRecord[], over: Partial<PartnerSheetsFetch> = {}): PartnerSheetsFetch => {
  const one = line(rows);
  return {
    lines: [one],
    products: one.products,
    partnerCount: 1,
    rosterRevision: 'roster:live-status-test',
    sourceKind: 'product_master',
    manualVerified: true,
    ...over,
  };
};

const partners: EntityRecord[] = [{
  _key: provider,
  partner_code: provider,
  partner_type: '공급사',
  name: '테스트 공급사',
}];

const before = product('12가3456', { model: '기존 모델', vehicle_status: '출고협의' });
const normal = planSheetLiveStatusSync({
  fetched: fetched([product('12가3456', { model: '시트 모델', vehicle_status: '즉시출고' })]),
  existing: [before],
  partners,
});
const normalPatch = normal.patches[0]?.patch;
check('상태 변경은 즉시 반영 계획에 포함', normal.ok && normalPatch?.vehicle_status === '즉시출고', normal);
check('상태 전용 계획은 모델·가격 등 다른 원자를 쓰지 않음',
  normalPatch?.model === undefined && normalPatch?.price === undefined
  && Object.keys(normalPatch || {}).every((key) => [
    'vehicle_status', 'sheet_status_owner', 'sheet_block_reason', 'sheet_blocked_at',
  ].includes(key)),
  normalPatch);

const locked = product('12가3456', { vehicle_status: '계약중', locked_by_contract: 'CT-1' });
const lockedPlan = planSheetLiveStatusSync({
  fetched: fetched([product('12가3456', { vehicle_status: '출고가능' })]),
  existing: [locked],
  partners,
});
check('계약 엔진이 잠근 차량은 시트 상태가 절대 해제하지 않음',
  lockedPlan.ok && lockedPlan.patches.length === 0 && lockedPlan.counts.lockedPreserved === 1,
  lockedPlan);

const sourceContract = planSheetLiveStatusSync({
  fetched: fetched([product('12가3456', { vehicle_status: '계약중', _sheet_contract_status: true })]),
  existing: [product('12가3456')],
  partners,
});
const sourceContractPatch = sourceContract.patches[0]?.patch;
check('시트 계약중은 ERP 계약락을 만들지 않고 판매만 차단',
  sourceContract.ok
  && sourceContractPatch?.vehicle_status === '출고불가'
  && sourceContractPatch?.sheet_status_owner === 'sheet'
  && sourceContractPatch?.sheet_block_reason === 'source_contract_status'
  && sourceContractPatch?.locked_by_contract === undefined,
  sourceContractPatch);

const manualHold = product('12가3456', { vehicle_status: '출고불가', source: 'manual' });
const manualPlan = planSheetLiveStatusSync({
  fetched: fetched([product('12가3456', { vehicle_status: '즉시출고' })]),
  existing: [manualHold],
  partners,
});
check('운영자 수기 출고불가는 실시간 시트가 자동 해제하지 않음',
  manualPlan.ok && manualPlan.patches.length === 0 && manualPlan.counts.manualHoldsPreserved === 1,
  manualPlan);

const absent = product('34나5678', { vehicle_status: '출고가능' });
const absentPlan = planSheetLiveStatusSync({
  fetched: fetched([product('12가3456')]),
  existing: [product('12가3456'), absent],
  partners,
});
const absentPatch = absentPlan.patches.find((item) => item.key === absent.product_code)?.patch;
check('상품마스터에서 사라진 차량은 실시간으로 시트소유 출고불가',
  absentPlan.ok
  && absentPatch?.vehicle_status === '출고불가'
  && absentPatch.sheet_status_owner === 'sheet'
  && absentPatch.provider_company_code === undefined,
  absentPatch);

const reappeared = product('12가3456', {
  vehicle_status: '출고불가',
  sheet_status_owner: 'sheet',
  sheet_block_reason: 'missing_or_excluded',
  sheet_blocked_at: 1,
});
const reappearPlan = planSheetLiveStatusSync({
  fetched: fetched([product('12가3456', { vehicle_status: '출고가능' })]),
  existing: [reappeared],
  partners,
});
const reappearPatch = reappearPlan.patches[0]?.patch;
check('시트 부재로 막힌 차량은 재등장 시 상태와 소유 표식을 함께 복구',
  reappearPatch?.vehicle_status === '출고가능'
  && reappearPatch.sheet_status_owner === null
  && reappearPatch.sheet_block_reason === null,
  reappearPatch);

const newOnlyPlan = planSheetLiveStatusSync({
  fetched: fetched([product('56다7890')]),
  existing: [product('12가3456')],
  partners,
});
check('상태 전용 경로는 신규 상품을 만들지 않음',
  newOnlyPlan.ok && newOnlyPlan.counts.unmatchedIncoming === 1
  && newOnlyPlan.patches.every((item) => item.key !== `${provider}_56다7890`),
  newOnlyPlan);

const manyExisting = Array.from({ length: 10 }, (_, index) => product(`1${index}가${String(1000 + index)}`));
const collapsePlan = planSheetLiveStatusSync({
  fetched: fetched([manyExisting[0]]),
  existing: manyExisting,
  partners,
});
check('시트가 절반 이하로 붕괴하면 상태 일괄 차단을 중단',
  !collapsePlan.ok && collapsePlan.blockReason.includes('급감'),
  collapsePlan.blockReason);

const twinPlan = planSheetLiveStatusSync({
  fetched: fetched([product('12가3456')]),
  existing: [
    product('12가3456'),
    product('12가3456', { _key: 'legacy-twin', product_code: 'legacy-twin' }),
  ],
  partners,
});
check('ERP 동일 공급사·차번 트윈은 임의 선택하지 않고 차단',
  !twinPlan.ok && twinPlan.blockReason.includes('중복'),
  twinPlan.blockReason);

const otherProvider = 'RP200';
const ownershipPlan = planSheetLiveStatusSync({
  fetched: fetched([product('12가3456')]),
  existing: [product('12가3456', {
    _key: `${otherProvider}_12가3456`,
    product_code: `${otherProvider}_12가3456`,
    provider_company_code: otherProvider,
    partner_code: otherProvider,
    source_schema: otherProvider,
  })],
  partners: [...partners, { _key: otherProvider, partner_code: otherProvider, name: '다른 공급사' }],
});
check('같은 실차번의 공급사가 시트와 ERP에서 다르면 임의 재귀속하지 않고 차단',
  !ownershipPlan.ok && ownershipPlan.blockReason.includes('소유 공급사'),
  ownershipPlan.blockReason);

const failed = cases.filter((item) => !item.ok);
for (const item of cases) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`, item.ok ? '' : item.detail ?? '');
console.log(`\nsheet live status simulation: ${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) process.exit(1);
