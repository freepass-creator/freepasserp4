/**
 * **채널이 정산시트에 적어 준 정정을 우리 원장(F04)에 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-07 「하허호꺼 정산시트 기반으로 우리거랑 맞춰보자」 · 「하허호꺼 일단 확정지어봐」
 *
 * ★★**채널이 적어 주는 말은 세 가지다.**
 * ```
 * ① 사실이 틀렸다      접수일·인도일·임차인 — 우리 원장에 그대로 넣으면 된다
 * ② 금액이 틀렸다      「정정금액」에 숫자를 적어 준 것 — 지급액을 그 값으로
 * ③ 이 달이 아니다     「8월 출고 2회 분납 → 9월 정산 해야 함」 — 청구월을 옮긴다
 * ```
 *   ③이 가장 흔하다. 분납은 완납 때 정산이라, 8월에 출고돼도 2회분납이면 9월이다.
 *   ⇒ 금액을 0으로 만들지 않고 «달을 옮긴다». 0으로 두면 그 건이 영영 사라진다.
 *
 * ⚠ **금액을 «지어내지» 않는다.** 「정정」만 켜고 숫자를 안 적은 줄은 달만 옮기고 금액은 그대로 둔다.
 *   「누락」이라 적었는데 금액이 없는 줄은 접수부터 들어가야 하므로 여기서 손대지 않는다.
 *
 * ```
 * npx tsx scripts/align-channel-claim.mts --채널=하허호 --월=2026-08
 * npx tsx scripts/align-channel-claim.mts --채널=하허호 --월=2026-08 --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { type SheetEdit } from '../lib/server/sheet-edits';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const P = (v: unknown) => { const t = S(v).replace(/\s+/g, ''); return /^\d{2,3}[가-힣]\d{4}$/.test(t) ? t : ''; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const arg = (n: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
const CH = S(arg('채널')); const MONTH = S(arg('월')); const APPLY = process.argv.includes('--apply');
/**
 * ★★★**사실 먼저, 돈은 나중** — 사장님 2026-09-07
 *   「일단 «사실근거»로 영업자거 만들고 · 영업자 보완하고 · 공급사 물어보는 거로」
 *
 * ```
 * ① 사실(접수일·인도일)로 영업자 것을 만든다     ← 다투지 않는 값이라 바로 넣는다
 * ② 영업자에게 보여 주고 보완받는다
 * ③ 그것을 근거로 공급사에 물어본다 — 공급사가 「ㅇㅋ」 하면 정산이다
 * ```
 *   순서를 뒤집으면 «확인받을 근거»가 이미 바뀐 채로 나간다.
 * ⚠ 그래서 기본이 「사실만」이다. 돈·달 옮김까지 넣으려면 `--돈까지` 를 준다.
 */
const FACTS_ONLY = !process.argv.includes('--돈까지');
if (!CH || !/^\d{4}-\d{2}$/.test(MONTH)) { console.log('\n  npx tsx scripts/align-channel-claim.mts --채널=하허호 --월=2026-08 [--apply]\n'); process.exit(1); }
const nextMonth = (m: string) => { const y = Number(m.slice(0, 4)); const n = Number(m.slice(5)) + 1;
  return `${y + Math.floor((n - 1) / 12)}-${String(((n - 1) % 12) + 1).padStart(2, '0')}`; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!r.ok) { console.log(`\n  ✕ 조회·쓰기 실패 ${r.status} — ${(await r.text()).slice(0, 160)}\n`); process.exit(1); }
  return r;
};
const F04 = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
const A1 = (n: number) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

/** 그 채널이 이 달에 적어 둔 «대기» 고침만 본다. */
const edits = (Object.values((await db.ref('v4/sheet_edits').get()).val() || {}) as SheetEdit[])
  .filter((e) => S(e.channel) === CH && S(e.month) === MONTH && S(e.status) === '대기');
