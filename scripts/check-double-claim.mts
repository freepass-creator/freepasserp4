/**
 * **줄 때는 받을 것이 있어야 하고, 같은 차를 두 번 청구하면 안 된다.**
 *
 * ★사장님 2026-09-07 「하허호한테 지급해야 한다는 건 우리가 청구해야 하는데
 *   **청구한 이력이 있는지도 봐주고 2중 청구하면 안 되니까**」
 *
 * ★★**왜 이 검사가 필요해졌나.** 하허호가 8월 정산시트에 이렇게 적어 왔다 —
 * ```
 * 116하2308 이정민   「7월에 50% 정산됨 / 8월에 50% 정산 필요」
 * 130어2976 김수경   「8월 출고 2회 분납 → 9월 정산 해야 함」
 * ```
 *   앞엣것은 **이미 한 번 나간 건**이고, 뒤엣것은 **아직 안 나갈 건**이다. 둘을 구별하지 않으면
 *   ㉠ 7월에 준 것을 8월에 또 주거나 ㉡ 우리가 청구도 못 한 것을 지급해 버린다.
 *
 * ★★★**보는 곳이 둘이다 — 원장과 «이미 나간 종이».**
 * ```
 * 원장   v4/settlement_rows       우리가 «세는» 것 — 차번이 몇 줄인지, 어느 달로 잡히는지
 * 종이   각 시트의 「YY년MM월 정산」 탭   이미 «나간» 것 — 상대가 그 달에 실제로 본 줄
 * ```
 *   원장만 보면 「한 줄뿐이니 괜찮다」가 되지만, 종이가 7월에 이미 나갔으면 그게 2중이다.
 *   거꾸로 종이만 보면 원장에 두 줄인 중복(실측 142호1065 이경훈)을 못 잡는다.
 *
 * ⚠ **이 검사는 «읽기»만 한다.** 청구액과 지급액을 나란히 놓고 보는 자리라, 밖으로 나가는
 *   시트에는 아무것도 쓰지 않는다 — 청구액이 영업채널 시트에 닿으면 안 되는 그 빗장 때문이다.
 *
 * ```
 * npx tsx scripts/check-double-claim.mts --월=2026-08
 * npx tsx scripts/check-double-claim.mts --월=2026-08 --채널=하허호
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { billingMonthIn, lockedMonthsOf, settleTargetOf, type SettlementRow } from '../lib/domain/settlement-stage';
import { claimOf, payOf } from '../lib/domain/settlement-money';
/** ★나간 종이는 이름을 가린다(「임*인」) — 원자 이름도 같이 가려야 짝이 맞는다. */
import { maskName } from '../lib/domain/outward-text';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const P = (v: unknown) => { const t = S(v).replace(/\s+/g, ''); return /^\d{2,3}[가-힣]\d{4}$/.test(t) ? t : ''; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const arg = (n: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
const MONTH = S(arg('월')) || '2026-08';
const ONLY = S(arg('채널'));
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
/** ⚠ 토큰은 «부를 때마다» 새로 받는다 — 긴 훑기에서 한 번 받아 돌려 쓰면 중간에 만료돼 조용히 빈다. */
const tok = async () => (await jwt.getAccessToken()).token;
const nap = (ms: number) => new Promise((z) => setTimeout(z, ms));
/**
 * ⚠ 실패를 «없음»으로 삼키지 않는다 — 그러면 「그 달엔 안 나갔다」는 거짓말이 된다.
 * ⚠ 다만 503·429 는 «구글이 잠깐 쉬는 것»이라 뜻이 없다. 세 번까지 다시 묻고, 그래도 안 되면 멈춘다.
 */
const api = async (url: string): Promise<Record<string, unknown>> => {
  for (let t = 0; t < 6; t++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await tok()}` } });
    if (r.ok) { await nap(1100); return r.json() as Promise<Record<string, unknown>>; }
    /** ★429 = 「분당 읽기」 한도. 시트를 수십 장 훑는 검사라 반드시 걸린다 — 쉬었다 다시 묻는다. */
    if ((r.status === 429 || r.status >= 500) && t < 5) { await nap(r.status === 429 ? 20_000 : 1500 * (t + 1)); continue; }
    console.log(`\n  ✕ 조회 실패 ${r.status} — ${(await r.text()).slice(0, 160)}\n`); process.exit(1);
  }
  process.exit(1);
};

// ── ① 원장 ─────────────────────────────────────────────────
type Row = Record<string, unknown>;
const all = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[]).filter((r) => r.cancelled !== true);
const asRow = (r: Row) => ({ ...r, receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt) } as unknown as SettlementRow);
const locked = lockedMonthsOf(all.map(asRow));
/** 그 줄이 «어느 달로» 잡히나. 사람이 박은 청구월이 있으면 그것이 이긴다. */
const monthOf = (r: Row) => S(r.billMonth) || billingMonthIn(asRow(r), locked) || '';

console.log(`\n■ ${MONTH}${ONLY ? ` · ${ONLY}` : ''} — 지급 ↔ 청구 · 2중 청구 대조\n`);

// ── ② 이미 나간 종이 ────────────────────────────────────────
/**
 * 각 시트의 「YY년MM월 정산」 탭을 훑어 **차번 → 그 차가 실린 달**을 모은다.
 * ★공급사 시트 = 우리가 «청구»한 이력 · 영업채널 시트 = 우리가 «지급»한 이력.
 */
const drive = async (q: string) => (((await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=80&supportsAllDrives=true&includeItemsFromAllDrives=true`)) as { files?: { id: string; name: string }[] }).files) || [];
const TAB = /^(\d{2})년(\d{2})월 정산/;
type Hit = { book: string; tab: string; month: string; side: '청구' | '지급'; amount: number; plate: string; who: string };
const issued = new Map<string, Hit[]>();
const books = [
  ...(await drive("name contains '프리패스 재고' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")).map((f) => ({ ...f, side: '청구' as const })),
  ...(await drive("name contains '프리패스 정산' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")).map((f) => ({ ...f, side: '지급' as const })),
].filter((f) => !/구버전|폐기|백업|샘플/.test(f.name));

