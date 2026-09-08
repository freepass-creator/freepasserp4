/**
 * **누가 「확인」을 켰나 — 청구서를 만들어도 되는지 한 장으로 본다.**
 *
 * ★★★사장님 2026-09-08
 *   「청구서 정산서는 뿌려진 것들 토대로 **한 번에 만드는 것뿐**이야.
 *    **월 1회 각 공급사, 영업채널이 ㅇㅋ 하면** 그걸 토대로 청구만 만든다」
 *
 * ★★**시트와 종이는 하는 일이 다르다.**
 * ```
 * 시트   상시   접수가 들어오면 그날 뿌린다 — 상대가 «보면서 확인하는» 판
 * 종이   월 1회  양쪽이 ㅇㅋ 한 뒤에 «한 번에» 만든다 — 확인 전에는 안 만든다
 * ```
 *   그래서 발행(시트)과 청구(종이)를 한 파이프라인에 묶으면 안 된다. 이 검사가 그 사이의 문이다.
 *
 * ★**확인은 «상대가 켜는 것»이다.** 우리가 대신 켜지 않는다 —
 *   그 체크가 곧 「이 금액 맞다」는 상대의 말이고, 청구서의 근거다.
 * ⚠ 「정정」이 켜진 줄은 확인이 아니다. 정정은 **아직 이야기 중**이라는 뜻이다.
 * ⚠ 0원 줄·환수 줄은 세지 않는다 — 확인할 금액이 없다.
 *
 * ```
 * npx tsx scripts/check-settlement-confirm.mts 2026-08
 * npx tsx scripts/check-settlement-confirm.mts 2026-08 --자세히
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { settleTabOf, settleTabBase } from '../lib/server/channel-sheet-tabs';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const DETAIL = process.argv.includes('--자세히');
const nap = (ms: number) => new Promise((z) => setTimeout(z, ms));
const on = (v: unknown) => /^(TRUE|true|1|Y|O|v|✓)$/.test(S(v));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;
/** ⚠ 실패를 «확인 0」으로 삼키지 않는다 — 그러면 「아무도 확인 안 했다」는 거짓말이 된다. */
const api = async (u: string): Promise<Record<string, unknown> | null> => {
  for (let t = 0; t < 5; t++) {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${await tok()}` } });
    if (r.ok) { await nap(700); return r.json() as Promise<Record<string, unknown>>; }
    if (r.status === 429 || r.status >= 500) { await nap(r.status === 429 ? 15_000 : 1500); continue; }
    console.log(`\n  ✕ 조회 실패 ${r.status} — ${(await r.text()).slice(0, 140)}\n`); process.exit(1);
  }
  return null;
};
const drive = async (q: string) => (((await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=80&supportsAllDrives=true&includeItemsFromAllDrives=true`)) as { files?: { id: string; name: string }[] } | null)?.files) || [];

const BASE = settleTabOf(MONTH);
type Stat = { who: string; kind: '공급사' | '영업채널'; rows: number; ok: number; fix: number; none: number; money: number; pending: string[] };
const stats: Stat[] = [];

const books = [
  ...(await drive("name contains '프리패스 재고' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")).map((f) => ({ ...f, kind: '공급사' as const })),
  ...(await drive("name contains '프리패스 정산' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")).map((f) => ({ ...f, kind: '영업채널' as const })),
].filter((f) => !/구버전|폐기|백업|샘플|중복|사용 안 함/.test(f.name));

for (const b of books) {
  const meta = (await api(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties.title`)) as { sheets?: { properties: { title: string } }[] } | null;
  /** ★탭 이름에 건수가 붙어 있다 — 앞글로 찾는다. */
  const tabs = (meta?.sheets || []).map((s) => s.properties.title).filter((t) => settleTabBase(t).startsWith(BASE));
  if (!tabs.length) continue;
  const qs = tabs.map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:AZ400`)}`).join('&');
  const got = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`)) as { valueRanges?: { values?: unknown[][] }[] } | null)?.valueRanges || [];
  const st: Stat = { who: b.name.replace(/^\[[^\]]+\]\s*/, '').replace(/\s*프리패스.*$/, ''), kind: b.kind, rows: 0, ok: 0, fix: 0, none: 0, money: 0, pending: [] };
  got.forEach((vr) => {
    const g = vr?.values || [];
    const h0 = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
    if (h0 < 0) return;
    const h = (g[h0] || []).map(S); const ix = (n: string) => h.indexOf(n);
    const end = g.findIndex((r, i) => i > h0 && (r || []).some((c) => S(c).replace(/\s/g, '') === '합계'));
    for (let i = h0 + 1; i < (end > h0 ? end : g.length); i++) {
      const r = g[i] || []; const net = N(r[ix('공급가액')]);
      /** 0원 줄·환수 줄은 확인할 금액이 없다. */
      if (net <= 0) continue;
      st.rows++; st.money += net;
      if (on(r[ix('정정')])) { st.fix++; st.pending.push(`정정 ${S(r[ix('차량번호')])} ${S(r[ix('임차인')])} ${S(r[ix('메모(정정사유)')]) || S(r[ix('정정금액')]) || ''}`); }
      else if (on(r[ix('확인')])) st.ok++;
      else { st.none++; st.pending.push(`미확인 ${S(r[ix('차량번호')])} ${S(r[ix('임차인')])} ${won(net)}`); }
    }
  });
  if (st.rows) stats.push(st);
}

console.log(`\n■ ${MONTH} — 「확인」이 얼마나 왔나\n`);
const show = (kind: Stat['kind'], title: string) => {
  const list = stats.filter((s) => s.kind === kind).sort((a, b) => b.money - a.money);
  if (!list.length) return;
  console.log(`  ── ${title}`);
  console.log(`     ${pad('', 14)} ${pad('줄', 5)} ${pad('확인', 6)} ${pad('정정', 6)} ${pad('미확인', 7)} ${pad('금액', 13)} 청구서`);
  for (const s of list) {
    const ready = s.none === 0 && s.fix === 0;
    console.log(`     ${pad(s.who, 14)} ${pad(String(s.rows), 5)} ${pad(String(s.ok), 6)} ${pad(String(s.fix), 6)} ${pad(String(s.none), 7)} ${pad(won(s.money), 13)} ${ready ? '○ 만들 수 있음' : '⛔ 아직'}`);
    if (DETAIL) for (const p of s.pending.slice(0, 12)) console.log(`        · ${p}`);
  }
  const ready = list.filter((s) => !s.none && !s.fix).length;
  console.log(`     → ${ready} / ${list.length} 곳이 ㅇㅋ 했습니다\n`);
};
show('공급사', '공급사 — 우리가 받을 곳');
show('영업채널', '영업채널 — 우리가 줄 곳');

const all = stats.length; const ready = stats.filter((s) => !s.none && !s.fix).length;
console.log(`   ${MONTH} 전체 ${ready} / ${all} 곳 확인 완료`);
if (ready < all) {
  console.log('   ⛔ 아직 청구서를 만들 때가 아닙니다 — 남은 곳의 「확인」을 받고 나서 한 번에 만듭니다.');
  console.log('      npx tsx scripts/check-settlement-confirm.mts ' + MONTH + ' --자세히   ← 어느 줄이 남았는지');
} else {
  console.log('   ○ 다 ㅇㅋ 했습니다 — 이제 청구서를 만듭니다.');
  console.log('      npx tsx scripts/issue-settlement-invoices.mts ' + MONTH);
}
console.log('');
process.exit(ready < all ? 1 : 0);
