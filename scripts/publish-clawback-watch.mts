/**
 * **「환수감시」 탭 — 아직 환수가 터질 수 있는 건만 보여 준다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25
 *   「분납완료는 계약 시작하고 그 기간 지나서 환수 없으면 완료 된 거야」
 *   「환수가 없으면 제대로 이행했다는거니까 따로 적을 필요는 없기는 하거든 · 환수대상인지만 파악하는거지」
 *
 * ★그래서 **완료를 적지 않는다.** 기간이 지나고 환수가 없으면 이 표에서 **저절로 빠진다.**
 *   분납 관리 탭도, 회차별 입금일도 필요 없다 — 공급사에 물어볼 것도 없다.
 *   실측 2026-08-25: 분납 528대 중 **지금 봐야 할 건 17대**뿐이다(완료 428·환수 46·취소 33·인도전 4).
 *
 * ★판정 — 원본 월별 탭에서 계산한다.
 *   · 그 차에 「환수」 줄이 있으면            → 표에서 뺀다(이미 터졌다. 청구 시트가 받는다)
 *   · 인도일 + **회차×1개월** 이 안 지났으면      → **감시**
 *   · 지났으면                              → 표에서 뺀다(이행됐다)
 *
 * ★쓰기는 이 탭 하나뿐이다. **월별 탭은 건드리지 않는다.**
 *
 *   npx tsx scripts/publish-clawback-watch.mts
 *   npx tsx scripts/publish-clawback-watch.mts --apply
 *   npx tsx scripts/publish-clawback-watch.mts --apply --gap=2
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const TAB = '환수감시';
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => S(v).replace(/\s/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const GAP = Number(arg('gap', '1')) || 1;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const COLS = ['차량번호', '고객명', '공급사', '영업채널', '영업담당자', '분납', '인도일', '완료예정', '남은날', '봐야하나'] as const;

const GUIDE: [string, string][] = [
  ['■ 이 표는 무엇인가', ''],
  ['', '분납 건 중 **아직 환수가 터질 수 있는 것**만 있습니다.'],
  ['', '기간이 지나고 환수가 없으면 이 표에서 **저절로 사라집니다** — 완료를 따로 적지 않습니다.'],
  ['', ''],
  ['■ 왜 이것만 보면 되나', ''],
  ['', '환수가 없다 = 제대로 이행했다. 그래서 «끝난 것»은 볼 이유가 없습니다.'],
  ['', '봐야 할 것은 «아직 안 끝난 것»뿐입니다.'],
  ['', ''],
  ['■ 봐야하나 칸', ''],
  ['🔴 지났다', '완료예정일이 지났는데 아직 여기 있습니다 — 환수인지 확인해 주세요'],
  ['🟡 이번주', '7일 안에 끝납니다'],
  ['🟢 지켜보는 중', '아직 기간이 남았습니다'],
  ['', ''],
  ['■ 환수가 터지면', ''],
  ['', '청구 시트에 **환수 줄을 새로 세웁니다.** 이미 나간 청구 줄은 고치지 않습니다.'],
  ['', '계산서가 이미 나갔기 때문에, 청구와 환수가 둘 다 남아야 합니다.'],
  ['', ''],
  ['■ 이 표는 기계가 다시 그립니다', ''],
  ['', '손으로 고치지 마세요 — 다음 갱신에 사라집니다. 고칠 것은 월별 탭에서.'],
];

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
/** 「12/3」처럼 연도가 없다 — 그 줄이 실린 **탭의 연월**로 연도를 정한다. */
const dateOf = (raw: string, tab: string): Date | null => {
  const t = ymOf(tab); if (!t) return null;
  const m = /^(\d{1,2})\s*[\/.]\s*(\d{1,2})$/.exec(S(raw));
  if (!m) { const d = new Date(S(raw)); return Number.isNaN(+d) ? null : d; }
  const mm = Number(m[1]), dd = Number(m[2]);
  return new Date(mm > t.m + 1 ? t.y - 1 : t.y, mm - 1, dd);
};
const addM = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const meta = await api(`${SH}/${SRC}?fields=sheets.properties(sheetId,title,index)`);
const tabs = (meta.sheets || []).map((s: any) => S(s.properties.title)).filter((t: string) => ymOf(t));

type Row = { tab: string; plate: string; state: string; pay: string; deliver: Date | null; supplier: string; channel: string; owner: string; cust: string };
const rows: Row[] = [];
for (const tab of tabs) {
  let g: string[][];
  try { g = ((await api(`${SH}/${SRC}/values/${encodeURIComponent(`'${tab}'!A1:BZ1400`)}`)).values || []).map((r: any[]) => (r || []).map(S)); } catch { continue; }
  const hi = g.findIndex((r) => r.includes('차량번호')); if (hi < 0) continue;
  const h = g[hi];
  const at = (...n: string[]) => { for (const x of n) { const i = h.findIndex((c) => c.replace(/\n/g, ' ').trim() === x); if (i >= 0) return i; } return -1; };
  const [ip, is, ipay, id, isup, ich, iow, icu] = ['차량번호', '상태 표기', '분납여부', '인도일', '업체명', '에이전시', '영업자', '고객명'].map((n) => at(n));
  for (const r of g.slice(hi + 1)) {
    const p = key(r[ip]); if (!p) continue;
    rows.push({ tab, plate: p, state: S(r[is]), pay: ipay >= 0 ? S(r[ipay]) : '', deliver: id >= 0 ? dateOf(r[id], tab) : null,
      supplier: isup >= 0 ? S(r[isup]) : '', channel: ich >= 0 ? S(r[ich]) : '', owner: iow >= 0 ? S(r[iow]) : '', cust: icu >= 0 ? S(r[icu]) : '' });
  }
}

