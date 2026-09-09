/**
 * **청구월을 «박는다».** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-07 「**인도일 없이 청구해도 되니까 접수일만 있어도 청구는 됨.
 *   청구해 보면 공급사가 말하겄지**」
 *
 * ★★**왜 필요한가 — 「인도가 관문」이라 인도일이 비면 그 줄이 어느 달에도 안 선다.**
 * ```
 * 계산       인도일이 있어야 청구월이 나온다 (billingMonth)
 * 박은 값    사람이 정한 달이 계산보다 «이긴다» (billMonth)
 * ```
 *   실측 2026-09-07 — 하허호가 「누락」이라 적어 온 장은미·오주형·전은재 셋은 원장에 줄이 있는데
 *   **인도일이 비어 8월에도 9월에도 안 섰다.** 그래서 공급사 청구서에도, 채널 정산서에도 없었다.
 *   ⇒ 인도일을 기다리지 않는다. **접수일이 있으면 청구를 넣고, 틀렸으면 공급사가 말한다.**
 *
 * ⚠ **금액은 손대지 않는다.** 여기서 정하는 것은 «어느 달에 세느냐» 하나뿐이다.
 * ⚠ 이미 다른 달이 박혀 있으면 덮지 않는다 — `--덮어` 를 줘야 바꾼다. 이미 나간 청구서의 근거다.
 *
 * ```
 * npx tsx scripts/set-bill-month.mts --월=2026-08 --차=133다9973,353더3935,373어6607
 * npx tsx scripts/set-bill-month.mts --월=2026-08 --차=133다9973 --임차인=장은미 --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { billingMonthIn, lockedMonthsOf, type SettlementRow } from '../lib/domain/settlement-stage';
import { claimOf, payOf } from '../lib/domain/settlement-money';

const S = (v: unknown) => String(v ?? '').trim();
const P = (v: unknown) => S(v).replace(/\s/g, '');
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const arg = (n: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
const MONTH = S(arg('월'));
/** ★차번마다 임차인을 붙일 수 있다 — `133다9973:장은미` 꼴. 같은 차가 재렌트로 두 줄인 때를 위해서다. */
const PLATES = S(arg('차')).split(',').map((x) => { const [p, w] = x.split(':'); return { plate: P(p), who: S(w) }; }).filter((x) => x.plate);
const WHO = S(arg('임차인'));
const WHY = S(arg('왜')) || '인도일 없이 접수일 기준으로 청구를 넣는다 — 틀리면 공급사가 말한다(사장님 2026-09-07)';
const APPLY = process.argv.includes('--apply');
const OVER = process.argv.includes('--덮어');
if (!/^\d{4}-\d{2}$/.test(MONTH) || !PLATES.length) {
  console.log('\n  npx tsx scripts/set-bill-month.mts --월=2026-08 --차=133다9973,353더3935 [--임차인=장은미] [--덮어] [--apply]\n');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const fsdb = getFirestore();

const rows = (await fsdb.collection('settlement_rows').get()).docs.map((d) => [d.id, d.data()]) as [string, Record<string, unknown>][];
const asRow = (r: Record<string, unknown>) => ({ ...r, receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt) } as unknown as SettlementRow);
const locked = lockedMonthsOf(rows.map(([, r]) => asRow(r)));

console.log(`\n■ 청구월을 ${MONTH} 로 박는다 — 차 ${PLATES.length}대 ${APPLY ? '(반영)' : '(대조만)'}\n`);
const puts: [string, string][] = [];
for (const { plate: p, who: w0 } of PLATES) {
  const who = w0 || WHO;
  const hit = rows.filter(([, r]) => P(r.plate) === p && r.cancelled !== true && (!who || S(r.customer) === who));
  if (!hit.length) { console.log(`  ✕ ${p}${who ? ` ${who}` : ''} — 원장에 없습니다`); continue; }
  if (hit.length > 1 && !who) { console.log(`  ? ${p} — ${hit.length}줄입니다(${hit.map(([, r]) => S(r.customer)).join(' · ')}). 「차번:임차인」 으로 하나를 고르세요`); continue; }
  for (const [k, r] of hit) {
    const had = S(r.billMonth);
    const calc = billingMonthIn(asRow(r), locked) || '(달 안 잡힘)';
    const tag = `${p.padEnd(10)} ${S(r.customer).padEnd(7)} ${S(r.supplier).padEnd(10)} 접수=${S(r.receivedAt) || '(없음)'} 인도=${S(r.deliveredAt) || '(없음)'}`;
    if (had === MONTH) { console.log(`  ○ ${tag} — 이미 ${MONTH} 로 박혀 있습니다`); continue; }
    if (had && !OVER) { console.log(`  ⚠ ${tag} — 이미 «${had}» 가 박혀 있습니다. 바꾸려면 --덮어`); continue; }
    console.log(`  + ${tag}`);
    console.log(`      계산 ${calc} · 박은 값 ${had || '(없음)'}  →  ${MONTH}   청구 ${won(claimOf(r))} · 지급 ${won(payOf(r))}`);
    puts.push([k, had]);
  }
}
console.log(`\n   박을 줄 ${puts.length}개 · 「왜」 = ${WHY}`);
if (!puts.length) { console.log('\n  박을 것이 없습니다.\n'); process.exit(0); }
/**
 * ★★★**원장(F04)에도 같이 박는다 — 거기가 정본이다.**
 *   원자에만 박으면 다음 `atomize` 가 원장을 다시 부으면서 조용히 되돌린다
 *   (실측 2026-09-07 — 인도일 없는 세 줄이 그렇게 8월 청구서에서 도로 빠졌다).
 */
