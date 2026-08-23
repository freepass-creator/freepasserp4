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
import { classifyVehicleClass, composeRefinedVehicleName } from '../lib/domain/vehicle-class';
import { vehicleClassCodeFromLabel } from '../lib/domain/vehicle-class-catalog';

const stamp = readFileSync('scripts/stamp-encar-codes-on-supplier.mts', 'utf8');
const fill = readFileSync('scripts/fill-supplier-ai-columns.mts', 'utf8');
const lock = readFileSync('lib/domain/vehicle-master-lock.ts', 'utf8');
const sheet = readFileSync('lib/domain/vehicle-master-sheet.ts', 'utf8');
const pub = readFileSync('scripts/publish-origin-tab.mts', 'utf8');
const catalog = readFileSync('lib/domain/vehicle-class-catalog.ts', 'utf8');

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
check('세대 이름 규칙', lock.includes('SUBMODEL_NAME_RULE'), '풀체인지=모델+코드 · 디 올 뉴는 aliases');
check('fill 차종분류코드', fill.includes('차종분류코드'), 'fill 이 차종분류 한 칸의 코드를 박는다');
check('발행기 차종분류 한 칸', pub.includes('vehicleClassDisplay') && !pub.includes("hdr.indexOf('차종크기')"), '판매시트는 차종분류 조합값을 싣는다');
check('차종분류 코드표', catalog.includes("code: 'vc-15'") && catalog.includes('준대형 세단'), 'vc-15 = 준대형 세단');
check('A6 → vc-15', vehicleClassCodeFromLabel(classifyVehicleClass({ model: 'A6', sub_model: 'A6 C8' } as never)) === 'vc-15', '준대형 세단');
check('팰리세이드 7인승 → vc-18', vehicleClassCodeFromLabel(classifyVehicleClass({ model: '팰리세이드', sub_model: '팰리세이드 LX3', seats: 7 } as never)) === 'vc-18', '대형 SUV');
check('팰리세이드 9인승 → vc-19', vehicleClassCodeFromLabel(classifyVehicleClass({ model: '팰리세이드', sub_model: '팰리세이드 LX3', seats: 9 } as never)) === 'vc-19', '대형 MPV');
check('카니발 → vc-19', vehicleClassCodeFromLabel(classifyVehicleClass({ model: '카니발', sub_model: '카니발 KA4', seats: 9 } as never)) === 'vc-19', '대형 MPV');
check('차명 조합', composeRefinedVehicleName('아반떼', '아반떼 CN8', '인스퍼레이션') === '아반떼 CN8 인스퍼레이션', '모델+세부모델+트림 한 칸');

