/**
 * **차 한 대를 «손으로» 등록한다.** 기본 미리보기 · 넣으려면 `--apply`.
 *
 * > 사장님 2026-09-08 「우리는 **상태값만 바꾸고** 없는 거 추가는 **등록하는 개념**으로 가는 거지.
 * >  나중에 **등록을 손으로 할 수 있어야** 하는 거고」
 *
 * 자동 회차가 하는 일은 «아는 차의 상태를 따라가는 것»뿐이다(`ingest-supplier-to-firestore --variable`).
 * 원천에 새 차번이 뜨면 그건 「고칠 것」이 아니라 **들일 것**이다 — 자동으로 들이면 원천의 실수
 * (시험 줄·남의 차·오타 차번)가 그대로 상품이 된다. 실제로 오플 배너 줄이 «차»가 되어
 * 채널 시트까지 나갔던 적이 있다.
 *
 * ```
 *   npx tsx … scripts/register-car.mts                      등록 대기 목록을 본다
 *   npx tsx … scripts/register-car.mts 109호1234            그 차 한 대를 본다(원천에서 다시 읽어)
 *   npx tsx … scripts/register-car.mts 109호1234 --apply    들인다
 *   npx tsx … scripts/register-car.mts --all --code=RP004 --apply   그 공급사 대기분을 다 들인다
 * ```
 *
 * ★**들이는 길은 하나다** — 결국 `ingest-supplier-to-firestore --apply` 를 부른다.
 *   여기서 원자를 «직접» 만들지 않는다. 만드는 규칙이 두 벌이 되면 손으로 넣은 차만
 *   다른 규칙으로 서게 된다(차명 정제·불변식 게이트·요금 축을 못 받는다).
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const K = (v: unknown) => S(v).replace(/\s/g, '');
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const CODE = S(process.argv.find((a) => a.startsWith('--code='))?.split('=')[1]);
const PLATE = K(process.argv.slice(2).find((a) => !a.startsWith('--')));

type 대기줄 = { 차번: string; 이름: string; 상태: string; 구분: string; 원문: string; 본때: string };
let 대기: Record<string, 대기줄[]> = {};
try { 대기 = JSON.parse(readFileSync('tmp/등록대기.json', 'utf8')) as Record<string, 대기줄[]>; } catch { /* 없을 수 있다 */ }
const 전체 = Object.entries(대기).flatMap(([code, rows]) => (rows || []).map((r) => ({ code, ...r })));

if (!PLATE && !ALL) {
  console.log(`\n■ 등록 대기 ${전체.length}대  (자동 회차가 «본» 새 차 — 아직 안 들였다)\n`);
  if (!전체.length) {
    console.log('  대기 중인 차가 없다.');
    console.log('  ※ 목록은 변동 폴링이 채운다 — scripts/ingest-rotation.mts 가 돌 때 쌓인다.\n');
    process.exit(0);
  }
  for (const r of 전체) console.log(`  ${r.code.padEnd(8)} ${r.차번.padEnd(11)} ${r.이름.padEnd(22)} ${r.상태.padEnd(6)} ${r.구분.padEnd(7)} 「${S(r.원문).slice(0, 28)}」  ${r.본때}`);
  console.log(`\n  한 대 보기 — scripts/register-car.mts <차번>`);
  console.log(`  다 들이기 — scripts/register-car.mts --all --code=<공급사코드> --apply\n`);
  process.exit(0);
}

const 대상 = PLATE ? 전체.filter((r) => K(r.차번) === PLATE) : 전체.filter((r) => !CODE || r.code === CODE);
if (!대상.length) {
  console.log(`\n✗ 등록 대기에 ${PLATE || CODE || '그것'} 이 없다.`);
  console.log(`  ※ 대기 목록은 변동 폴링이 채운다. 원천에 «지금» 있는 차인지 먼저 확인하라 —`);
  console.log(`     npx tsx … scripts/ingest-supplier-to-firestore.mts --code=<코드>  (미리보기)\n`);
  process.exit(1);
}
const codes = [...new Set(대상.map((r) => r.code))];
console.log(`\n■ 들일 차 ${대상.length}대 — 공급사 ${codes.join(' · ')}\n`);
for (const r of 대상) console.log(`  ${r.차번.padEnd(11)} ${r.이름.padEnd(22)} ${r.상태.padEnd(6)} ${r.구분}`);
/**
 * ⚠ **한 대만 골라 넣을 수는 없다** — 들이는 일은 원천을 다시 읽어 «그 공급사 전부»를 맞추는 것이다.
 *   차 하나만 따로 만들면 차명 정제·불변식 게이트·요금 축을 못 받아 «다른 규칙으로 선 차»가 된다.
 *   그래서 여기서도 결국 공급사 단위로 부른다. 목록은 「무엇이 들어오는지」를 먼저 보여 주는 몫이다.
 */
if (PLATE && 대상.length === 1) console.log(`\n  ※ 이 차를 들이면 ${codes[0]} 의 다른 대기분도 같이 들어온다 — 원천을 통째로 다시 맞추기 때문이다.`);
if (!APPLY) { console.log(`\n미리보기 — 들이려면 --apply\n`); process.exit(0); }

for (const code of codes) {
  console.log(`\n── ${code} 등록`);
  const out = spawnSync('npx', ['tsx', '--require', './scripts/lib/server-only-shim.cjs', 'scripts/ingest-supplier-to-firestore.mts', `--code=${code}`, '--apply'], {
    encoding: 'utf8', shell: process.platform === 'win32', env: process.env, stdio: 'inherit',
  });
  if (out.status !== 0) console.log(`   ✗ ${code} 등록 실패 — 위 까닭을 보라.`);
}
console.log(`\n✓ 등록 끝 — 문지기(check-atom-intake)와 대조(audit-sheet-vs-atom)를 한 번 돌려 확인하라.\n`);
process.exit(0);
