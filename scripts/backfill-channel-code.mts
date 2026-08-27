/**
 * **원장에 영업채널 «코드»를 박는다.** 기본은 «보기만», `--apply` 라야 쓴다.
 *
 * ★사장님 2026-08-27 「원장과 코드로 해야지」 「코드를 넣어서 붙이면 되잖아」
 *   「그리고 니가 학습해서 넣으면 되니까」.
 *
 * 여태 원장은 영업채널을 «이름»으로만 들고 있었다. 붙이는 자리마다 이름 규칙을 돌렸고
 * 그게 세 번 어긋났다 — 자세한 것은 `lib/domain/sales-channel.ts` 머리말.
 *
 * ★★**짐작으로 안 채운다.** 못 붙는 것은 「모름」으로 두고 표에 남긴다.
 *   돈이 나가는 축이라, 못 붙이면 사람이 한 번 채우면 그만이지만
 *   **잘못 붙이면 남의 회사로 지급이 선다.**
 * ★★명부는 **`v4/partners` 의 영업채널만** 쓴다. v3 를 섞으면 코드가 남의 것을 가리킨다.
 *   공급사를 섞어도 안 된다 — 원장 「퍼시픽」은 이름만 보면 공급사 `RP022 퍼시픽`에 딱 맞는다.
 *
 *   npx tsx scripts/backfill-channel-code.mts             무엇이 붙나 표로만
 *   npx tsx scripts/backfill-channel-code.mts --apply     정말로 박는다
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';
import { channelCodeOf, channelRefsOf, type ChannelWhy } from '../lib/domain/sales-channel';

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

/** ★명부는 v4 만. v3(`partners`)는 같은 회사가 두 줄씩이고 코드가 남의 것을 가리킨다. */
const refs = channelRefsOf(((await db.ref('v4/partners').get()).val() || {}) as Record<string, unknown>);
const all = ((await db.ref(ROWS).get()).val() || {}) as Record<string, SettlementRecord>;
const rows = Object.entries(all).map(([k, v]) => ({ k, r: normalizeRecord(v) }));

console.log(`\n■ 영업채널 코드 박기 — 원장 ${rows.length}줄 · 명부(v4 영업채널) ${refs.length}곳${APPLY ? '' : '   ★보기만 합니다'}\n`);

/** 채널 이름별로 한 번만 따진다 — 같은 이름이면 같은 코드다. */
type Group = { name: string; lines: number; code: string; why: ChannelWhy; had: number };
const groups = new Map<string, Group>();
for (const { r } of rows) {
  const name = S(r.channel);
  const g = groups.get(name);
  if (g) { g.lines += 1; if (S(r.channelCode)) g.had += 1; continue; }
  const { code, why } = channelCodeOf(name, refs);
  groups.set(name, { name, lines: 1, code, why, had: S(r.channelCode) ? 1 : 0 });
}

const sorted = [...groups.values()].sort((a, b) => b.lines - a.lines);
console.log('   ' + '원장 이름'.padEnd(14) + '줄'.padStart(4) + '   코드'.padEnd(12) + '  까닭');
for (const g of sorted) {
  const nm = (g.name || '(빈칸)').padEnd(14);
  const mark = g.code ? '○' : '⛔';
  console.log(`   ${nm}${String(g.lines).padStart(4)}   ${mark} ${(g.code || '—').padEnd(9)}  ${g.why}`);
}

const willSet = rows.filter(({ r }) => {
  const g = groups.get(S(r.channel));
  return !!g?.code && S(r.channelCode) !== g.code;
});
const known = sorted.filter((g) => g.code);
const unknown = sorted.filter((g) => !g.code);
console.log(`\n   붙는 채널 ${known.length}곳 ${known.reduce((a, g) => a + g.lines, 0)}줄`
  + `  ·  모르는 채널 ${unknown.length}곳 ${unknown.reduce((a, g) => a + g.lines, 0)}줄`);
console.log(`   고칠 줄 ${willSet.length}`);

if (unknown.length) {
  console.log('\n   ⛔ 이 채널들은 «파트너 등록이 없습니다» — 「없다」가 아니라 「아직 모른다」입니다.');
  console.log('      /members 에서 영업채널로 등록하고 다시 부르면 붙습니다.');
  console.log('      이름이 달라서 안 붙는 것이면 lib/domain/sales-channel.ts 의 CHANNEL_ALIAS 에 근거와 함께 적습니다.');
  console.log('      ' + unknown.map((g) => `${g.name || '(빈칸)'}(${g.lines})`).join(' · '));
}

if (!APPLY) {
  console.log('\n   ★아직 «안 박았습니다». --apply 를 붙이세요.\n');
  process.exit(0);
}
if (!willSet.length) {
  console.log('\n   ○ 고칠 줄이 없습니다.\n');
  process.exit(0);
}

/** ★한 칸만 고친다. 줄 전체를 덮어쓰면 그 사이 누가 고친 값이 날아간다. */
const now = Date.now();
const patch: Record<string, unknown> = {};
for (const { k, r } of willSet) {
  patch[`${k}/channelCode`] = groups.get(S(r.channel))!.code;
  patch[`${k}/updatedAt`] = now;
}
await db.ref(ROWS).update(patch);

const after = ((await db.ref(ROWS).get()).val() || {}) as Record<string, SettlementRecord>;
const filled = Object.values(after).filter((r) => S(r.channelCode)).length;
console.log(`\n   ○ ${willSet.length}줄에 박았습니다 — 코드 있는 줄 ${filled} / ${Object.keys(after).length}\n`);
process.exit(0);
