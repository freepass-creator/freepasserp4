/** 시트 유입 diff 미리보기 집계 검증 — summarizeSheetDiff. */
import {
  formatSheetDiffBanner,
  sheetChangedFieldCounts,
  sheetStatusTransitionCounts,
  summarizeSheetDiff,
} from '@/lib/domain/sheet-diff';
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
const st = s.items.find((i) => i.kind === 'status');
const stOk = st?.statusFrom === '출고가능' && st?.statusTo === '계약중';
console.log(`${stOk ? 'PASS' : 'FAIL'} status 전이: ${st?.statusFrom}→${st?.statusTo}`);
if (!stOk) fail++;
const ct = s.items.find((i) => i.kind === 'content');
const ctOk = !!ct?.fields?.includes('color');
console.log(`${ctOk ? 'PASS' : 'FAIL'} content 필드: ${JSON.stringify(ct?.fields)}`);
if (!ctOk) fail++;

const banner = formatSheetDiffBanner(s, 99);
const bannerOk = /신규등록 1/.test(banner)
  && /출고가능→계약중 1/.test(banner)
  && /내용만 수정 1/.test(banner)
  && /재고차단 1/.test(banner)
  && /기타 상태변경 0/.test(banner)
  && /무변경 1/.test(banner)
  && /재고 대수\(출고가능\+보류\) 99/.test(banner);
console.log(`${bannerOk ? 'PASS' : 'FAIL'} banner: ${banner}`);
if (!bannerOk) fail++;

// 키 규약이 달라도 공급사+실차번이 같으면 UI 미리보기에서 부재로 잡히면 안 된다.
const legacyExisting: EntityRecord[] = [
  { _key: '66가6666_RP023', product_code: '66가6666_RP023', provider_company_code: PC, car_number: '66가6666', vehicle_status: '출고가능' },
];
const legacyIncoming: EntityRecord[] = [
  { product_code: 'RP023_66가6666', provider_company_code: PC, car_number: '66가6666', vehicle_status: '출고가능' },
];
const legacy = summarizeSheetDiff({ incoming: legacyIncoming, existing: legacyExisting, providerCode: PC });
const legacyOk = legacy.absent === 0 && legacy.new === 0;
console.log(`${legacyOk ? 'PASS' : 'FAIL'} 구키↔신키 동일 차번 부재 오판 방지: new=${legacy.new} absent=${legacy.absent}`);
if (!legacyOk) fail++;

const otherBanner = formatSheetDiffBanner({
  ...s,
  status: s.status + 1,
  items: [...s.items, {
    key: 'P6', car_number: '66가6666', vehicle_name: 'K5', kind: 'status',
    statusFrom: '출고협의', statusTo: '출고가능',
  }],
}, 99);
const otherOk = /기타 상태변경 1/.test(otherBanner);
console.log(`${otherOk ? 'PASS' : 'FAIL'} 기타 상태전이 배너 노출: ${otherBanner}`);
if (!otherOk) fail++;

const detailFixture = {
  ...s,
  items: [...s.items, {
    key: 'P7', car_number: '77가7777', vehicle_name: 'K8', kind: 'status' as const,
    statusFrom: '출고협의', statusTo: '출고가능', fields: ['price'],
  }],
};
const statusDetails = sheetStatusTransitionCounts(detailFixture);
const fieldDetails = sheetChangedFieldCounts(detailFixture);
const detailsOk = statusDetails.some((x) => x.label === '출고협의→출고가능' && x.count === 1)
  && fieldDetails.some((x) => x.field === 'price' && x.count >= 1);
console.log(`${detailsOk ? 'PASS' : 'FAIL'} 상태전이·변경필드 근거 집계`);
if (!detailsOk) fail++;

const zeroIncoming = summarizeSheetDiff({
  incoming: [],
  existing: [{ _key: 'P-ZERO', product_code: 'P-ZERO', provider_company_code: PC, car_number: '88가8888', vehicle_status: '출고가능' }],
  providerCode: PC,
});
const zeroOk = zeroIncoming.absent === 1;
console.log(`${zeroOk ? 'PASS' : 'FAIL'} 올림 0대도 기존 부재 범위를 미리보기: absent=${zeroIncoming.absent}`);
if (!zeroOk) fail++;

console.log(fail ? `\n${fail} FAIL` : `\n전체 PASS (신규 ${s.new}·상태 ${s.status}·내용 ${s.content}·부재 ${s.absent}·무변경 ${s.unchanged}·락스킵 ${s.skippedLocked})`);
process.exit(fail ? 1 : 0);