for (const b of books) {
  const meta = (await api(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties.title`)) as { sheets?: { properties: { title: string } }[] };
  const tabs = (meta.sheets || []).map((s) => s.properties.title).filter((t) => TAB.test(t));
  if (!tabs.length) continue;
  /** ★탭마다 묻지 않고 «한 번에» 묻는다 — 분당 읽기 한도에 걸려 훑기가 중간에 멎는다. */
  const qs = tabs.map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:AZ400`)}`).join('&');
  const got = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`)) as { valueRanges?: { values?: unknown[][] }[] }).valueRanges || [];
  tabs.forEach((t, k) => {
    const m = TAB.exec(t)!;
    const month = `20${m[1]}-${m[2]}`;
    const g = got[k]?.values || [];
    const h0 = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
    if (h0 < 0) return;
    const h = (g[h0] || []).map(S);
    const ci = h.indexOf('공급가액'); const ni = h.indexOf('임차인') >= 0 ? h.indexOf('임차인') : h.indexOf('고객명');
    for (const r of g.slice(h0 + 1)) {
      const p = P((r || [])[h.indexOf('차량번호')]); if (!p) continue;
      /**
       * ★★열쇠는 «차번 + 임차인»이다. 차번만으로 세면 **재렌트를 2중 청구로 오인**한다 —
       *   실측 161허1384 는 6월 김욱현, 8월 백현지로 «다른 계약»이고 316라1593 도 유보람↔이부연이다.
       */
      const who = ni >= 0 ? S((r || [])[ni]) : '';
      const k = `${p}|${who}`;
      issued.set(k, [...(issued.get(k) || []), { book: b.name, tab: t, month, side: b.side, amount: ci >= 0 ? N((r || [])[ci]) : 0, plate: p, who }]);
    }
  });
  console.log(`  · ${pad(b.name, 34)} ${b.side}  탭 ${tabs.length}개`);
}

// ── ③ 이 달 지급 줄 ─────────────────────────────────────────
const mine = all.filter((r) => monthOf(r) === MONTH && (!ONLY || S(r.channel).includes(ONLY)) && payOf(r) !== 0);
console.log(`\n─ ${MONTH} 지급 대상 ${mine.length}줄\n`);

