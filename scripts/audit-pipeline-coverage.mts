/**
 * **한 대도 안 새는가 — 공급사 시트의 차가 판매시트 어디에 있는지 전수로 짚는다.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-14 — 「공급사시트가 판매시트에 잘 연동되는지 검수」)
 *   돈 대조는 «양쪽에 다 있는 차»만 견준다. 그래서 **애초에 안 실린 차는 100% 안에 안 잡힌다.**
 *   실측 2026-08-14: 돈은 376/376 100% 인데 공급사시트에만 있는 차가 78대였다.
 *   그 78대가 «일부러 뺀 것»인지 «조용히 사라진 것»인지는 아무도 안 세고 있었다.
 *
 * ★그래서 이 검수는 **차마다 이유를 댄다.** 안 실렸으면 왜 안 실렸는지가 있어야 한다.
 *   이유를 못 대는 차가 곧 «진짜 구멍»이다.
 *
 * ★**별도 탭으로 갔다면 거기 실제로 있는지 확인한다.** @제외는 「여기 말고 저기 싣는다」는
 *   뜻이지 「안 싣는다」가 아니다. 저기에도 없으면 그건 사라진 것이다 — 여기가 제일 중요하다.
 *
 * ⚠ 읽는 법은 발행기와 **같아야** 한다(`readSupplierSheet`). 다르게 읽으면 없는 구멍이 생기거나
 *   있는 구멍이 가려진다 — 숨긴 탭·숨긴 행이 정확히 그 자리다.
 *
 *   npx tsx scripts/audit-pipeline-coverage.mts
 *   npx tsx scripts/audit-pipeline-coverage.mts --list     못 실린 차를 전부 찍는다
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { companyAlias } from '../lib/domain/identity';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const LIST = process.argv.includes('--list');
const SALES = arg('sales', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const INDEX_SHEET = arg('index', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');
/** 판매시트에서 «차를 담는» 탭들. 상품리스트 말고도 별도 탭이 있다. */
const STOCK_TABS = /^(상품리스트|손오공구독|오플구독|오플프로모션)/;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));

/** ── 판매시트: 탭마다 어떤 차가 실려 있나 */
const inSales = new Map<string, string>();   // 차번 → 실린 탭
{
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}?fields=${encodeURIComponent('sheets.properties(title)')}`);
  const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter((t) => STOCK_TABS.test(t));
  for (const t of titles) {
    const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}/values/${encodeURIComponent(a1Tab(t))}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]);
    const h = rows.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (h < 0) continue;
    const pi = (rows[h] || []).findIndex((c) => S(c) === '차량번호');
    for (const r of rows.slice(h + 1)) { const p = plate(r[pi]); if (p && !inSales.has(p)) inSales.set(p, t.split(' ')[0]); }
  }
  console.log(`\n■ 한 대도 안 새는가 — 공급사 시트 ↔ 판매시트 전수 대조\n`);
  console.log(`  판매시트 재고 탭 ${titles.length}장 · 실린 차 ${inSales.size}대`);
}

/** ── 판매시트 「AI 인계」 @제외 규칙 — 발행기가 쓰는 것과 같은 표를 읽는다. */
const EXCLUDE: { code: string; tab: string }[] = [];
try {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}/values/${encodeURIComponent("'AI 인계'!A1:C400")}`) as { values?: string[][] };
  const rows = (v.values || []) as string[][];
  const from = rows.findIndex((r) => S(r[0]) === '@제외');
  if (from >= 0) {
    for (const r of rows.slice(from + 1)) {
      if (S(r[0]).startsWith('@')) break;
      const rule = S(r[1]) || S(r[0]);
      if (!rule) continue;
      const [code, tab] = rule.split(':').map(S);
      if (code) EXCLUDE.push({ code, tab: tab || '' });
    }
  }
} catch { /* 못 읽어도 나머지는 센다 */ }
const excluded = (code: string, tab: string) => EXCLUDE.some((x) => x.code === code && (!x.tab || S(tab).includes(x.tab)));
console.log(`  @제외 규칙 ${EXCLUDE.length}줄`);