const F04 = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
const A1 = (n: number) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const api = async (m: string, b?: unknown) => {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${F04}${m}`, { method: b ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  if (!r.ok) { console.log(`\n  ✕ 원장 조회·쓰기 실패 ${r.status} — ${(await r.text()).slice(0, 160)}\n`); process.exit(1); }
  return r.json() as Promise<{ values?: unknown[][] }>;
};
const want = new Map(PLATES.map((x) => [x.plate, x.who || WHO]));
const cells: { range: string; values: (string | number)[][] }[] = [];
console.log('\n■ 원장(F04) 청구년·청구월');
for (const tab of ['접수', '완납실적', '분납실적']) {
  const g = (await api(`/values/${encodeURIComponent(`'${tab}'!A1:BB900`)}?valueRenderOption=UNFORMATTED_VALUE`)).values || [];
  const h0 = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호')); if (h0 < 0) continue;
  const h = (g[h0] || []).map(S); const ix = (n: string) => h.indexOf(n);
  for (let i = h0 + 1; i < g.length; i++) {
    const r = g[i] || []; const p = P(r[ix('차량번호')]);
    if (!want.has(p)) continue;
    const w = want.get(p); if (w && S(r[ix('고객명')]) !== w) continue;
    const hadY = S(r[ix('청구년')]); const hadM = S(r[ix('청구월')]);
    if (hadY === MONTH.slice(0, 4) && Number(hadM) === Number(MONTH.slice(5))) { console.log(`  ○ ${p} ${tab}${i + 1}행 — 이미 ${MONTH}`); continue; }
    console.log(`  + ${p} ${S(r[ix('고객명')])} ${tab}${i + 1}행  ${hadY || '(빈칸)'}/${hadM || '(빈칸)'} → ${MONTH.slice(0, 4)}/${Number(MONTH.slice(5))}`);
    cells.push({ range: `'${tab}'!${A1(ix('청구년'))}${i + 1}`, values: [[Number(MONTH.slice(0, 4))]] });
    cells.push({ range: `'${tab}'!${A1(ix('청구월'))}${i + 1}`, values: [[Number(MONTH.slice(5))]] });
    const bi = ix('비고'); const hadNote = S(r[bi]);
    if (bi >= 0 && !hadNote.includes(WHY)) cells.push({ range: `'${tab}'!${A1(bi)}${i + 1}`, values: [[hadNote ? `${hadNote} · ${WHY}` : WHY]] });
  }
}
console.log(`   원장에서 고칠 칸 ${cells.length}개`);
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 박습니다.\n'); process.exit(0); }
if (cells.length) await api('/values:batchUpdate', { valueInputOption: 'RAW', data: cells } as never);
for (const [k, had] of puts) {
  const cur = S(((await fsdb.collection('settlement_rows').doc(k).get()).data() || {}).note);
  await fsdb.collection('settlement_rows').doc(k).set({
    billMonth: MONTH, updatedAt: Date.now(),
    note: [cur, `청구월 ${had || '(없음)'} → ${MONTH} · ${WHY}`].filter(Boolean).join(' / '),
  });
}
console.log(`\n  ✓ ${puts.length}줄에 청구월을 박았습니다.`);
console.log(`  ※ 이어서 — npx tsx scripts/run-settlement-month.mts ${MONTH} --apply\n`);
process.exit(0);
