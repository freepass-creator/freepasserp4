import type { EntityRecord } from '../lib/intake/entities';
import { findSheetSyncExistingConflicts, type PartnerFetchLine, type PartnerSheetsFetch } from '../lib/domain/sheet-sync-all';
import { planDailySheetSync } from '../lib/domain/sheet-daily-sync';
import { buildSheetManualFieldList } from '../lib/domain/sheet-merge';
import {
  KEEP_EXISTING_PRICES,
  PRICE_PERIOD_CONFLICT,
  sheetConflictFingerprint,
} from '../lib/domain/sheet-conflict-resolution';
import { readFileSync } from 'node:fs';

const cases: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => cases.push({ name, ok, detail });

const provider = 'RP100';
const sheetProduct = (car: string, extra: EntityRecord = {}): EntityRecord => ({
  _key: `${provider}_${car}`,
  product_code: `${provider}_${car}`,
  provider_company_code: provider,
  partner_code: provider,
  source: 'sheet',
  source_schema: provider,
  car_number: car,
  maker: '현대',
  model: '아반떼',
  vehicle_status: '출고가능',
  price: { '36': { rent: 500_000, deposit: 1_000_000 } },
  _snapped: true,
  _snap_confidence: 'high',
  ...extra,
});

const line = (products: EntityRecord[], over: Partial<PartnerFetchLine> = {}): PartnerFetchLine => ({
  code: provider,
  label: '테스트 공급사',
  ok: true,
  sourceRowCount: products.length,
  imported: products.length,
  excludedCount: 0,
  noPriceCount: 0,
  skippedCount: 0,
  duplicateCount: 0,
  invalidCount: 0,
  issueSamples: [],
  message: '',
  products,
  ...over,
});

const fetched = (rows: EntityRecord[], over: Partial<PartnerFetchLine> = {}): PartnerSheetsFetch => {
  const one = line(rows, over);
  return {
    lines: [one],
    products: one.products,
    partnerCount: 1,
    rosterRevision: 'roster:daily-test',
  };
};

const partners: EntityRecord[] = [{
  _key: provider,
  partner_code: provider,
  partner_type: '공급사',
  sheet_url: 'https://docs.google.com/spreadsheets/d/test/edit',
  last_sheet_rows: 2,
}];

const existingChanged = sheetProduct('12가3456', {
  maker: '구형표기',
  partner_memo: '관리자 수기 메모',
});
const existingAbsent = sheetProduct('34나5678');
const incomingChanged = sheetProduct('12가3456', { partner_memo: '' });
const incomingNew = sheetProduct('56다7890');
const first = planDailySheetSync({
  fetched: fetched([incomingChanged, incomingNew]),
  existing: [existingChanged, existingAbsent],
  deleted: [],
  partners,
  now: 100,
});
check('정상 일일 연동 계획 통과', first.ok, first.blockReason);
check('신규 시트 행은 자체 재고 create', first.creates.length === 1 && first.counts.created === 1);
check('기존 시트 행은 변경분 patch', first.counts.updated === 1);
const deletedReappeared = sheetProduct('78라9012', {
  _deleted: true,
  deletedAt: '2026-08-10T00:00:00.000Z',
  deleted_reason: '과거 판매 제외',
});
const revivedPlan = planDailySheetSync({
  fetched: fetched([sheetProduct('78라9012')]),
  existing: [],
  deleted: [deletedReappeared],
  partners,
  now: 123,
});
const revivedPatch = revivedPlan.patches.find((item) => item.key === deletedReappeared.product_code)?.patch;
check('판매용 정본에 재등장한 동일키 soft-delete는 신규 중복 대신 기존 노드 복구',
  revivedPlan.ok
  && revivedPlan.creates.length === 0
  && revivedPlan.counts.created === 0
  && revivedPlan.counts.updated === 1
  && revivedPatch?._deleted === null
  && revivedPatch.deletedAt === null
  && revivedPatch.revived_at === '1970-01-01T00:00:00.123Z',
  revivedPlan);
const changedPatch = first.patches.find((item) => item.key === existingChanged.product_code)?.patch;
check('시트 빈값은 관리자 수기 메모를 지우지 않음', changedPatch?.partner_memo === undefined, changedPatch);
const absentPatch = first.patches.find((item) => item.key === existingAbsent.product_code)?.patch;
check('시트에서 사라진 자체 재고는 삭제 대신 시트소유 출고불가',
  absentPatch?.vehicle_status === '출고불가'
  && absentPatch.sheet_status_owner === 'sheet'
  && first.counts.absentBlocked === 1);
check('성공 공급사 checkpoint를 영속 계획에 포함', first.checkpoints.length === 1
  && first.checkpoints[0].patch.last_sheet_rows === 2);

