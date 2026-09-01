/**
 * **코드로 붙이기가 성한가** — 원장·명부를 실제로 읽어 본다. 읽기만 한다.
 *
 * ★사장님 2026-08-27 「원장과 코드로 해야지」 「공급사랑 제대로 맞추고」.
 *
 * 보는 것 넷 —
 * ```
 * ① 이름 여럿이 «같은 코드»로 몰리지 않나   몰리면 청구서가 두 장 서면서 줄이 겹친다
 * ② 박힌 코드가 명부에 «있나»              없으면 상대를 못 찾아 사업자번호가 빈 채로 나간다
 * ③ 축이 안 섞였나                       공급사 코드가 채널 자리에 있으면 지급이 남에게 간다
 * ④ 코드로 찾은 상대와 이름으로 찾은 상대가 «다른가»  다르면 그게 여태 틀리던 자리다
 * ```
 * ★★①이 제일 무섭다. 화면은 «이름»으로 묶어 청구서 목록을 만드는데(`/settlement/ledger`),
 *   줄 고르기는 «코드»로 한다. 두 이름이 한 코드면 두 장이 같은 줄을 다 담는다 — 두 배로 청구된다.
 *
 *   npx tsx scripts/check-party-code.mts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';
import { partnerRefsOf, partyCodeOf, type PartyAxis } from '../lib/domain/partner-code';
import { nameKey } from '../lib/domain/settlement-view';

const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({
    credential: cert(sa),
    databaseURL: S(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL)
      || 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
  });
}
const db = getDatabase();
const [baseSnap, overSnap, rowSnap] = await Promise.all([
  db.ref('partners').get(), db.ref('v4/partners').get(), db.ref('v4/settlement_rows').get(),
]);
const base = (baseSnap.val() || {}) as Record<string, unknown>;
const over = (overSnap.val() || {}) as Record<string, unknown>;
const rows = Object.values((rowSnap.val() || {}) as Record<string, SettlementRecord>).map(normalizeRecord);

const fail: string[] = [];
const ok = (why: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '○' : '⛔'} ${why}${detail ? `  ${detail}` : ''}`);
  if (!cond) fail.push(why);
};

console.log(`\n■ 코드로 붙이기 — 원장 ${rows.length}줄\n`);

for (const axis of (['공급사', '영업채널'] as const satisfies readonly PartyAxis[])) {
  const refs = partnerRefsOf(base, over, axis);
  const codeSet = new Set(refs.map((r) => r.code));
  const nameOf = (r: SettlementRecord) => (axis === '공급사' ? S(r.supplier) : S(r.channel));
  const codeOf = (r: SettlementRecord) => (axis === '공급사' ? S(r.supplierCode) : S(r.channelCode));

  console.log(`▸ ${axis} — 명부 ${refs.length}곳`);

  // ① 이름 여럿이 같은 코드로 몰리나
  const byCode = new Map<string, Set<string>>();
  for (const r of rows) {
    const c = codeOf(r); if (!c) continue;
    if (!byCode.has(c)) byCode.set(c, new Set());
    byCode.get(c)!.add(nameOf(r));
  }
  const piled = [...byCode].filter(([, names]) => names.size > 1);
  ok('이름 여럿이 같은 코드로 안 몰린다', piled.length === 0,
    piled.map(([c, n]) => `${c}←${[...n].join('+')}`).join(' , '));

  // ② 박힌 코드가 명부에 있나
  const orphan = [...byCode.keys()].filter((c) => !codeSet.has(c));
  ok('박힌 코드가 명부에 다 있다', orphan.length === 0, orphan.join(' , '));

  // ③ 축이 안 섞였나 — 반대 축 명부에만 있는 코드가 박혀 있으면 안 된다
  const otherCodes = new Set(partnerRefsOf(base, over, axis === '공급사' ? '영업채널' : '공급사').map((r) => r.code));
  const crossed = [...byCode.keys()].filter((c) => !codeSet.has(c) && otherCodes.has(c));
  ok('반대 축 코드가 안 섞였다', crossed.length === 0, crossed.join(' , '));

  // ④ 코드로 찾은 상대 ↔ 이름으로 찾은 상대
  const names = [...new Set(rows.map(nameOf).filter(Boolean))];
  const diff: string[] = [];
  for (const nm of names) {
    const want = nameKey(nm);
    const byName = refs.filter((r) => { const k = nameKey(r.name); return k === want || k.startsWith(want); });
    const code = partyCodeOf(nm, axis, refs).code;
    const picked = refs.find((r) => r.code === code);
    if (!picked) continue;
    if (byName.length !== 1 || byName[0].code !== picked.code) {
      diff.push(`${nm} → 코드 ${picked.code} ${picked.name}${byName.length === 1 ? ` (이름은 ${byName[0].code})` : ` (이름으로는 ${byName.length}곳)`}`);
    }
  }
  console.log(diff.length
    ? `  ⓘ 이름으로는 못 고르던 곳 ${diff.length} — ${diff.join(' / ')}`
    : '  ⓘ 이름으로 고른 것과 코드로 고른 것이 같습니다');
  console.log('');
}

console.log(fail.length ? `⛔ ${fail.length}가지가 틀렸습니다 — ${fail.join(' / ')}\n` : '○ 다 맞음\n');
process.exit(fail.length ? 1 : 0);