const noClaim: string[] = []; const dupLedger: string[] = []; const dupPaper: string[] = []; const said: string[] = []; const noBill: string[] = [];
for (const r of mine) {
  const p = P(r.plate); const who = S(r.customer); const pay = payOf(r); const claim = claimOf(r);
  const tag = `${pad(p, 10)} ${pad(who, 8)} ${pad(S(r.supplier), 10)}`;
  /** ㉠′ **원장 비고가 이미 「정산했음」이라 말하고 있다** — 우리가 적어 놓고 또 실은 것이다. */
  if (/정산(했|됨|完|완)/.test(S(r.note))) said.push(`  ${tag} 청구 ${pad(won(claim), 11)} 지급 ${pad(won(pay), 11)} 비고 「${S(r.note)}」`);
  /** ㉠ **줄 때 받을 것이 없다** — 공급사에 청구가 0인데 영업자에게 나간다. 그만큼이 통째로 손해다. */
  if (claim === 0) noClaim.push(`  ${tag} 지급 ${pad(won(pay), 11)} ← 청구 0${settleTargetOf(r.settleTarget) === '영업' ? '  (조건: 영업만 정산)' : ''}`);
  /** ㉡ **원장에 같은 차가 두 줄** — 두 줄 다 이 달이면 그 자리에서 두 번 나간다. */
  const same = all.filter((x) => P(x.plate) === p && S(x.customer) === who);
  if (same.length > 1) dupLedger.push(`  ${tag} 원장 ${same.length}줄 — ${same.map((x) => `${monthOf(x) || '(달 없음)'} 청구 ${won(claimOf(x))} / 지급 ${won(payOf(x))}`).join('  ·  ')}`);
  /** ㉢ **이미 나간 종이에 그 차가 다른 달로 실려 있다** — 이번 달이 두 번째다. */
  const past = (issued.get(`${p}|${maskName(who)}`) || issued.get(`${p}|${who}`) || []).filter((h) => h.month !== MONTH);
  if (past.length) dupPaper.push(`  ${tag} 지난 달 종이에 있음 — ${past.map((h) => `${h.month} ${h.side} ${won(h.amount)} 〈${h.tab}〉`).join('  ·  ')}`);
  /**
   * ㉣ ★★★**주기로 해 놓고 «청구서에는 안 실린» 줄.**
   *   사장님 2026-09-07 「하허호 기준으로 우리가 지급할 거를 렌트사에 청구해야 하는데
   *   **청구서 누락된 게 있을 수 있다**는 거네」
   *   ⇒ 영업채널 정산서에는 있는데 공급사 청구서에 없으면, 그 달치는 **우리가 그냥 물어 준다.**
   *   ⚠ 청구가 애초에 0인 줄(조건이 「영업만 정산」)은 여기 오지 않는다 — 그건 ㉠ 이 따로 센다.
   */
  const onBill = (issued.get(`${p}|${maskName(who)}`) || issued.get(`${p}|${who}`) || []).some((h) => h.side === '청구' && h.month === MONTH);
  if (claim !== 0 && !onBill) noBill.push(`  ${tag} 청구 ${pad(won(claim), 11)} 지급 ${pad(won(pay), 11)} ← ${MONTH} 공급사 청구서에 없음`);
}

const box = (title: string, lines: string[], hint: string) => {
  console.log(`\n★ ${title} — ${lines.length}건`);
  if (!lines.length) { console.log('    없습니다.'); return; }
  lines.forEach((l) => console.log(l));
  console.log(`    ⇒ ${hint}`);
};
box('★주기로 해 놓고 공급사 청구서에는 «안 실린» 줄', noBill,
  '이대로 두면 그 달치는 우리가 물어 줍니다 — 공급사 청구서를 다시 찍어야 합니다.');
box('줄 때 받을 것이 없는 줄 (청구 0인데 지급)', noClaim, '공급사 청구를 세우든지, 지급을 멈추든지 사람이 정합니다.');
box('원장에 같은 차가 두 줄', dupLedger, '진짜 두 건인지 중복인지 확인 — 둘 다 이 달이면 두 번 나갑니다.');
box('이미 다른 달 종이에 실린 차 (같은 차 · 같은 임차인)', dupPaper, '그 달에 이미 정산됐다면 이번 달은 2중입니다.');
box('원장 비고가 「이미 정산했다」고 적힌 줄', said, '적어 놓고 또 실었습니다 — 비고가 맞으면 이 달에서 빼야 합니다.');

/** ★그 채널이 아니어도, **이 달 안에서 차번이 겹치면** 한 달에 두 번 세어진다. */
const seen = new Map<string, Row[]>();
for (const r of all.filter((x) => monthOf(x) === MONTH)) {
  const p = P(r.plate); if (!p) continue; seen.set(p, [...(seen.get(p) || []), r]);
}
const twice = [...seen.entries()].filter(([, v]) => v.length > 1);
console.log(`\n★ ${MONTH} «한 달 안에» 차번이 겹치는 것 — ${twice.length}건`);
if (!twice.length) console.log('    없습니다.');
for (const [p, v] of twice) console.log(`  ${pad(p, 10)} ${v.map((x) => `${pad(S(x.customer), 7)} ${S(x.channel)}/${S(x.supplier)} 청구 ${won(claimOf(x))} 지급 ${won(payOf(x))}`).join('  ·  ')}`);

console.log(`\n   ${MONTH}${ONLY ? ` ${ONLY}` : ''}  청구 합 ${won(mine.reduce((a, r) => a + claimOf(r), 0))} · 지급 합 ${won(mine.reduce((a, r) => a + payOf(r), 0))} (부가세 별도)\n`);
process.exit(noBill.length || noClaim.length || dupLedger.length || dupPaper.length || said.length || twice.length ? 1 : 0);
