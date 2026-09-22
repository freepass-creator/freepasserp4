import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SHEET_PRESENTATION as spec, presentationFormatRequests, presentationLabel, requirePrimaryBindings, requireUniquePublicationKeys } from '../lib/domain/f01-f86-presentation';
import { salesPublishedTabTitle, salesTabMatches } from '../lib/domain/sales-published-tabs';
import { f86TabTitle } from '../lib/server/channel-f86-plan';
import { planPresentation } from '../vendor/freepass-data/scripts/sheet-presentation.mjs';

const manifest = JSON.parse(readFileSync(new URL('../vendor/freepass-data/manifest.json', import.meta.url), 'utf8'));
for (const [path, hash] of Object.entries(manifest.sha256)) {
  const content = readFileSync(new URL(`../vendor/freepass-data/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(content).digest('hex'), hash, `Vendored source drift: ${path}`);
}
const at = '2026-09-21T07:28:00Z';
for (const workbook of ['F01', 'F86'] as const) {
  const sheets = spec.primaryTabs.map((tab, index) => {
    const sheetId = spec.workbooks[workbook].primarySheetIds[index];
    const headers = ['차량번호', '차명(원문)', '옵션(원문)', '세부트림', '단기보증', '장기보증', '반납형보증금', '인수형보증금', '12개월 반납형', '24개월 반납형'];
    const title = workbook === 'F01' ? salesPublishedTabTitle(tab.label, 1, '09.21 16:28') : f86TabTitle(tab.label, 1, '09.21 16:28', true);
    const sheet: any = { properties: { sheetId, title, index, gridProperties: { rowCount: 2, columnCount: headers.length } }, data: [{ rowData: [{ values: headers.map(stringValue => ({ userEnteredValue: { stringValue } })) }, { values: [{ userEnteredValue: { stringValue: `FIXTURE${index}` } }] }], columnMetadata: headers.map(() => ({ pixelSize: 90 })) }], basicFilter: { range: { sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: headers.length } } };
    for (const request of presentationFormatRequests(workbook, sheetId, tab.label, headers)) {
      if (request.updateSheetProperties) Object.assign(sheet.properties, request.updateSheetProperties.properties, { gridProperties: { ...sheet.properties.gridProperties, ...request.updateSheetProperties.properties.gridProperties } });
      if (request.updateDimensionProperties) Object.assign(sheet.data[0].columnMetadata[request.updateDimensionProperties.range.startIndex], request.updateDimensionProperties.properties);
    }
    assert.equal(presentationLabel(title), tab.label);
    assert.ok(salesTabMatches(title, tab.label));
    assert.equal(sheet.data[0].columnMetadata[1].pixelSize, 260);
    assert.equal(sheet.data[0].columnMetadata[2].pixelSize, 360);
    assert.equal(sheet.data[0].columnMetadata[3].pixelSize, 100);
    assert.equal(sheet.data[0].columnMetadata[6].pixelSize, tab.key === 'pickup' ? 180 : 90);
    assert.equal(sheet.data[0].columnMetadata[7].pixelSize, tab.key === 'pickup' ? 180 : 90);
    if (workbook === 'F86') {
      assert.equal(sheet.data[0].columnMetadata[4].hiddenByUser, true, 'F86 must hide short-term deposits through 12 months');
      assert.equal(sheet.data[0].columnMetadata[5].hiddenByUser, false, 'F86 must show long-term deposits');
      assert.equal(sheet.data[0].columnMetadata[6].hiddenByUser, false, 'F86 must show unqualified return-form deposits');
      assert.equal(sheet.data[0].columnMetadata[7].hiddenByUser, false, 'F86 must show unqualified acquisition-form deposits');
      assert.equal(sheet.data[0].columnMetadata[8].hiddenByUser, true, 'F86 must hide rent shorter than 24 months');
      assert.equal(sheet.data[0].columnMetadata[9].hiddenByUser, false, 'F86 must show long-term rent from 24 months');
    }
    return sheet;
  });
  requirePrimaryBindings(workbook, sheets.map(s => s.properties));
  const input = { capturedAt: at, sheetInventory: sheets.map(s => s.properties), coverage: sheets.map(s => ({ sheetId: s.properties.sheetId, endRowIndex: 2, endColumnIndex: 10 })), spreadsheet: { spreadsheetId: spec.workbooks[workbook].spreadsheetId, sheets } };
  assert.equal(planPresentation(input, { workbook, updatedAt: at, now: Date.parse(at) }).status, 'PASS', `${workbook}: publisher output must match the local planner exactly`);
  assert.throws(() => requirePrimaryBindings(workbook, sheets.slice(1).map(s => s.properties)), /HOLD/);
  assert.throws(() => requirePrimaryBindings(workbook, [...sheets.map(s => s.properties), { sheetId: 999, title: '오공구독 1대' }]), /HOLD/);
}
assert.equal(salesTabMatches('상품리스트추가', '상품리스트'), false);
assert.equal(presentationLabel('회사 이름 · 10대'), '회사 이름');
assert.throws(() => requireUniquePublicationKeys(['12가3456', '12 가-3456']), /duplicate/);
assert.throws(() => requireUniquePublicationKeys(['미입력']), /missing/);
requireUniquePublicationKeys(['12가3456', '34나5678']);
console.log('PASS: pinned shared spec, stable IDs, exact F01/F86 publisher to local planner parity');
