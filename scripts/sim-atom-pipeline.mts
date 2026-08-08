/**
 * 원자 정합 전수 — **공급사 시트 한 칸이 재고 어느 원자로 가는가.**
 *
 * 표준양식의 모든 열에 값을 채워 한 줄을 만들고, 실제 유입 경로(어댑터 → importSheetTable)로
 * 통과시킨 뒤 «열 하나하나»가 매물 원자에 도착했는지 확인한다.
 * 도착하지 않는 열이 있으면 그 칸은 공급사가 아무리 채워도 버려지는 칸이다.
 *
 *   npx tsx scripts/sim-atom-pipeline.mts
 */
import { readFileSync } from 'node:fs';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { importSheetTable } from '../lib/domain/sheet-import';
import { buildTemplateValues, TEMPLATE_COLUMNS } from '../lib/domain/supplier-template-sheet';
import { parseProductOptions } from '../lib/domain/product';

const S = (v: unknown) => String(v ?? '').trim();
const master = (() => { const m = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')); return (Array.isArray(m) ? m : m.entries) || []; })();

/** 열 → 도착지. 확인하는 방법까지 여기 적는다. */
const EXPECT: { col: string; write: string; check: (p: any) => string }[] = [
  { col: '차량번호', write: '123가4567', check: (p) => S(p.car_number) },
  { col: '상태', write: '출고협의', check: (p) => S(p.vehicle_status) },
  { col: '분류', write: '중고렌트', check: (p) => S(p.product_type) },
  { col: '제조사', write: '현대', check: (p) => S(p.maker) },
  { col: '차명(트림)', write: '쏘나타 디 엣지 DN8 2.0 가솔린 인스퍼레이션', check: (p) => S(p.sub_model) },
  { col: '옵션', write: '선루프, 통풍시트 / 후측방경보', check: (p) => parseProductOptions(p.options).join('|') },
  { col: '외부색상', write: '흰색', check: (p) => S(p.ext_color) },
  { col: '내부색상', write: '검정', check: (p) => S(p.int_color) },
  { col: '연식', write: '2024', check: (p) => S(p.year) },
  { col: '주행거리', write: '12000', check: (p) => S(p.mileage) },
  { col: '연료', write: '가솔린', check: (p) => S(p.fuel_type) },
  { col: '배기량', write: '1998', check: (p) => S(p.engine_cc) },
  { col: '인승', write: '9', check: (p) => S(p.seats) },
  // 열만 만들고 별칭이 없으면 공급사가 채워도 버려진다 — 그 회귀를 막는다.
  { col: '구동', write: '4WD', check: (p) => S(p.drive_type) },
  { col: '단기보증', write: '1200000', check: (p) => S(p.price?.['12']?.deposit) },
  { col: '12개월', write: '900000', check: (p) => S(p.price?.['12']?.rent) },
  { col: '장기보증', write: '1800000', check: (p) => S(p.price?.['36']?.deposit) },
  { col: '36개월', write: '750000', check: (p) => S(p.price?.['36']?.rent) },
  { col: '정책코드', write: 'POL-0047', check: (p) => S(p.policy_code) },
  { col: '최초등록일', write: '2024-03-15', check: (p) => S(p.first_registration_date) },
  { col: '사진링크', write: 'https://drive.google.com/drive/folders/abc', check: (p) => S(p.photo_link) },
  { col: '차대번호', write: 'KMHL14JA1PA123456', check: (p) => S(p.vin) },
  { col: '비고', write: '전방주차 불가', check: (p) => S(p.partner_memo) },
];

const row = Array(TEMPLATE_COLUMNS.length).fill('');
for (const e of EXPECT) {
  const i = TEMPLATE_COLUMNS.findIndex((c) => c.name === e.col);
  if (i < 0) { console.log(`✗ 표준양식에 「${e.col}」 열이 없다`); process.exit(1); }
  row[i] = e.write;
}
// 표준 밖 기간도 함께 — 렌트사가 제목을 바꿔 쓰는 칸이 실제로 먹히는가.
const free = TEMPLATE_COLUMNS.findIndex((c) => c.name === '기타기간①');
const header = TEMPLATE_COLUMNS.map((c) => c.name);
if (free >= 0) { header[free] = '18개월'; row[free] = '820000'; }

const r = importSheetTable(resolveAdapter('generic').prepareTable([header, row]), { providerCode: 'RPTEST', entries: master });
const p = (r.products[0] || {}) as any;

console.log(`\n══ 원자 정합 — 시트 한 줄 → 매물 ══\n`);
console.log(`  매물 ${r.products.length}대 · 검수필요 ${p._needs_master_review === true} · 신뢰도 ${S(p._snap_confidence)}\n`);
console.log('  열              적은 값                          도착한 원자');
let pass = 0, fail = 0;
for (const e of EXPECT) {
  const got = e.check(p);
  const ok = !!got;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${e.col.padEnd(12)} ${e.write.slice(0, 30).padEnd(32)} ${got || '(비었음)'}`);
}
const free18 = S(p.price?.['18']?.rent);
console.log(`  ${free18 ? '✓' : '✗'} ${'기타기간①'.padEnd(12)} ${'제목을 18개월로 바꿔 씀'.padEnd(32)} ${free18 || '(비었음)'}`);
free18 ? pass++ : fail++;
console.log(`\n── 도착 ${pass} · 유실 ${fail} ──\n`);
process.exit(fail ? 1 : 0);