const applied = [existingChanged, existingAbsent].map((row) => {
  const patch = first.patches.find((item) => item.key === row.product_code)?.patch;
  return patch ? { ...row, ...patch } : row;
}).concat(first.creates);
const second = planDailySheetSync({
  fetched: fetched([incomingChanged, incomingNew]),
  existing: applied,
  deleted: [],
  partners,
  now: 200,
});
check('같은 시트 재실행은 신규·수정·부재 patch가 없는 멱등 계획',
  second.ok && second.creates.length === 0 && second.patches.length === 0,
  second);

const manualHold = sheetProduct('12가3456', {
  vehicle_status: '출고불가',
  source: 'manual',
  partner_memo: '운영자 보류',
});
const manualPlan = planDailySheetSync({
  fetched: fetched([incomingChanged]),
  existing: [manualHold],
  deleted: [],
  partners: [{ ...partners[0], last_sheet_rows: 1 }],
});
check('운영자가 수정한 수기 출고불가는 매일 연동이 자동 해제하지 않음',
  manualPlan.ok && manualPlan.patches.every((item) => item.patch.vehicle_status === undefined));

const editedSheetRow = sheetProduct('12가3456', {
  model: '내부 수정 모델',
  vehicle_status: '출고협의',
  _sheet_manual_fields: ['model', 'vehicle_status'],
});
const editedPlan = planDailySheetSync({
  fetched: fetched([sheetProduct('12가3456', { model: '시트 변경 모델', vehicle_status: '출고가능' })]),
  existing: [editedSheetRow],
  deleted: [],
  partners: [{ ...partners[0], last_sheet_rows: 1 }],
});
const editedPatch = editedPlan.patches.find((item) => item.key === editedSheetRow.product_code)?.patch;
check('내부 수기표시가 있어도 판매용 정본의 공급사 소유 필드는 다음 날 최신값 우선',
  editedPlan.ok && editedPatch?.model === '시트 변경 모델' && editedPatch?.vehicle_status === '출고가능',
  editedPatch);
check('재고 편집 diff는 시트 유입 레코드의 내부 우선 필드를 누적',
  buildSheetManualFieldList(sheetProduct('90가0001'), sheetProduct('90가0001', { model: '내부 모델' })).includes('model'));

const legacyAuto = sheetProduct('12가3456', {
  vehicle_status: '출고불가',
  source: 'external_sheet',
  status_label: '시트에서 제거됨',
});
const legacyPlan = planDailySheetSync({
  fetched: fetched([incomingChanged]),
  existing: [legacyAuto],
  deleted: [],
  partners: [{ ...partners[0], last_sheet_rows: 1 }],
});
const legacyPatch = legacyPlan.patches.find((item) => item.key === legacyAuto.product_code)?.patch;
check('과거 시트 자동차단은 행 재등장 시 상태와 낡은 라벨을 복원',
  legacyPatch?.vehicle_status === '출고가능' && legacyPatch.status_label === null,
  legacyPatch);

const lockedAbsent = sheetProduct('34나5678', {
  vehicle_status: '계약중',
  locked_by_contract: 'CT-LOCK',
});
const lockedPlan = planDailySheetSync({
  fetched: fetched([incomingChanged]),
  existing: [incomingChanged, lockedAbsent],
  deleted: [],
  partners: [{ ...partners[0], last_sheet_rows: 2 }],
});
check('계약락 차량은 시트 부재여도 상태를 건드리지 않음',
  lockedPlan.ok
  && lockedPlan.counts.lockedPreserved === 1
  && lockedPlan.patches.every((item) => item.key !== lockedAbsent.product_code));

const failedFetch = fetched([], {
  ok: false,
  sourceRowCount: 0,
  imported: 0,
  message: '시트 조회 실패',
});
const blocked = planDailySheetSync({ fetched: failedFetch, existing: [], deleted: [], partners });
check('공급사 한 곳이라도 조회 실패면 자동 저장 계획 0건',
  !blocked.ok && blocked.creates.length === 0 && blocked.patches.length === 0
  && blocked.blockReason.includes('조회 실패'));

const duplicateExisting = [
  sheetProduct('12가3456', { _key: 'OLD-A', product_code: 'OLD-A' }),
  sheetProduct('12가3456', { _key: 'OLD-B', product_code: 'OLD-B' }),
];
const duplicateBlock = planDailySheetSync({
  fetched: fetched([incomingChanged]),
  existing: duplicateExisting,
  deleted: [],
  partners,
});
check('기존 중복차번은 매일 자동 연동이 임의 병합하지 않고 전체 차단',
  !duplicateBlock.ok && duplicateBlock.blockReason.includes('활성 중복차번'));

const existingWithHistoricalPrice = sheetProduct('77가7777', {
  price: {
    '36': { rent: 500_000, deposit: 1_000_000 },
    '48': { rent: 450_000, deposit: 1_000_000 },
  },
});
const incomingWithoutHistoricalPrice = sheetProduct('77가7777');
const priceFetched = fetched([incomingWithoutHistoricalPrice]);
const priceRaw = findSheetSyncExistingConflicts(priceFetched, [existingWithHistoricalPrice], [])
  .missingPricePeriods[0];