// ★환수·취소는 **차번으로** 본다 — 나중 달 탭에 따로 선 줄이라 같은 줄이 안 바뀐다.
const done = new Set(rows.filter((r) => /환수|취소/.test(r.state)).map((r) => r.plate));
const today = new Date(); today.setHours(0, 0, 0, 0);

type Watch = { plate: string; cust: string; supplier: string; channel: string; owner: string; rounds: number; deliver: Date; due: Date; left: number };
const byPlate = new Map<string, Watch>();
for (const r of rows) {
  const m = /(\d)회/.exec(r.pay); if (!m) continue;
  const rounds = Number(m[1]); if (rounds < 2) continue;
  if (done.has(r.plate)) continue;             // 이미 터졌거나 취소됐다 — 감시할 게 없다
  if (!r.deliver) continue;                    // 아직 시작도 안 했다
  const due = addM(r.deliver, rounds * GAP);
  if (due < today) continue;                   // 지났고 환수가 없다 = 이행됐다. 표에서 뺀다
  const left = Math.round((+due - +today) / 86_400_000);
  const prev = byPlate.get(r.plate);
  if (!prev || r.deliver < prev.deliver) byPlate.set(r.plate, { plate: r.plate, cust: r.cust, supplier: r.supplier, channel: r.channel, owner: r.owner, rounds, deliver: r.deliver, due, left });
}
const list = [...byPlate.values()].sort((a, b) => +a.due - +b.due);

const mark = (n: number) => (n < 0 ? '🔴 지났다' : n <= 7 ? '🟡 이번주' : '🟢 지켜보는 중');
console.log(`\n■ 「${TAB}」 — 분납 ${rows.filter((r) => /\d회/.test(r.pay)).length}줄에서 **봐야 할 ${list.length}대** (회차 간격 ${GAP}개월 · 오늘 ${fmt(today)}) ${APPLY ? '' : '(dry-run)'}\n`);
for (const x of list) console.log(`   ${x.plate.padEnd(11)} ${x.rounds}회 · 인도 ${fmt(x.deliver)} → ${fmt(x.due)} (${x.left}일) ${mark(x.left).padEnd(12)} ${x.supplier.slice(0, 8).padEnd(9)} ${x.channel.slice(0, 8).padEnd(9)} ${x.cust}`);

const values = [[...COLS], ...list.map((x) => [x.plate, x.cust, x.supplier, x.channel, x.owner, `${x.rounds}회분납`, fmt(x.deliver), fmt(x.due), String(x.left), mark(x.left)])];
writeFileSync('tmp/clawback-watch.json', JSON.stringify(list, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 썼다. 반영은 --apply\n`); process.exit(0); }

let sheetId = (meta.sheets || []).find((s: any) => S(s.properties.title) === TAB)?.properties?.sheetId;
if (sheetId === undefined) {
  const made = await api(`${SH}/${SRC}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
    addSheet: { properties: { title: TAB, index: 0, gridProperties: { rowCount: 300, columnCount: COLS.length + 3, frozenRowCount: 1 } } },
  }] }) });
  sheetId = made.replies[0].addSheet.properties.sheetId;
}
sheetId = Number(sheetId);
// ★통째로 지우고 다시 쓴다 — 줄이 줄면 옛 줄이 남는다.
await api(`${SH}/${SRC}/values/${encodeURIComponent(`'${TAB}'!A1:J300`)}:clear`, { method: 'POST', body: '{}' });
await api(`${SH}/${SRC}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });
await api(`${SH}/${SRC}/values/${encodeURIComponent(`'${TAB}'!L1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: GUIDE.map(([k, v]) => [k, v]) }) });

const FONT = 'Noto Sans KR';
await api(`${SH}/${SRC}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { repeatCell: { range: { sheetId }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat(fontFamily,fontSize)' } },
  { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, endColumnIndex: COLS.length }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.99, green: 0.93, blue: 0.90 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
  { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: GUIDE.length, startColumnIndex: 11, endColumnIndex: 12 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  ...[130, 90, 100, 110, 90, 90, 100, 100, 70, 120].map((w, i) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
  { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
  { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
  { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 }, properties: { pixelSize: 520 }, fields: 'pixelSize' } },
  { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: COLS.length } } } },
] }) });

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = `\n## ${when} · 원본 시트에 「${TAB}」 탭 신설\n\n도구 \`scripts/publish-clawback-watch.mts --apply\`\n분납 ${rows.filter((r) => /\\d회/.test(r.pay)).length}줄에서 **봐야 할 ${list.length}대**만 남겼다. 완료는 안 적는다 — 기간이 지나고 환수가 없으면 저절로 빠진다.\n월별 탭은 안 건드렸다. 이 탭만 통째로 다시 그린다.\n`;
const marker = '> 기계가 정산원장 구조를';
const cut = head.indexOf(marker);
const at = cut >= 0 ? head.indexOf('\n', cut) + 1 : head.length;
writeFileSync(LOG, head.slice(0, at) + body + head.slice(at));

console.log(`\n■ 끝 — 「${TAB}」 ${list.length}줄. 이력 ${LOG}`);
console.log(`   https://docs.google.com/spreadsheets/d/${SRC}/edit#gid=${sheetId}\n`);
