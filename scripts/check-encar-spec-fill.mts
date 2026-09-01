/**
 * 엔카 제원 채움 가드 — 161허1165 급(T 확정인데 1.6·2WD 를 못 채움) 재발 차단.
 * 원자 JSON 만 읽고 시트를 쓰지 않는다. 깨지면 exit 1.
 *
 *   npx tsx scripts/check-encar-spec-fill.mts
 */
import { readFileSync } from 'node:fs';
import {
  assertEncarSpecFillGuards, driveKey, fuelKey, nk, S,
  type GuardAtom,
} from '../lib/domain/encar-spec-fill';

const ATOM_PATH = process.argv.find((a) => a.startsWith('--atoms='))?.slice(8)
  || 'C:\\Users\\admin\\encar-market-survey\\reports\\atom_draft_rows.json';

type Rec = Record<string, any>;
const payload = JSON.parse(readFileSync(ATOM_PATH, 'utf8')) as { headers: string[]; values: (string | number)[][] };
const zip = (headers: string[], row: (string | number)[]) => {
  const o: Rec = {};
  headers.forEach((h, i) => { o[h] = row[i]; });
  return o;
};
const ccNum = (v: unknown) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
const atoms: GuardAtom[] = payload.values.map((r) => {
  const o = zip(payload.headers, r);
  const cc = ccNum(o['정확배기량(cc)']);
  const litersRaw = Number(o['표시배기량(L)']) || 0;
  return {
    t: S(o['세부트림행키']) || S(o['트림행키']),
    fuel: fuelKey(o['연료']),
    fuelName: S(o['연료']),
    cc,
    liters: litersRaw || (cc ? Math.round(cc / 100) / 10 : 0),
    seats: Number(o['인승']) || 0,
    drive: driveKey(o['구동방식']) || nk(o['구동방식']),
    driveName: S(o['구동방식']),
    turbo: S(o['터보']) === '예' || /터보/.test(S(o['세부트림'])),
    trimName: S(o['세부트림']),
    encarTrim: S(o['엔카트림']) || S(o['세부트림']),
    yearStart: Number(String(o['연식시작']).match(/(20\d{2})/)?.[1] || 0) || 0,
    yearEnd: Number(String(o['연식종료']).match(/(20\d{2})/)?.[1] || 0) || 0,
  };
}).filter((a) => a.t);

assertEncarSpecFillGuards(atoms);
console.log(`✓ 엔카 제원 채움 가드 통과 · 원자 ${atoms.length} · T ${new Set(atoms.map((a) => a.t)).size}`);
