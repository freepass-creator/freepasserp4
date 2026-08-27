/**
 * **원장에 «상대 코드»를 박는다 — 공급사·영업채널 둘 다.** 기본은 «보기만», `--apply` 라야 쓴다.
 *
 * ★사장님 2026-08-27 「원장과 코드로 해야지」 「코드를 넣어서 붙이면 되잖아」
 *   「그리고 니가 학습해서 넣으면 되니까」 「공급사랑 제대로 맞추고」.
 *
 * ★★**짐작으로 안 채운다.** 못 붙는 것은 「모름」으로 두고 표에 남긴다.
 *   못 붙이면 사람이 한 번 채우면 그만이지만 **잘못 붙이면 남의 회사로 청구·지급이 선다.**
 * ★붙이는 규칙과 «어느 명부를 보나»는 `lib/domain/partner-code.ts` 한 곳에 있다.
 *   여기서 다시 정하지 않는다 — 두 군데서 정하면 언젠가 갈린다.
 *
 *   npx tsx scripts/backfill-party-code.mts             무엇이 붙나 표로만
 *   npx tsx scripts/backfill-party-code.mts --apply     정말로 박는다
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';
import { partnerRefsOf, partyCodeOf, type PartyAxis, type PartyWhy } from '../lib/domain/partner-code';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const ROWS = 'v4/settlement_rows';

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
  db.ref('partners').get(), db.ref('v4/partners').get(), db.ref(ROWS).get(),
]);
const base = (baseSnap.val() || {}) as Record<string, unknown>;
const over = (overSnap.val() || {}) as Record<string, unknown>;
const all = (rowSnap.val() || {}) as Record<string, SettlementRecord>;
const rows = Object.entries(all).map(([k, v]) => ({ k, r: normalizeRecord(v) }));

console.log(`\n■ 상대 코드 박기 — 원장 ${rows.length}줄${APPLY ? '' : '   ★보기만 합니다'}`);

/** 축 하나를 따진다. 이름별로 한 번만 — 같은 이름이면 같은 코드다. */
type Group = { name: string; lines: number; code: string; why: PartyWhy };
const patch: Record<string, unknown> = {};
let changed = 0;

for (const axis of (['공급사', '영업채널'] as const satisfies readonly PartyAxis[])) {
  const refs = partnerRefsOf(base, over, axis);
  const nameOf = (r: SettlementRecord) => (axis === '공급사' ? S(r.supplier) : S(r.channel));
  const field = axis === '공급사' ? 'supplierCode' : 'channelCode';

  const groups = new Map<string, Group>();
  for (const { r } of rows) {
    const name = nameOf(r);
    const g = groups.get(name);
    if (g) { g.lines += 1; continue; }
    const { code, why } = partyCodeOf(name, axis, refs);
    groups.set(name, { name, lines: 1, code, why });
  }

  const sorted = [...groups.values()].sort((a, b) => b.lines - a.lines);
  console.log(`\n▸ ${axis} — 명부 ${refs.length}곳 · 원장 이름 ${sorted.length}가지\n`);
  console.log('   ' + '원장 이름'.padEnd(14) + '줄'.padStart(4) + '   코드'.padEnd(12) + '  까닭');
  for (const g of sorted) {
    console.log(`   ${(g.name || '(빈칸)').padEnd(14)}${String(g.lines).padStart(4)}   `
      + `${g.code ? '○' : '⛔'} ${(g.code || '—').padEnd(9)}  ${g.why}`);
  }

  const mine = rows.filter(({ r }) => {
    const g = groups.get(nameOf(r));
    return !!g?.code && S((r as unknown as Record<string, unknown>)[field]) !== g.code;
  });
  for (const { k, r } of mine) patch[`${k}/${field}`] = groups.get(nameOf(r))!.code;
  changed += mine.length;

  const known = sorted.filter((g) => g.code);
  const unknown = sorted.filter((g) => !g.code);
  console.log(`\n   붙는 곳 ${known.length} ${known.reduce((a, g) => a + g.lines, 0)}줄`
    + `  ·  모르는 곳 ${unknown.length} ${unknown.reduce((a, g) => a + g.lines, 0)}줄`
    + `  ·  고칠 줄 ${mine.length}`);
  if (unknown.length) {
    /**
     * ⚠ 「없다」가 아니라 **「아직 모른다」**다. 여기 뜨는 것은 두 갈래다 —
     *   · 거래처 등록이 «없는» 곳        → /members 에서 등록하면 붙는다
     *   · 같은 회사가 «두 번» 등록된 곳   → 사람이 정리해야 한다(까닭에 「여럿」)
     *   이름이 달라서 안 붙는 것이면 `partner-code.ts` 의 `PARTY_ALIAS` 에 근거와 함께 적는다.
     */
    console.log('   ⛔ ' + unknown.map((g) => `${g.name || '(빈칸)'}(${g.lines})${g.why === '여럿' ? '★여럿' : ''}`).join(' · '));
  }
}

console.log(`\n■ 고칠 줄 모두 ${changed}`);
if (!APPLY) { console.log('\n   ★아직 «안 박았습니다». --apply 를 붙이세요.\n'); process.exit(0); }
if (!changed) { console.log('\n   ○ 고칠 줄이 없습니다.\n'); process.exit(0); }

/** ★한 칸만 고친다. 줄 전체를 덮어쓰면 그 사이 누가 고친 값이 날아간다. */
const now = Date.now();
for (const k of Object.keys(patch)) patch[`${k.split('/')[0]}/updatedAt`] = now;
await db.ref(ROWS).update(patch);

const after = Object.values((await db.ref(ROWS).get()).val() || {}) as SettlementRecord[];
console.log(`\n   ○ 박았습니다 — 공급사코드 ${after.filter((r) => S(r.supplierCode)).length}`
  + ` · 영업채널코드 ${after.filter((r) => S(r.channelCode)).length} / ${after.length}줄\n`);
process.exit(0);
