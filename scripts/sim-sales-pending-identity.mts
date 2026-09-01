/** 판매시트 번호미정 신차가 재실행마다 같은 영구 임시번호를 받는지 확인한다. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importSalesInventorySheet } from '../lib/domain/sales-inventory-sheet';
import { sheetSyncCommitBlockReason } from '../lib/domain/sheet-sync-all';
import type { EntityRecord } from '../lib/intake/entities';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const entries = Array.isArray(raw) ? raw : raw.entries || [];
const headers = ['차량번호', '상태', '구분', '제조사', '모델', '차명', '연식', '12개월', '공급사'];
const row = ['미정', '출고가능', '신차렌트', '현대', '쏘나타', '디 엣지 1.6 터보 프리미엄', '2026', '650,000\n3,000,000', '빌린카'];

const firstPartner: EntityRecord = {
  _key: 'RP021', partner_code: 'RP021', name: '빌린카', partner_type: 'provider',
  pending_plates: {}, pending_plate_seq: 0,
};
const first = importSalesInventorySheet({
  table: [headers, row, row], partners: [firstPartner], entries, tabTitle: '상품리스트', tabGid: '1',
});
assert.deepEqual(first.products.map((product) => product.car_number), ['100신0001', '100신0002']);
assert.deepEqual(first.lines[0]?.plateAlloc?.pending_plate_seq, 2);
assert.equal(sheetSyncCommitBlockReason(first), '');

const savedPartner: EntityRecord = { ...firstPartner, ...first.lines[0]?.plateAlloc };
const second = importSalesInventorySheet({
  table: [headers, row, row], partners: [savedPartner], entries, tabTitle: '상품리스트', tabGid: '1',
});
assert.deepEqual(second.products.map((product) => product.car_number), ['100신0001', '100신0002']);
assert.equal(sheetSyncCommitBlockReason(second), '');

console.log('✓ 판매시트 번호미정 신차 영구 식별자 부여·재실행 멱등 회귀검사 통과');
