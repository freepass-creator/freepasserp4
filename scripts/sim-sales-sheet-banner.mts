import { planSheetContract, auditSheetContractReadback } from '../lib/domain/sheet-contract-plan';
import assert from 'node:assert/strict';
import { salesBannerManifest, salesBannerMark, salesSheetBanner, sourceTextFormatRequests } from '../lib/domain/sales-sheet-banner';
import { pickPublishedSalesTabs, salesTabMatches, companyTabMatches } from '../lib/domain/sheet-contract-identity';

// Test fixtures only; production counts must come from each published tab's rows.
const timestamp = '2026-09-21T05:30:42.123Z';
const mark = salesBannerMark(timestamp);
assert.equal(mark, '09-21 14:30');
assert.equal(salesBannerMark('2026-12-31T15:01:02Z'), '01-01 00:01');
const keys = ['상품리스트', '손오공상품', '픽업구독', '오플구독'];
const counts = [720, 59, 223, 53];
const titles = keys.map((k, i) => salesSheetBanner(k, counts[i], mark));
assert.deepEqual(titles, ['상품리스트 09-21 14:30 720대', '손오공 59대', '픽업 223대', '오플 53대']);
assert.deepEqual(pickPublishedSalesTabs(titles).map(t => t.prefix), keys);
assert.equal(salesTabMatches('손오공상품추가', '손오공상품'), false);
assert.throws(() => pickPublishedSalesTabs(['손오공 59대', '오공구독 09.21 15']), /중복/);
assert.equal(salesSheetBanner('회사', 0, mark, '회사'), '회사 0대');
for (const invalid of ['09.21 14:30', '09-21 14:30:00', '02-30 14:30', '09-21 24:00']) {
  assert.throws(() => salesSheetBanner('상품리스트', 1, invalid), /HOLD/);
}
for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => salesSheetBanner('손오공상품', invalid, mark), /HOLD/);
assert.throws(() => salesSheetBanner('미확정회사', 1, mark), /HOLD/);
assert.throws(() => salesBannerMark('09-21 14:30'), /HOLD/);
const manifest = salesBannerManifest({ capturedAt: timestamp, revision: 'a'.repeat(40), snapshotId: 'fixture-only', tabs: keys.map((canonicalKey, i) => ({ canonicalKey, count: counts[i] })) });
assert.equal(manifest.capturedAt, timestamp);
assert.equal(manifest.timeZone, 'Asia/Seoul');
assert.equal(manifest.revision, 'a'.repeat(40));
assert.deepEqual(manifest.tabs.map(t => t.displayText), titles);
console.log('PASS: exact worksheet titles, canonical identities, invalid input, rollover, counts and manifest provenance');

const requests: any[] = sourceTextFormatRequests(7, ['옵션(원문)', '차명(원본)', '다른열'], [420, 90, 80]);
assert.equal(requests[0].updateDimensionProperties.properties.pixelSize, 420);
assert.equal(requests[2].updateDimensionProperties.properties.pixelSize, 180);
assert.equal(requests.length, 4);
assert.equal(requests[1].repeatCell.fields, 'userEnteredFormat.wrapStrategy');
assert.equal(requests[1].repeatCell.cell.userEnteredFormat.wrapStrategy, 'CLIP');
assert.throws(() => sourceTextFormatRequests(7, ['옵션(원문)'], []), /HOLD/);

const base = { target: 'F86' as const, capturedAt: timestamp, revision: 'a'.repeat(40), snapshotId: 'fixture-only', preservedState: { filter: 'unchanged' }, coverage: { formulas: true, protections: true, appsScript: true, externalConsumers: true }, tabs: keys.map((title, index) => ({ sheetId: index, index, title, headers: ['차량번호', '옵션(원문)', '차명(원문)'], rows: [['fixture', 'long text', 'source name']], widths: [100, 480, 90] })) };
const ready = planSheetContract(base);
assert.equal(ready.status, 'READY_FOR_REVIEW');
assert.equal(ready.diff[0].columns[0].after, 480);
assert.equal(ready.diff[0].columns[1].after, 180);
assert.equal(planSheetContract({ ...base, coverage: { ...base.coverage, protections: false } }).executableRequests.length, 0);
assert.equal(planSheetContract({ ...base, tabs: [...base.tabs, { ...base.tabs[1], sheetId: 99, index: 9, title: '오공구독 59대' }] }).status, 'HOLD');
assert.equal(planSheetContract({ ...base, tabs: base.tabs.map(t => ({ ...t, widths: [] })) }).status, 'HOLD');
assert.ok(ready.executableRequests.every(r => ['updateSheetProperties', 'updateDimensionProperties', 'repeatCell'].includes(Object.keys(r)[0])));

const readback = { ...base, tabs: base.tabs.map((t,i) => ({ ...t, title: ready.diff[i].after, widths: [100, 480, 180] })) };
assert.deepEqual(auditSheetContractReadback(base, readback), []);
assert.ok(auditSheetContractReadback(base, { ...readback, preservedState: { filter: 'changed' } }).length);
assert.ok(auditSheetContractReadback(base, { ...readback, tabs: readback.tabs.map(t => ({ ...t, rows: [['changed formula']] })) }).length);

assert.equal(companyTabMatches('Foo Bar 12대', 'Foo'), false);
assert.equal(companyTabMatches('Foo 12대', 'Foo'), true);


assert.equal(planSheetContract({ ...base, tabs: [...base.tabs, { ...base.tabs[0], sheetId: 21, index: 4, title: '회사 1대', companyDisplayName: '회사' }, { ...base.tabs[0], sheetId: 22, index: 5, title: '회사 2대', companyDisplayName: '회사', rows: [['a'], ['b']] }] }).status, 'HOLD');

// Width-only: title references and duplicate classification are unrelated, never authorize title/CLIP changes.
const widthBase = { ...base, coverage: { formulas: false, protections: true, appsScript: false, externalConsumers: false },
  tabs: [...base.tabs, { ...base.tabs[1], sheetId: 99, index: 9, title: '오공구독 09.21 15' }] };
const widthPlan = planSheetContract(widthBase, 'widths');
assert.equal(widthPlan.status, 'READY_FOR_REVIEW');
assert.ok(widthPlan.diff.every(d => d.before === d.after));
assert.equal(widthPlan.executableRequests.length, 5); // Only undersized vehicle-name columns; 480px options remain unchanged.
assert.ok(widthPlan.executableRequests.every(r => Object.keys(r).join() === 'updateDimensionProperties'));
const widthAfter = { ...widthBase, tabs: widthBase.tabs.map(t => ({ ...t, widths: [100, 480, 180] })) };
assert.deepEqual(auditSheetContractReadback(widthBase, widthAfter, 'widths'), []);
assert.ok(auditSheetContractReadback(widthBase, { ...widthAfter, tabs: widthAfter.tabs.map(t => ({ ...t, title: 'changed' })) }, 'widths').length);
assert.ok(auditSheetContractReadback(widthBase, { ...widthAfter, preservedState: { wrap: 'changed' } }, 'widths').length);
assert.equal(planSheetContract({ ...widthAfter, coverage: { ...widthAfter.coverage, protections: false } }, 'widths').executableRequests.length, 0);
assert.equal(planSheetContract({ ...widthAfter, tabs: widthAfter.tabs.map(t => ({ ...t, widths: [] })) }, 'widths').executableRequests.length, 0);
assert.equal(planSheetContract(widthAfter, 'widths').executableRequests.length, 0);
console.log('PASS: width-only keeps legacy/duplicate titles, formulas, wrap and larger widths; missing widths/protections HOLD');
