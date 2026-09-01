/**
 * **「작업」 페이지 — 지금 봐야 할 것만.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「환수확인해야할거랑 8월 진행중인거 · 그거 페이지가 가장 중요하긴함」.
 *
 * ★두 덩이만 싣는다. 끝난 것은 안 싣는다 — 끝난 것을 보여 주면 봐야 할 것이 묻힌다.
 *   ① **환수 감시**   분납인데 아직 기간이 안 지난 건. 기간이 지나고 환수가 없으면 **저절로 빠진다**
 *                    (사장님 「환수가 없으면 제대로 이행했다는거니까 따로 적을 필요 없다」)
 *   ② **당월 진행중**  이번 달 접수·인도 중 아직 안 끝난 건
 *
 * ★**실적은 접수 기준이다**(사장님 2026-08-25 「접수기준으로 봐야함」).
 *   탭 기준으로 세면 안 된다 — 실측 2026-08: 8월 탭 40건 중 **8월 접수는 26건**이고
 *   나머지 14건은 지난달 접수인데 8월 정산에 잡힌 것이다. 영업이 이번 달 판 것은 26건이다.
 *
 * ★분납 기간 = **회차 × 1개월**. 보증금 분납이라 회차 수가 곧 개월 수다
 *   (「인도일로부터 3개월이 지나면 3회차 분납은 완료」).
 * ★청구는 **인도 기준**이라 분납이어도 청구는 이미 나가 있다. 여기서 보는 건 «되돌릴 위험»뿐이다.
 *
 * ★원본은 **읽기만** 한다. 쓰기는 정산원장의 이 탭 하나뿐이다.
 *   원본은 개인 gmail 소유라 우리가 못 쓴다(실측 2026-08-25) — 그래서도 여기 만든다.
 *
 *   npx tsx scripts/publish-work-page.mts
 *   npx tsx scripts/publish-work-page.mts --apply
 *   npx tsx scripts/publish-work-page.mts --apply --month=2026-08
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const TAB = '작업';
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s|\n/g, '');
const key = (v: unknown) => S(v).replace(/\s/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const today = new Date(); today.setHours(0, 0, 0, 0);
const MONTH = arg('month', `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

const ymOf = (t: string) => { const m = /(\d{2})\s*\/\s*(\d{1,2})/.exec(t); return m ? { y: 2000 + Number(m[1]), m: Number(m[2]) } : null; };
const dateOf = (raw: string, tab: string): Date | null => {
  const t = ymOf(tab); if (!t) return null;
  const v = S(raw); const m = /^(\d{1,2})\s*[\/.]\s*(\d{1,2})$/.exec(v);
  if (!m) { const d = new Date(v); return Number.isNaN(+d) ? null : d; }
  const mm = Number(m[1]), dd = Number(m[2]);
  return new Date(mm > t.m + 1 ? t.y - 1 : t.y, mm - 1, dd);
};
const addM = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
const fmt = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');

// ── 원본 읽기
const meta = await api(`${SH}/${SRC}?fields=sheets.properties.title`);
const tabs = (meta.sheets || []).map((s: any) => S(s.properties.title)).filter((t: string) => ymOf(t));
type Row = { tab: string; ym: string; plate: string; state: string; pay: string; recv: Date | null; deliver: Date | null; supplier: string; channel: string; owner: string; cust: string; model: string; rent: string };
const rows: Row[] = [];
for (const tab of tabs) {
  let g: string[][];
  try { g = ((await api(`${SH}/${SRC}/values/${encodeURIComponent(`'${tab}'!A1:CZ1400`)}`)).values || []).map((r: any[]) => (r || []).map(S)); } catch { continue; }
  const hi = g.findIndex((r) => r.some((c) => norm(c) === '차량번호')); if (hi < 0) continue;
  const h = g[hi];
  const at = (...n: string[]) => { for (const x of n) { const i = h.findIndex((c) => norm(c) === norm(x)); if (i >= 0) return i; } return -1; };
  const c = { p: at('차량번호'), s: at('상태 표기', '상태'), pay: at('분납여부'), r: at('접수일'), d: at('인도일'), sup: at('업체명', '공급사'), ch: at('에이전시', '영업채널'), ow: at('영업자', '영업담당자'), cu: at('고객명'), mo: at('모델명'), re: at('렌탈료') };
  const t = ymOf(tab)!;
  for (const r of g.slice(hi + 1)) {
    const p = key(r[c.p]); if (!p) continue;
    rows.push({ tab, ym: `${t.y}-${String(t.m).padStart(2, '0')}`, plate: p, state: S(r[c.s]), pay: c.pay >= 0 ? S(r[c.pay]) : '',
      recv: c.r >= 0 ? dateOf(r[c.r], tab) : null, deliver: c.d >= 0 ? dateOf(r[c.d], tab) : null,
      supplier: c.sup >= 0 ? S(r[c.sup]) : '', channel: c.ch >= 0 ? S(r[c.ch]) : '', owner: c.ow >= 0 ? S(r[c.ow]) : '',
      cust: c.cu >= 0 ? S(r[c.cu]) : '', model: c.mo >= 0 ? S(r[c.mo]) : '', rent: c.re >= 0 ? S(r[c.re]) : '' });
  }
}

// ★환수·취소는 차번으로 본다 — 나중 달에 따로 선 줄이다.
const closed = new Set(rows.filter((r) => /환수|취소/.test(r.state)).map((r) => r.plate));

// ── ① 환수 감시
type W = { plate: string; cust: string; supplier: string; channel: string; rounds: number; deliver: Date; due: Date; left: number };
const watch = new Map<string, W>();
for (const r of rows) {
  const m = /(\d)회/.exec(r.pay); if (!m) continue;
  const rounds = Number(m[1]); if (rounds < 2) continue;
  if (closed.has(r.plate) || !r.deliver) continue;
  const due = addM(r.deliver, rounds);
  if (due < today) continue;                     // 지났고 환수 없음 = 이행됨. 뺀다
  const prev = watch.get(r.plate);
  if (!prev || r.deliver < prev.deliver) watch.set(r.plate, { plate: r.plate, cust: r.cust, supplier: r.supplier, channel: r.channel, rounds, deliver: r.deliver, due, left: Math.round((+due - +today) / 86_400_000) });
}
const 감시 = [...watch.values()].sort((a, b) => +a.due - +b.due);

// ── ② 당월 진행중 — 그 달 탭에서 아직 안 끝난 것
// ★탭이 아니라 **접수일**로 그 달을 가른다 — 탭에는 지난달 접수 건이 섞여 있다.
const inMonth = (d: Date | null) => !!d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === MONTH;
/** 같은 차가 여러 달 탭에 실린다 — 접수일이 그 달인 줄만, 차번 하나로 접는다. */
const 접수 = [...new Map(rows.filter((r) => inMonth(r.recv)).map((r) => [r.plate, r])).values()];
const 진행 = 접수.filter((r) => !/환수|취소/.test(r.state) && (!r.deliver || /계약중|진행/.test(r.state)))
  .sort((a, b) => (+(a.recv || 0)) - (+(b.recv || 0)));

