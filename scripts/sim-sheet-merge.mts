/**
 * Phase A — soft-merge / upsert 시뮬레이션.
 * 실행: npx tsx scripts/sim-sheet-merge.mts
 */
import type { EntityRecord } from '../lib/intake/entities';
import { softMergeProduct, planProductUpsert, changedPatch } from '../lib/domain/sheet-merge';
import { resolveAdapter, partnerSheetOpts } from '../lib/domain/sheet-adapters';

type Case = { name: string; ok: boolean; detail?: unknown };
const cases: Case[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  cases.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

console.log('══ Phase A soft-merge ══\n');

const existing: EntityRecord = {
  _key: 'sup_a_12가3456', product_code: 'sup_a_12가3456', car_number: '12가3456',
  maker: '현대', model: '아반떼', partner_memo: '수기메모유지', vehicle_status: '출고협의',
  price: { '36': { rent: 330000, deposit: 1000000 } },
};
const incomingBlank: EntityRecord = {
  product_code: 'sup_a_12가3456', car_number: '12가3456',
  maker: '현대', model: '아반떼', partner_memo: '', vehicle_status: '출고가능',
  price: { '24': { rent: 350000, deposit: 900000 } },
};
const merged = softMergeProduct(existing, incomingBlank);
check('빈 partner_memo → 수기 유지', merged.partner_memo === '수기메모유지');
check('시트 상태값 있으면 갱신', merged.vehicle_status === '출고가능');
check('price 기간 병합(36 유지)', !!(merged.price as Record<string, unknown>)?.['36']);
check('price 기간 병합(24 추가)', !!(merged.price as Record<string, unknown>)?.['24']);

const incomingNew: EntityRecord = {
  product_code: 'sup_a_99나9999', car_number: '99나9999', maker: '기아', model: 'K5',
};
const plan = planProductUpsert([incomingBlank, incomingNew], [existing]);
check('신규 1건 create', plan.creates.length === 1 && plan.creates[0].product_code === 'sup_a_99나9999');
check('기존 1건 patch', plan.patches.length === 1 && plan.patches[0].key === 'sup_a_12가3456');
check('patch에 빈 memo 없음', plan.patches[0].patch.partner_memo === undefined);

const sameAgain = softMergeProduct(merged, { product_code: merged.product_code, maker: '현대', model: '아반떼', vehicle_status: '출고가능' });
check('동일 유입 → patch 없음', changedPatch(merged, sameAgain) === null);

const ad = resolveAdapter('generic');
const table = [['안내'], ['차량번호', '제조사'], ['1가1', '현대']];
const prep = ad.prepareTable(table, { headerRow: 1 });
check('header_row 스킵', prep[0][0] === '차량번호' && prep.length === 2);

const opts = partnerSheetOpts({
  partner_code: 'sup_x', sheet_url: 'https://docs.google.com/spreadsheets/d/ABC/edit#gid=123',
  sheet_tab: 'gid=123', header_row: 2, adapter_id: 'autoplus', mapping_profile: '{}',
});
check('partnerSheetOpts adapter', opts.adapter.id === 'autoplus' && opts.headerRow === 2 && opts.gid === '123');

const failed = cases.filter((c) => !c.ok);
console.log('\n════════ 결과 ════════');
console.log(`${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) {
  for (const f of failed) console.log('FAIL', f.name, f.detail ?? '');
  process.exit(1);
}
console.log('PASS — Phase A soft-merge');
process.exit(0);