const priceResolution = {
  fingerprint: sheetConflictFingerprint(PRICE_PERIOD_CONFLICT, priceRaw),
  category: PRICE_PERIOD_CONFLICT,
  decision: KEEP_EXISTING_PRICES,
  status: 'approved' as const,
};
const approvedPricePlan = planDailySheetSync({
  fetched: priceFetched,
  existing: [existingWithHistoricalPrice],
  deleted: [],
  partners,
  resolutions: [priceResolution],
});
check('관리자 승인된 비계약 가격기간 누락은 기존 가격 보존으로 자동 연동 통과',
  !!priceRaw && approvedPricePlan.ok
  && approvedPricePlan.notes.some((note) => note.includes('기존 가격기간 유지 1건')),
  approvedPricePlan);
const protectedPricePlan = planDailySheetSync({
  fetched: priceFetched,
  existing: [{ ...existingWithHistoricalPrice, locked_by_contract: 'CT-PRICE', vehicle_status: '계약중' }],
  deleted: [],
  partners,
  resolutions: [priceResolution],
});
check('가격 유지 승인이 있어도 계약보호 차량은 자동 연동 차단 유지',
  !protectedPricePlan.ok && protectedPricePlan.blockReason.includes('가격기간 누락'),
  protectedPricePlan);

/* ── 무변화 완화가 «지속 연동»에도 같이 걸려 있는가 ─────────────────────────────
   2026-08-07 데드락은 완화를 미리보기에만 넣어서 생겼다. 그때는 사람이 버튼을 눌러
   막힌 걸 알았지만, 일일 자동연동은 **아무도 안 보는 새벽에 조용히 멈춘다.**
   그래서 여기 자물쇠를 채운다 — 손으로 한 번 맞춘 것이 매일도 맞는지. */
const noChangePlan = planDailySheetSync({
  fetched: priceFetched,
  existing: [existingWithHistoricalPrice],
  deleted: [],
  partners,
  resolutions: [], // 승인 없음
});
check('금액이 안 바뀌는 가격기간 누락은 승인 없이도 자동 연동 통과',
  noChangePlan.ok && !noChangePlan.blockReason,
  noChangePlan);

// 완화가 «금액이 바뀌는 건»으로 번지면 안 된다 — 손님에게 나가는 값이 조용히 달라진다.
const priceChangedFetched = fetched([sheetProduct('77가7777', {
  price: { '36': { rent: 590_000, deposit: 1_000_000 } },
})]);
const changedPlan = planDailySheetSync({
  fetched: priceChangedFetched,
  existing: [existingWithHistoricalPrice],
  deleted: [],
  partners,
  resolutions: [],
});
check('금액이 바뀌는 가격기간 누락은 승인 없이는 자동 연동도 차단',
  !changedPlan.ok && changedPlan.blockReason.includes('가격기간 누락'),
  changedPlan);

const cron = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};
check('Vercel Cron은 매일 02:00 KST에 일일 동기화 API 호출',
  cron.crons?.some((item) => item.path === '/api/sheet/sync-daily' && item.schedule === '0 17 * * *') === true);
const syncRouteSource = readFileSync('app/api/sheet/sync-daily/route.ts', 'utf8');
check('일일 동기화 API는 CRON_SECRET과 활성 flag를 모두 요구',
  syncRouteSource.includes('CRON_SECRET') && syncRouteSource.includes('SHEET_DAILY_SYNC_ENABLED'));
const dailyServerSource = readFileSync('lib/server/sheet-daily-sync.ts', 'utf8');
check('시트 일일 연동은 ERP3 products를 읽지 않고 ERP4 재고만 비교',
  !dailyServerSource.includes("db.ref('products').get()")
  && dailyServerSource.includes("db.ref('v4/products').get()"));
const statusRouteSource = readFileSync('app/api/sheet/sync-status/route.ts', 'utf8');
check('운영 상태 API는 Firebase 관리자 인증을 요구', statusRouteSource.includes('verifyAdminBearer'));
const resolutionRouteSource = readFileSync('app/api/sheet/conflict-resolutions/route.ts', 'utf8');
check('가격 유지 승인 API는 관리자 인증·v4 원장·계약보호 재검증을 요구',
  resolutionRouteSource.includes('verifyAdminBearer')
  && resolutionRouteSource.includes('v4/sheet_conflict_resolutions')
  && resolutionRouteSource.includes('isPriceConflictProtected'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
check('Firebase Admin은 배포 런타임 dependency',
  !!packageJson.dependencies?.['firebase-admin'] && !packageJson.devDependencies?.['firebase-admin']);

const failed = cases.filter((item) => !item.ok);
for (const item of cases) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`, item.ok ? '' : item.detail ?? '');
console.log(`\nsheet daily sync simulation: ${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) process.exit(1);