/**
 * ★이번 달 실적 — **접수 기준**. 지난달들과 견주려면 **같은 날짜까지**로 잘라야 공정하다
 *   (오늘이 25일인데 지난달 30일치와 견주면 늘 «저조»하게 보인다).
 */
const N = (v: unknown) => { const x = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(x) ? x : 0; };
const cut = today.getDate();
const monthsOf = (ym: string) => {
  const got = [...new Map(rows.filter((r) => r.recv && `${r.recv.getFullYear()}-${String(r.recv.getMonth() + 1).padStart(2, '0')}` === ym && r.recv.getDate() <= cut).map((r) => [r.plate, r])).values()];
  return { n: got.length, rent: got.reduce((a, b) => a + N(b.rent), 0), done: got.filter((r) => /완료/.test(r.state)).length, prog: got.filter((r) => /진행|계약중/.test(r.state)).length };
};
const thisY = Number(MONTH.slice(0, 4));
const past = Array.from({ length: 12 }, (_, i) => `${thisY}-${String(i + 1).padStart(2, '0')}`).map((ym) => ({ ym, ...monthsOf(ym) })).filter((x) => x.n > 0);
const now = past.find((x) => x.ym === MONTH) || { ym: MONTH, n: 0, rent: 0, done: 0, prog: 0 };
const avg = past.length ? Math.round(past.reduce((a, b) => a + b.n, 0) / past.length * 10) / 10 : 0;
const best = past.reduce((a, b) => (b.n > a.n ? b : a), past[0] || now);

