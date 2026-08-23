/**
 * 엔카 원자를 다시 읽고, 가드를 통과한 뒤에만 행키를 심는다.
 *
 *   npx tsx scripts/learn-encar.mts              # 원자 캐시 + stamp dry-run
 *   npx tsx scripts/learn-encar.mts --apply      # 캐시 후 유일 행키만 반영(stamp 규칙)
 *
 * 새 세대·신차는 json/규격검토로만. 이 스크립트는 엔카 키를 발명하지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { JWT } from 'google-auth-library';
import { loadEncarMasterPayload } from '../lib/domain/encar-master-sheet';
import { assertEncarSpecFillGuards, driveKey, fuelKey, nk, S, type GuardAtom } from '../lib/domain/encar-spec-fill';
import {
  ENCAR_ATOMS_CACHE, ENCAR_LEARN_MEMORY, type EncarLearnMemory,
} from '../lib/domain/encar-learn';

const APPLY = process.argv.includes('--apply');
mkdirSync('tmp', { recursive: true });
mkdirSync('data', { recursive: true });

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const call = async (u: string): Promise<Record<string, unknown>> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) {
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};

const payload = await loadEncarMasterPayload(call);
writeFileSync(ENCAR_ATOMS_CACHE, JSON.stringify(payload));
const zip = (headers: string[], row: (string | number)[]) => {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => { o[h] = S(row[i]); });
  return o;
};
const atoms: GuardAtom[] = payload.values.map((r) => {
  const o = zip(payload.headers, r);
  const cc = Number(String(o['정확배기량(cc)'] || '').replace(/[^\d]/g, '')) || 0;
  return {
    t: o['세부트림행키'] || o['트림행키'],
    fuel: fuelKey(o['연료']),
    fuelName: o['연료'],
    cc,
    liters: Number(o['표시배기량(L)']) || (cc ? Math.round(cc / 100) / 10 : 0),
    seats: Number(o['인승']) || 0,
    drive: driveKey(o['구동방식']) || nk(o['구동방식']),
    driveName: o['구동방식'],
    turbo: o['터보'] === '예' || /터보/.test(o['세부트림']),
    trimName: o['세부트림'],
    encarTrim: o['엔카트림'] || o['세부트림'],
    yearStart: Number(String(o['연식시작']).match(/(20\d{2})/)?.[1] || 0) || 0,
    yearEnd: Number(String(o['연식종료']).match(/(20\d{2})/)?.[1] || 0) || 0,
  };
}).filter((a) => a.t);
assertEncarSpecFillGuards(atoms);

const sm = new Set(payload.values.map((r) => S(zip(payload.headers, r)['세부모델'])).filter(Boolean));
const t = new Set(atoms.map((a) => a.t));
console.log(`■ 엔카 학습 ${APPLY ? '반영' : '미리보기'} — 원자 ${payload.values.length} · SM ${sm.size} · T ${t.size} → ${ENCAR_ATOMS_CACHE}`);

const stamp = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', 'scripts/stamp-encar-codes-on-supplier.mts', `--atoms=${ENCAR_ATOMS_CACHE}`, ...(APPLY ? ['--apply'] : [])],
  { encoding: 'utf8', shell: process.platform === 'win32', env: process.env, maxBuffer: 64 * 1024 * 1024 },
);
const text = `${stamp.stdout || ''}\n${stamp.stderr || ''}`;
process.stdout.write(stamp.stdout || '');
if (stamp.stderr) process.stderr.write(stamp.stderr);
if (stamp.status !== 0) throw new Error(`stamp 실패 (${stamp.status})`);

const summary = /(\d+)대 · M \d+ · SM \d+ · T \d+\(유지 (\d+)·채움 (\d+)\) · T못정함 (\d+)/.exec(text.replace(/\s+/g, ' '));
const lastStamp = summary ? {
  cars: Number(summary[1]), tKeep: Number(summary[2]), tFill: Number(summary[3]), tHold: Number(summary[4]),
} : undefined;

const prev: EncarLearnMemory = existsSync(ENCAR_LEARN_MEMORY)
  ? JSON.parse(readFileSync(ENCAR_LEARN_MEMORY, 'utf8')) as EncarLearnMemory
  : { updated: '', encar: { rows: 0, sm: 0, t: 0 }, aliases: [], missingEncar: [] };

const seed: EncarLearnMemory['aliases'] = [
  { from: 'G80 RG3 FL', to: 'G80 RG3', gen: 'RG3', plates: 16, status: 'json' },
  { from: 'GV70 JK1 FL', to: 'GV70 JK1', gen: 'JK1', plates: 6, status: 'json' },
  { from: 'GV80 JX1 FL', to: 'GV80 JX1', gen: 'JX1', plates: 4, status: 'json' },
  { from: '쏘나타 DN8 디 엣지', to: '쏘나타 디 엣지 DN8', gen: 'DN8', plates: 6, status: 'json' },
  { from: '모델 Y FL', to: '모델 Y', plates: 9, status: 'json' },
  { from: '아이오닉5 NE', to: '아이오닉5 NE', gen: 'NE', plates: 8, status: 'json' },
];
const byFrom = new Map(prev.aliases.map((a) => [a.from, a]));
for (const a of seed) if (!byFrom.has(a.from)) prev.aliases.push(a);

const mem: EncarLearnMemory = {
  updated: new Date().toISOString(),
  encar: { rows: payload.values.length, sm: sm.size, t: t.size },
  aliases: prev.aliases,
  missingEncar: prev.missingEncar,
  lastStamp,
};
writeFileSync(ENCAR_LEARN_MEMORY, JSON.stringify(mem, null, 2));
console.log(`  기억 ${ENCAR_LEARN_MEMORY} · 별칭 ${mem.aliases.length} · stamp ${lastStamp ? `유지 ${lastStamp.tKeep} 채움 ${lastStamp.tFill} 보류 ${lastStamp.tHold}` : '요약 없음'}`);
console.log('  자동 금지: 엔카에 없는 세대 키 발명 · 비슷한 차 강제 매칭 · 라이브 차종마스터 탭');