/** ── 문패 */
const hub: { name: string; code: string; id: string }[] = [];
{
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${INDEX_SHEET}/values/A1:Z300`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const id = (S(r[2]).match(/\/d\/([\w-]+)/) || [])[1];
    if (!id || !S(r[1])) continue;
    hub.push({ name: companyAlias(S(r[0])) || S(r[0]), code: S(r[1]), id });
  }
}

type Miss = { who: string; ours: boolean; plate: string; tab: string; why: string };
const misses: Miss[] = [];
let sheetCars = 0, landed = 0;
const rows: { who: string; ours: boolean; sheet: number; landed: number; other: number; miss: number }[] = [];

for (const h of hub) {
  if (NOT_SHEET_BACKED.has(h.code)) continue;
  let grid: Rec;
  try { grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${h.id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`); }
  catch (e) { console.log(`  ✗ ${h.name}(${h.code}) — 시트를 못 읽었다: ${String((e as Error).message).slice(0, 40)}`); continue; }
  /** 「프리패스」가 든 문서 이름이면 우리 시트다 — 대수는 늘 우리/아닌 것으로 가른다. */
  const ours = /프리패스/.test(S((grid as Rec).properties?.title));
  const read = readSupplierSheet(grid as never, { partner_code: h.code, partner_name: h.name } as EntityRecord);
  let n = 0, ok = 0, elsewhere = 0, gap = 0;
  const seen = new Set<string>();
  for (const t of read.tabs) {
    if (isOurNonInventoryTab(S(t.title))) continue;
    const hdr = (t.table[0] || []).map(S);
    const pi = hdr.findIndex((c) => c === '차량번호' || c === '차번');
    if (pi < 0) continue;
    const isExcluded = excluded(h.code, S(t.title));
    for (const r of t.table.slice(1)) {
      const p = plate(r[pi]);
      if (!p) continue;
      n++;
      /**
       * ⚠ **같은 차가 한 시트에 두 번 나오는 것은 «못 실린 차»가 아니다.**
       *   발행기도 먼저 나온 쪽만 싣는다. 이걸 구멍으로 세면 숫자가 부풀어
       *   진짜 구멍이 안 보인다.
       */
      if (seen.has(p)) continue;
      seen.add(p);
      const at = inSales.get(p);
      if (at === '상품리스트') { ok++; continue; }
      if (at) {
        /** 별도 탭에 실렸다 — @제외의 «여기 말고 저기»가 지켜진 것이다. */
        elsewhere++; continue;
      }
      /**
       * 어디에도 없다. 이유를 댈 수 있으면 이유를, 못 대면 «구멍»이다.
       * ★@제외 탭인데 별도 탭에도 없으면 그게 **제일 나쁜 경우**다 —
       *   「저기 싣는다」고 해 놓고 아무 데도 안 실린 것이다.
       */
      gap++;
      misses.push({ who: h.name, ours, plate: p, tab: S(t.title),
        why: isExcluded ? '★@제외 탭인데 별도 탭에도 없다' : '이유 없음' });
    }
  }
  sheetCars += n; landed += ok;
  rows.push({ who: h.name, ours, sheet: seen.size, landed: ok, other: elsewhere, miss: gap });
}

console.log(`\n  ${pad('공급사', 14)}${pad('시트', 7)}${pad('상품리스트', 12)}${pad('별도탭', 8)}못 실림`);
console.log(`  ${'─'.repeat(56)}`);
for (const r of rows.sort((a, b) => b.miss - a.miss || b.sheet - a.sheet)) {
  console.log(`  ${pad(r.who + (r.ours ? '' : ' *'), 14)}${pad(`${r.sheet}대`, 7)}${pad(`${r.landed}대`, 12)}${pad(r.other ? `${r.other}대` : '-', 8)}${r.miss ? `${r.miss}대` : '-'}`);
}
const sum = (f: (x: typeof rows[0]) => number) => rows.reduce((a, x) => a + f(x), 0);
const oursRows = rows.filter((r) => r.ours), otherRows = rows.filter((r) => !r.ours);
const cnt = (rs: typeof rows, f: (x: typeof rows[0]) => number) => rs.reduce((a, x) => a + f(x), 0);
console.log(`  ${'─'.repeat(56)}`);
console.log(`  우리 시트 ${cnt(oursRows, (x) => x.sheet)}대 · 아닌 시트 ${cnt(otherRows, (x) => x.sheet)}대 · 총 ${sum((x) => x.sheet)}대   (* = 우리 시트 아님)`);
console.log(`  그중 상품리스트 ${sum((x) => x.landed)}대 · 별도 탭 ${sum((x) => x.other)}대 · **못 실림 ${sum((x) => x.miss)}대**`);

const bad = misses.filter((m) => m.why.startsWith('★'));
if (bad.length) {
  console.log(`\n  ⛔ **저기 싣는다고 해 놓고 아무 데도 없는 차 ${bad.length}대** — 이게 «조용히 사라진 차»다`);
  for (const m of bad.slice(0, 20)) console.log(`     ${m.who} ${m.plate} 「${m.tab}」`);
  if (bad.length > 20) console.log(`     … 그 밖 ${bad.length - 20}대`);
}
const plainMiss = misses.filter((m) => !m.why.startsWith('★'));
if (plainMiss.length) {
  const byWho = new Map<string, Miss[]>();
  for (const m of plainMiss) byWho.set(m.who, [...(byWho.get(m.who) || []), m]);
  console.log(`\n  ▲ 이유를 못 대는 차 ${plainMiss.length}대`);
  for (const [who, ms] of [...byWho].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     ${pad(who, 12)}${ms.length}대  ${(LIST ? ms : ms.slice(0, 5)).map((m) => m.plate).join(' ')}${!LIST && ms.length > 5 ? ' …' : ''}`);
  }
  if (!LIST) console.log(`     (전부 보려면 --list)`);
}
if (!misses.length) console.log(`\n  ✓ 공급사 시트의 차가 한 대도 안 샜다.`);
console.log('');
