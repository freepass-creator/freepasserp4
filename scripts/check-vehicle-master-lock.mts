/**
 * **차종마스터·코드 잠금이 코드에 실제로 박혀 있는지.** 읽기 전용.
 *
 * 다른 AI가 stamp에 `put(..., '모델')` 을 다시 넣거나, fill이 json이 아닌 엔카를 사전으로
 * 쓰면 여기서 실패한다. 매뉴얼만 믿으면 안 되고 장치가 있어야 한다.
 *
 *   npx tsx scripts/check-vehicle-master-lock.mts
 */
import { readFileSync } from 'node:fs';
import { FILL_OWNED_COLUMNS, VEHICLE_CODE_REGISTRY, VEHICLE_NAME_DICTIONARY } from '../lib/domain/vehicle-master-lock';

const stamp = readFileSync('scripts/stamp-encar-codes-on-supplier.mts', 'utf8');
const fill = readFileSync('scripts/fill-supplier-ai-columns.mts', 'utf8');
const lock = readFileSync('lib/domain/vehicle-master-lock.ts', 'utf8');
const sheet = readFileSync('lib/domain/vehicle-master-sheet.ts', 'utf8');

type Check = { what: string; ok: boolean; detail: string };
const out: Check[] = [];
const check = (what: string, ok: boolean, detail: string) => out.push({ what, ok, detail });

check('이름 사전 파일', (() => { try { JSON.parse(readFileSync(VEHICLE_NAME_DICTIONARY, 'utf8')); return true; } catch { return false; } })(), VEHICLE_NAME_DICTIONARY);
check('코드 책 파일', (() => { try { JSON.parse(readFileSync(VEHICLE_CODE_REGISTRY, 'utf8')); return true; } catch { return false; } })(), VEHICLE_CODE_REGISTRY);
check('fill 사전=json', fill.includes(VEHICLE_NAME_DICTIONARY), 'fill-supplier-ai-columns 가 vehicle-master.json 을 읽는다');
check('fill 차명 신호', /vehicle_name:\s*carName/.test(fill), '스냅에 차명(vehicle_name)을 넣는다');
check('stamp 행키 가드', stamp.includes('assertStampColumnAllowed'), 'put() 이 허용 칸만 쓴다');
check('라이브 탭 가드', lock.includes('assertNotLiveVehicleMasterTabWrite'), '원천대장 차종마스터 탭 쓰기 거부');
check('시트 주석=json 사전', /차명·제원 사전은 `public\/data\/vehicle-master\.json`/.test(sheet), 'vehicle-master-sheet 헤더가 엔카를 사전이라고 하면 안 된다');

for (const col of FILL_OWNED_COLUMNS) {
  const re = new RegExp(`put\\([^)]*['"]${col.replace(/([()])/g, '\\$1')}['"]`);
  check(`stamp 안 씀 ${col}`, !re.test(stamp), re.test(stamp) ? `⛔ stamp 가 「${col}」을 쓴다` : '행키만');
}

const bad = out.filter((c) => !c.ok);
console.log('■ 차종마스터·코드 잠금 대조\n');
for (const c of out) console.log(`  ${c.ok ? '✓' : '✗'} ${c.what.padEnd(28)} ${c.detail}`);
console.log(`\n  맞음 ${out.length - bad.length} · 어긋남 ${bad.length}`);
if (bad.length) {
  console.log('\n  ⛔ 잠금이 코드와 다르다. stamp는 엔카 행키만, 이름은 vehicle-master.json, 라이브 차종마스터 탭은 읽기만.\n');
  process.exit(1);
}
console.log('');