const mark = (n: number) => (n < 0 ? '🔴 지났다' : n <= 7 ? '🟡 이번주' : '🟢 지켜보는 중');
console.log(`\n■ 「${TAB}」 — 오늘 ${fmt(today)} · 기준달 ${MONTH} ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  ⓪ ${MONTH} 실적(접수 ${cut}일까지)  ${now.n}건 · 렌탈료 ${now.rent.toLocaleString()}원 · 완료 ${now.done} · 진행중 ${now.prog}`);
console.log(`     올해 평균 ${avg}건 · 최고 ${best.ym.slice(5)}월 ${best.n}건 — ${now.n >= avg ? '평균 이상' : '평균 아래'}`);
console.log(`  ① 환수 감시   ${감시.length}대   분납인데 아직 기간이 안 지난 것`);
console.log(`  ② 당월 진행중 ${진행.length}건   ${MONTH} 접수 중 아직 안 끝난 것\n`);
console.log('  ── ① 환수 감시');
for (const x of 감시) console.log(`     ${x.plate.padEnd(11)} ${x.rounds}회 · 인도 ${fmt(x.deliver)} → ${fmt(x.due)} (${String(x.left).padStart(3)}일) ${mark(x.left).padEnd(12)} ${x.supplier.slice(0, 8).padEnd(9)} ${x.channel.slice(0, 8).padEnd(9)} ${x.cust}`);
console.log('\n  ── ② 당월 진행중');
for (const x of 진행) console.log(`     ${x.plate.padEnd(11)} ${x.state.slice(0, 8).padEnd(10)} 접수 ${fmt(x.recv).padEnd(11)} 인도 ${(fmt(x.deliver) || '-').padEnd(11)} ${x.supplier.slice(0, 8).padEnd(9)} ${x.channel.slice(0, 8).padEnd(9)} ${x.cust}`);

const values: string[][] = [
  [`■ ${MONTH} 실적 — 접수 기준 ${cut}일까지`, '', '', '', '', '', '', '', ''],
  ['건수', String(now.n), '렌탈료', now.rent.toLocaleString(), '완료', String(now.done), '진행중', String(now.prog), now.n >= avg ? `올해 평균 ${avg}건 이상` : `올해 평균 ${avg}건 아래`],
  ['', '', '', '', '', '', '', '', ''],
  [`■ 환수 감시 — ${감시.length}대`, '', '', '', '', '', '', '', ''],
  ['차량번호', '고객명', '공급사', '영업채널', '분납', '인도일', '완료예정', '남은날', '봐야하나'],
  ...감시.map((x) => [x.plate, x.cust, x.supplier, x.channel, `${x.rounds}회`, fmt(x.deliver), fmt(x.due), String(x.left), mark(x.left)]),
  ['', '', '', '', '', '', '', '', ''],
  [`■ ${MONTH} 진행중 — ${진행.length}건`, '', '', '', '', '', '', '', ''],
  ['차량번호', '고객명', '공급사', '영업채널', '상태', '접수일', '인도일', '모델명', '렌탈료'],
  ...진행.map((x) => [x.plate, x.cust, x.supplier, x.channel, x.state, fmt(x.recv), fmt(x.deliver), x.model, x.rent]),
];
writeFileSync('tmp/work-page.json', JSON.stringify({ 감시, 진행 }, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 썼다.\n`); process.exit(0); }

const lmeta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
let sheetId = (lmeta.sheets || []).find((s: any) => S(s.properties.title) === TAB)?.properties?.sheetId;
if (sheetId === undefined) {
  const made = await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, index: 0, gridProperties: { rowCount: 400, columnCount: 12, frozenRowCount: 0 } } } }] }) });
  sheetId = made.replies[0].addSheet.properties.sheetId;
}
sheetId = Number(sheetId);
// ★통째로 지우고 다시 쓴다 — 줄이 줄면 옛 줄이 남는다.
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1:L400`)}:clear`, { method: 'POST', body: '{}' });
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });

const FONT = 'Noto Sans KR';
const headRows = [0, 3, 3 + 4 + 감시.length];
await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { repeatCell: { range: { sheetId }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat(fontFamily,fontSize)' } },
  ...headRows.map((r) => ({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 12, bold: true } } }, fields: 'userEnteredFormat.textFormat' } })),
  ...headRows.map((r) => ({ repeatCell: { range: { sheetId, startRowIndex: r + 1, endRowIndex: r + 2, endColumnIndex: 9 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } })),
  ...[120, 90, 100, 110, 70, 100, 100, 70, 120].map((w, i) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
] }) });

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = `\n## ${when} · 「${TAB}」 페이지 신설 — 지금 봐야 할 것만\n\n도구 \`scripts/publish-work-page.mts --apply\`\n① 환수 감시 ${감시.length}대 · ② ${MONTH} 진행중 ${진행.length}건.\n끝난 것은 안 싣는다 — 기간이 지나고 환수가 없으면 저절로 빠진다.\n원본(개인 gmail 소유)은 읽기만 했다.\n`;
const marker = '> 기계가 정산원장 구조를';
const logCut = head.indexOf(marker);
const at = cut >= 0 ? head.indexOf('\n', cut) + 1 : head.length;
writeFileSync(LOG, head.slice(0, at) + body + head.slice(at));

console.log(`\n■ 끝 — 환수감시 ${감시.length} · 진행중 ${진행.length}`);
console.log(`   https://docs.google.com/spreadsheets/d/${LEDGER}/edit#gid=${sheetId}\n`);