{
  const raw = JSON.parse(readFileSync(VEHICLE_NAME_DICTIONARY, 'utf8')) as { entries?: { model?: string; sub_model?: string; gen_code?: string }[] };
  const entries = raw.entries || [];
  const cn8 = entries.find((x) => x.model === '아반떼' && x.gen_code === 'CN8');
  check('아반떼 CN8 정본', cn8?.sub_model === '아반떼 CN8', cn8 ? `세부모델 「${cn8.sub_model}」` : 'CN8 행 없음');
  const stacked = entries.filter((x) => /디\s*올\s*뉴/.test(String(x.sub_model || '')) && String(x.gen_code || '') === 'CN8');
  check('디올뉴를 CN8 세부모델에 안 씀', stacked.length === 0, stacked.length ? stacked.map((x) => x.sub_model).join(', ') : 'aliases만');
  const mx5 = entries.find((x) => x.model === '싼타페' && x.gen_code === 'MX5') as { sub_model?: string; aliases?: string[] } | undefined;
  check('싼타페 MX5 정본', mx5?.sub_model === '싼타페 MX5', mx5 ? `세부모델 「${mx5.sub_model}」` : 'MX5 행 없음');
  check('디올뉴를 MX5 세부모델에 안 씀', !/디\s*올\s*뉴/.test(String(mx5?.sub_model || '')), mx5 ? 'aliases만' : 'MX5 없음');
  check('싼타페 MX5 별칭', !!mx5?.aliases?.includes('디 올 뉴 싼타페 MX5') && !!mx5?.aliases?.includes('디 올뉴 싼타페'), mx5 ? `aliases ${(mx5.aliases || []).length}` : '없음');
  const casperEv = entries.find((x) => x.model === '캐스퍼' && /일렉트릭|AX1e/i.test(String(x.sub_model || '') + String(x.gen_code || '')));
  check('캐스퍼 EV 정본', casperEv?.sub_model === '캐스퍼 일렉트릭 AX1e' && casperEv?.gen_code === 'AX1e', casperEv ? `세부모델 「${casperEv.sub_model}」 ${casperEv.gen_code}` : 'AX1e 행 없음');
  const stariaEvName = entries.filter((x) => x.model === '스타리아' && /일렉트릭/.test(String(x.sub_model || '')));
  check('스타리아 EV를 일렉트릭 세대로 안 쪼갬', stariaEvName.length === 0, stariaEvName.length ? stariaEvName.map((x) => x.sub_model).join(', ') : '차체줄 US4');
  const g80FlName = entries.filter((x) => x.model === 'G80' && x.sub_model === '더 뉴 G80 RG3');
  check('더 뉴 G80를 RG3 세대로 안 쪼갬', g80FlName.length === 0, g80FlName.length ? g80FlName.map((x) => x.sub_model).join(', ') : 'aliases만');
  const g80Rg3 = entries.find((x) => x.model === 'G80' && x.sub_model === 'G80 RG3') as { aliases?: string[] } | undefined;
  check('G80 RG3 FL 별칭', !!g80Rg3 && (g80Rg3.aliases || []).includes('G80 RG3 FL') && (g80Rg3.aliases || []).includes('더 뉴 G80 RG3'), g80Rg3 ? `aliases ${(g80Rg3.aliases || []).length}` : 'G80 RG3 없음');
  const fakeFl = entries.filter((x) => /더\s*뉴\s*(GV70 JK1|GV80 JX1|모델 [Y3])/.test(String(x.sub_model || '')));
  check('더 뉴 FL을 세대로 안 쪼갬', fakeFl.length === 0, fakeFl.length ? fakeFl.map((x) => x.sub_model).join(', ') : 'aliases만');
  const gv70 = entries.find((x) => x.model === 'GV70' && x.sub_model === 'GV70 JK1') as { aliases?: string[] } | undefined;
  const gv80 = entries.find((x) => x.model === 'GV80' && x.sub_model === 'GV80 JX1') as { aliases?: string[] } | undefined;
  const modelY = entries.find((x) => x.model === '모델 Y' && x.sub_model === '모델 Y') as { aliases?: string[] } | undefined;
  const model3 = entries.find((x) => x.model === '모델 3' && x.sub_model === '모델 3') as { aliases?: string[] } | undefined;
  check('GV70/GV80/모델Y·3 FL 별칭',
    !!gv70?.aliases?.includes('GV70 JK1 FL') && !!gv80?.aliases?.includes('GV80 JX1 FL')
    && !!modelY?.aliases?.includes('모델 Y FL') && !!model3?.aliases?.includes('모델 3 FL'),
    [gv70, gv80, modelY, model3].every(Boolean) ? 'JK1·JX1·Y·3' : '정본 없음');
}

{
  const matchSrc = readFileSync('lib/domain/vehicle-master-match.ts', 'utf8');
  check('라틴 고유명 잠금', lock.includes('LATIN_BRAND_TRIM_CANON') && lock.includes("'H-PICK'") && lock.includes("'N Line'"), 'H-PICK·N Line·X Line·GT Line');
  check('TRIM_EN_KO가 N라인을 정본으로 안 씀', !matchSrc.includes("'n line': 'N라인'") && !matchSrc.includes("nline: 'N라인'"), 'N Line 정본');
  const raw = JSON.parse(readFileSync(VEHICLE_NAME_DICTIONARY, 'utf8')) as { entries?: { origin?: string; model?: string; trims?: string[]; variants?: { trims?: string[] }[] }[] };
  const leftover: string[] = [];
  let hasN = false;
  let hasNLine = false;
  for (const e of raw.entries || []) {
    if (e.origin !== '국산') continue;
    for (const t of [...(e.trims || []), ...(e.variants || []).flatMap((v) => v.trims || [])]) {
      const s = String(t);
      if (/(N라인|X라인|GT라인|H-픽)/.test(s)) leftover.push(`${e.model}:${s}`);
      if (s === 'N') hasN = true;
      if (s === 'N Line' || s.includes('N Line')) hasNLine = true;
    }
  }
  check('국산 트림 라틴 정본', leftover.length === 0, leftover.length ? leftover.slice(0, 6).join(', ') : 'N라인·X라인·H-픽 없음');
  check('N ≠ N Line', hasN && hasNLine, hasN && hasNLine ? '고성능 N 과 트림 N Line 분리' : `N=${hasN} N Line=${hasNLine}`);
}

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