/** ★「9월 정산 해야 함」 같은 말은 «달을 옮기라»는 뜻이다. 그 말을 여기서 읽는다. */
const MOVE = /다음\s*달|익월|(\d{1,2})\s*월\s*정산/;
type Plan = { plate: string; move?: string; pay?: number; recv?: string; deliv?: string; why: string[] };
const plan = new Map<string, Plan>();
const add = (p: string, f: Partial<Plan>, why: string) => {
  const cur = plan.get(p) || { plate: p, why: [] as string[] };
  plan.set(p, { ...cur, ...f, why: [...cur.why, why] });
};
for (const e of edits) {
  const p = P(e.key); if (!p) continue;
  const col = S(e.column); const memo = S(e.why);
  if (col === '누락') continue;                                   // 접수부터 — 여기서 안 만든다
  if (col === '접수일' && S(e.theirs)) add(p, { recv: S(e.theirs) }, `접수일 ${S(e.ours) || '(빈칸)'} → ${S(e.theirs)}`);
  if (col === '인도일' && S(e.theirs)) add(p, { deliv: S(e.theirs) }, `인도일 ${S(e.ours) || '(빈칸)'} → ${S(e.theirs)}`);
  if (col === '공급가액') {
    if (MOVE.test(memo)) { const m = /(\d{1,2})\s*월\s*정산/.exec(memo);
      const to = m ? `${MONTH.slice(0, 4)}-${String(Number(m[1])).padStart(2, '0')}` : nextMonth(MONTH);
      add(p, { move: to }, `청구월 ${MONTH} → ${to}  (${memo.replace(/^그쪽 메모 — /, '')})`); }
    else if (N(e.theirs) > 0) add(p, { pay: N(e.theirs) }, `지급 ${won(N(e.ours))} → ${won(N(e.theirs))}${memo ? `  (${memo.replace(/^그쪽 메모 — /, '')})` : ''}`);
    else if (S(e.theirs) === '0') add(p, { move: nextMonth(MONTH) }, `지급 ${won(N(e.ours))} → 0 이라 적음 ⇒ 다음 달로 옮긴다`);
  }
}

console.log(`\n■ ${CH} ${MONTH} — 정산시트에 적어 준 정정 ${plan.size}대 ${APPLY ? '(반영)' : '(대조만)'}\n`);
const puts: { range: string; values: (string | number)[][] }[] = [];
let cut = 0;
for (const tab of ['접수', '완납실적', '분납실적']) {
  const g = (((await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${F04}/values/${encodeURIComponent(`'${tab}'!A1:BB800`)}?valueRenderOption=UNFORMATTED_VALUE`)).json()) as { values?: unknown[][] }).values) || [];
  const h0 = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호')); if (h0 < 0) continue;
  const h = (g[h0] || []).map(S); const ix = (n: string) => h.indexOf(n);
  for (let i = h0 + 1; i < g.length; i++) {
    const r = g[i] || []; const p = P(r[ix('차량번호')]); const pl = plan.get(p); if (!pl) continue;
    if (!S(r[ix('영업채널')]).includes(CH.slice(0, 3))) continue;
    if (N(r[ix('청구년')]) !== Number(MONTH.slice(0, 4)) || N(r[ix('청구월')]) !== Number(MONTH.slice(5))) continue;
    plan.delete(p);
    if (pl.move && !FACTS_ONLY) { const [y, m] = pl.move.split('-').map(Number); cut += N(r[ix('출고수수료')]);
      puts.push({ range: `'${tab}'!${A1(ix('청구년'))}${i + 1}`, values: [[y]] });
      puts.push({ range: `'${tab}'!${A1(ix('청구월'))}${i + 1}`, values: [[m]] }); }
    if (pl.pay !== undefined && !FACTS_ONLY) { cut += N(r[ix('출고수수료')]) - pl.pay;
      puts.push({ range: `'${tab}'!${A1(ix('출고수수료'))}${i + 1}`, values: [[pl.pay]] }); }
    if (pl.recv) puts.push({ range: `'${tab}'!${A1(ix('접수일'))}${i + 1}`, values: [[pl.recv]] });
    if (pl.deliv && !S(r[ix('인도일')])) puts.push({ range: `'${tab}'!${A1(ix('인도일'))}${i + 1}`, values: [[pl.deliv]] });
    console.log(`  ${p.padEnd(10)} ${S(r[ix('고객명')]).padEnd(7)} ${tab.padEnd(5)}${String(i + 1).padStart(4)}행`);
    pl.why.forEach((w) => console.log(`     ${FACTS_ONLY && /지급|청구월/.test(w) ? '·(보류)' : '·'} ${w}`));
  }
}
if (plan.size) { console.log('\n  ~ 이 달 그 채널 줄에서 못 찾은 것 — 이미 옮겼거나 다른 달입니다');
  for (const p of plan.values()) console.log(`     ${p.plate.padEnd(10)} ${p.why.join(' · ')}`); }
console.log(`\n   ${MONTH} ${CH} 지급이 ${won(cut)} 만큼 줄어듭니다 (부가세 별도) · 고칠 칸 ${puts.length}개`);
if (!puts.length) { console.log('\n  ✓ 고칠 것이 없습니다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 맞춥니다.\n'); process.exit(0); }
await api(`https://sheets.googleapis.com/v4/spreadsheets/${F04}/values:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: puts }) });
console.log(`\n  ✓ ${puts.length}칸을 맞췄습니다.`);
console.log(`  ※ 이어서 — npx tsx scripts/run-settlement-month.mts ${MONTH} --apply\n`);
process.exit(0);
