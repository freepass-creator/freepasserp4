/** 시트 유입 diff 미리보기 집계 검증 — summarizeSheetDiff. */
import { summarizeSheetDiff } from '@/lib/domain/sheet-diff';
import type { EntityRecord } from '@/lib/intake/entities';

const PC = 'RP023';
const p = (code: string, extra: EntityRecord): EntityRecord => ({ _key: code, product_code: code, provider_company_code: PC, ...extra });

const existing: EntityRecord[] = [
  p('P1', { vehicle_status: '출고가능', car_number: '11가1111', model: '아반떼' }),
  p('P2', { vehicle_status: '출고가능', car_number: '22가2222', model: '쏘렌토' }),
  p('P3', { vehicle_status: '출고가능', car_number: '33가3333', model: '그랜저' }),
  p('P4', { vehicle_status: '출고가능', car_number: '44가4444', model: '카니발' }),                    // 부재
  p('P5', { vehicle_status: '출고가능', car_number: '55가5555', model: 'G80', locked_by_contract: 'C1' }), // 부재+락
];
const incoming: EntityRecord[] = [
  p('P1', { vehicle_status: '계약중', car_number: '11가1111', model: '아반떼' }),           // status
  p('P2', { vehicle_status: '출고가능', car_number: '22가2222', model: '쏘렌토', color: '흰색' }), // content
  p('P3', { vehicle_status: '출고가능', car_number: '33가3333', model: '그랜저' }),          // unchanged
  p('P9', { vehicle_status: '출고가능', car_number: '99가9999', model: '캐스퍼' }),          // new
];

const s = summarizeSheetDiff({ incoming, existing, providerCode: PC });
const expect: Record<string, number> = { new: 1, status: 1, content: 1, unchanged: 1, absent: 1, skippedLocked: 1, total: 4 };
let fail = 0;
for (const [k, v] of Object.entries(expect)) {
  const got = (s as unknown as Record<string, number>)[k];
  const ok = got === v;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${k}: expected ${v}, got ${got}`);
}
// 상세: status 항목이 출고가능→계약중 전이를 담는지
const st = s.items.find((i) => i.kind === 'status');
const stOk = st?.statusFrom === '출고가능' && st?.statusTo === '계약중';
console.log(`${stOk ? 'PASS' : 'FAIL'} status 전이: ${st?.statusFrom}→${st?.statusTo}`);
if (!stOk) fail++;
// content 항목이 바뀐 필드(color)를 담는지
const ct = s.items.find((i) => i.kind === 'content');
const ctOk = !!ct?.fields?.includes('color');
console.log(`${ctOk ? 'PASS' : 'FAIL'} content 필드: ${JSON.stringify(ct?.fields)}`);
if (!ctOk) fail++;

console.log(fail ? `\n${fail} FAIL` : `\n전체 PASS (신규 ${s.new}·상태 ${s.status}·내용 ${s.content}·부재 ${s.absent}·무변경 ${s.unchanged}·락스킵 ${s.skippedLocked})`);
process.exit(fail ? 1 : 0);
