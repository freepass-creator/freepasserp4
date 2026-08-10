/**
 * 더 뉴 니로 SG2 — 빈 파워트레인 셸 채움 (쓰기 = APPLY=1 때만)
 *
 * 증상: variants[0].label="" · fuel=null → UI 파워트레인 옵션 공란.
 *
 * 근거
 *   · 형제「디 올 뉴 니로 SG2」: 하이브리드 1.6 · 전기 68kWh
 *   · 2025 The 2025 니로: HEV 트렌디/프레스티지/베스트셀렉션/시그니처 · EV 에어/어스
 *     (기아 보도·가격표 계열 · 형제 트림 집합과 일치)
 *   · 빈 셸에 이미 있던 트림(트렌디·프레스티지·시그니처) = HEV 축
 *
 *   npx tsx scripts/fill-niro-sg2-new-powertrain.mts
 *   APPLY=1 npx tsx scripts/fill-niro-sg2-new-powertrain.mts
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = 'public/data/vehicle-master.json';
const APPLY = process.env.APPLY === '1';
const S = (v: unknown) => String(v ?? '').trim();

const raw = JSON.parse(readFileSync(FILE, 'utf8'));
const entries: any[] = Array.isArray(raw) ? raw : raw.entries;
const e = entries.find((x) => S(x.sub_model) === '더 뉴 니로 SG2');
if (!e) throw new Error('더 뉴 니로 SG2 없음');

const before = JSON.stringify(e.variants, null, 2);
const hevTrims = ['트렌디', '프레스티지', '베스트 셀렉션', '시그니처'];
const evTrims = ['에어', '어스'];

e.variants = [
  {
    label: '하이브리드 1.6',
    fuel: '하이브리드',
    displacement_l: 1.6,
    turbo: false,
    drivetrain: null,
    seat: null,
    battery_kwh: null,
    trims: hevTrims,
  },
  {
    label: '전기 68kWh',
    fuel: '전기',
    displacement_l: null,
    turbo: false,
    drivetrain: null,
    seat: null,
    battery_kwh: 68,
    trims: evTrims,
  },
];
e.trims = [...new Set([...(e.trims || []), ...hevTrims, ...evTrims])];

console.log('sub=', e.sub_model, e.year_start, '~', e.year_end);
console.log('BEFORE variants:\n', before);
console.log('AFTER variants:\n', JSON.stringify(e.variants, null, 2));
console.log('trims=', e.trims.join(', '));

if (!APPLY) {
  console.log('\n(미리보기) 반영하려면 APPLY=1');
  process.exit(0);
}

copyFileSync(FILE, `${FILE}.bak-niro-sg2-pt`);
if (Array.isArray(raw)) writeFileSync(FILE, `${JSON.stringify(raw, null, 2)}\n`);
else writeFileSync(FILE, `${JSON.stringify({ ...raw, entries }, null, 2)}\n`);
console.log('\nAPPLY ok · bak=', `${FILE}.bak-niro-sg2-pt`);
