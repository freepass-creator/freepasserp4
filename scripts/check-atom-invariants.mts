/**
 * 원자 불변식 게이트 — «절대 실수할 수 없는 엔진»의 줄자 (사장님 2026-09-05).
 *   lib/domain/atom-invariants 를 전 원자에 돌린다. «확정인데 block 위반»은 «있으면 안 되는 모순」 = exit 1.
 *   기본: Firestore 전수. --local: tmp 스냅 없이 라이브.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { makerGroup } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import { atomViolations, type MasterIndex, type AtomView } from '../lib/domain/atom-invariants';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');

// 마스터 인덱스 — 순수 불변식에 넘길 조회.
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as unknown;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : (masterRaw as { entries?: MasterEntry[] }).entries) || []) as MasterEntry[];
const SUB = new Set<string>(); const TRIMS = new Map<string, string[]>();
for (const e of MASTER) {
  const mo = N(e.model), sm = N(e.sub_model); if (!mo || !sm) continue;
  for (const a of makerGroup(N(e.maker))) { SUB.add(`${a}|${mo}|${sm}`); if (e.trims?.length) TRIMS.set(`${a}|${mo}|${sm}`, e.trims); }
}
const idx: MasterIndex = {
  validSub: (mk, mo, sm) => { for (const a of makerGroup(N(mk))) if (SUB.has(`${a}|${N(mo)}|${N(sm)}`)) return true; return false; },
  trimsOf: (mk, mo, sm) => { for (const a of makerGroup(N(mk))) { const t = TRIMS.get(`${a}|${N(mo)}|${N(sm)}`); if (t) return t; } return []; },
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const snap = await fs.collection('products').get();

const byCode: Record<string, number> = {};
let blocked = 0, confirmedBlocked = 0;
const worst: string[] = [];
for (const d of snap.docs) {
  const x = d.data() as Record<string, unknown> & AtomView;
  const vio = atomViolations(x, idx);
  if (!vio.length) continue;
  for (const w of vio) byCode[w.code] = (byCode[w.code] || 0) + 1;
  const hasBlock = vio.some((w) => w.severity === 'block');
  if (hasBlock) blocked++;
  if (hasBlock && x.확정 === true) {
    confirmedBlocked++;
    if (worst.length < 20) worst.push(`  ✗ ${S(x.car_number)} [확정] ${vio.filter((w) => w.severity === 'block').map((w) => w.code + ':' + w.msg).join(' · ')}`);
  }
}

console.log(`■ 원자 불변식 게이트 — ${snap.size}대`);
console.log(`  위반 종류: ${Object.entries(byCode).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`);
console.log(`  block 위반 원자 ${blocked} (그중 «확정인데 block» = ${confirmedBlocked})`);
if (worst.length) { console.log('\n★있으면 안 되는 것 — 확정인데 모순:'); for (const l of worst) console.log(l); }
console.log(`\n${confirmedBlocked === 0 ? '✓ 확정 원자에 모순 없음 — 엔진 무결' : `✗ 확정인데 모순 ${confirmedBlocked}건 — 엔진이 이걸 확정으로 두면 안 된다`}`);
process.exit(confirmedBlocked === 0 ? 0 : 1);
