/**
 * **영업담당자를 «상담방»에서 당겨 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-08 「담당자를 왜 못 채워 넣냐. 우리 쪽에 아예 정보가 없어??」
 *
 * ★★**있었다 — 다른 서랍에 있었다.**
 *   접수 탭·원자·계약현황에는 없지만, ERP 상담방(`v4/rooms`)에는 **차번마다 그 방을 연 영업자**가
 *   `agent_name` · `agent_code` · `agent_channel_code` 로 박혀 있다. 방을 여는 사람이 곧 그 차를 미는 사람이다.
 * ```
 * 실측 2026-09-08 — 담당자가 비어 있던 여섯 건 가운데 셋을 상담방에서 찾았다
 *   133다9973 장은미  → 최원영(S0035) · 하허호
 *   46소3954  강성훈  → 최원영(S0035) · 하허호
 *   46소3910  정희경  → 이태헌(S0004) · 하허호   ★채널까지 여기서 확정됐다
 * ```
 *
 * ★**채널도 같이 채운다** — `agent_channel_code` 가 그 방의 영업채널이다.
 *   46소3910 정희경은 손오공 청구서로 처음 알게 된 건이라 채널을 몰랐는데, 방이 답을 갖고 있었다.
 *
 * ⚠ **빈칸만 채운다.** 적혀 있는 담당자는 안 덮는다 — 중간에 사람이 바뀌었을 수 있다.
 * ⚠ **한 차에 방이 여럿이면 «가장 최근» 방을 쓴다.** 그 차를 마지막으로 민 사람이다.
 * ⚠ 방이 없으면 넘어간다. 지어내지 않는다.
 *
 * ```
 * npx tsx scripts/fill-agent-from-rooms.mts
 * npx tsx scripts/fill-agent-from-rooms.mts --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { PARTNER_CI } from '../lib/domain/partner-ci';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v)); return Number.isFinite(n) ? n : 0; };
const P = (v: unknown) => S(v).replace(/\s/g, '');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const APPLY = process.argv.includes('--apply');
const F04 = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
const TABS = ['접수', '완납실적', '분납실적'];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const api = async (m: string, b?: unknown) => {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${F04}${m}`, { method: b ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  if (!r.ok) { console.log(`\n  ✕ ${r.status} — ${(await r.text()).slice(0, 180)}\n`); process.exit(1); }
  return r.json() as Promise<{ values?: unknown[][] }>;
};
const A1 = (n: number) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
/** 채널코드(SP001) → 우리가 부르는 이름(하허호). 모르면 코드를 그대로 둔다. */
const channelOf = (code: string) => S(PARTNER_CI.find((c) => S(c.code) === S(code))?.alias) || S(code);

/** 차번 → 그 차의 «가장 최근» 상담방. */
type Room = { agent: string; code: string; channel: string; at: number };
const byPlate = new Map<string, Room>();
for (const r of Object.values((await db.ref('v4/rooms').get()).val() || {}) as Record<string, unknown>[]) {
  const p = P(r.car_number); const agent = S(r.agent_name); if (!p || !agent) continue;
  const at = N(r.updated_at) || N(r.created_at);
  const cur = byPlate.get(p);
  if (cur && cur.at >= at) continue;
  byPlate.set(p, { agent, code: S(r.agent_code), channel: channelOf(S(r.agent_channel_code)), at });
}
console.log(`\n■ 상담방에서 영업담당자를 당긴다 — 방이 있는 차 ${byPlate.size}대 ${APPLY ? '(반영)' : '(대조만)'}\n`);

const puts: { range: string; values: (string | number)[][] }[] = [];
let hit = 0; let none = 0;
for (const TAB of TABS) {
  const g = ((await api(`/values/${encodeURIComponent(`'${TAB}'!A1:BB900`)}?valueRenderOption=UNFORMATTED_VALUE`)).values) || [];
  const h0 = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호')); if (h0 < 0) continue;
  const h = (g[h0] || []).map(S); const ix = (n: string) => h.indexOf(n);
  for (let i = h0 + 1; i < g.length; i++) {
    const r = g[i] || []; const p = P(r[ix('차량번호')]); if (!p) continue;
    /** ★담당자가 이미 있으면 안 건드린다 — 중간에 사람이 바뀌었을 수 있다. */
    const needAgent = !S(r[ix('영업담당자')]);
    const needCh = !S(r[ix('영업채널')]);
    const needCode = ix('영업자코드') >= 0 && !S(r[ix('영업자코드')]);
    if (!needAgent && !needCh && !needCode) continue;
    const room = byPlate.get(p);
    if (!room) { if (needAgent) none++; continue; }
    const did: string[] = [];
    if (needAgent && room.agent) { puts.push({ range: `'${TAB}'!${A1(ix('영업담당자'))}${i + 1}`, values: [[room.agent]] }); did.push(`담당자=${room.agent}`); }
    if (needCh && room.channel) { puts.push({ range: `'${TAB}'!${A1(ix('영업채널'))}${i + 1}`, values: [[room.channel]] }); did.push(`채널=${room.channel}`); }
    if (needCode && room.code) { puts.push({ range: `'${TAB}'!${A1(ix('영업자코드'))}${i + 1}`, values: [[room.code]] }); did.push(`코드=${room.code}`); }
    if (!did.length) continue;
    hit++;
    console.log(`  + ${pad(p, 10)} ${pad(S(r[ix('고객명')]), 8)} ${pad(TAB, 5)}${String(i + 1).padStart(4)}행  ${did.join(' · ')}`);
  }
}
console.log(`\n   채운 줄 ${hit} · 방이 없어 못 채운 줄 ${none} · 고칠 칸 ${puts.length}`);
if (!puts.length) { console.log('\n  채울 것이 없습니다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 채웁니다.\n'); process.exit(0); }
await api('/values:batchUpdate', { valueInputOption: 'RAW', data: puts });
console.log(`\n  ✓ ${puts.length}칸을 채웠습니다.`);
console.log('  ※ 이어서 — npm run settlement:import -- --apply → 원자화 → 발행\n');
process.exit(0);
