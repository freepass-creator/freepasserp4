/**
 * **원본 「프리패스모빌리티계약현황」 40탭의 열이 서로 얼마나 다른가(읽기 전용).**
 *
 * ★사장님 2026-08-25 「원본을 이제 백업으로 갖고 있고 그 데이터를 다 갖고와서 데이터화해야하는거고」.
 *   옮기기 전에 **열이 탭마다 어떻게 다른지**를 먼저 안다. 자리로 옮기면 한 칸 밀린 값이 돈이 된다.
 *
 * ★실측 2026-08-25 — 탭마다 51~57열. 늘어난 열이 뒤에 붙었는지 가운데 끼었는지 봐야 한다.
 * ★머리행이 3행에 있는 탭이 있다(1~2행은 요약·구간 이름). 「차량번호」가 있는 행을 머리행으로 본다.
 *
 *   npx tsx scripts/audit-source-columns.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s|\n/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (u: string): Promise<any> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 150)}`);
  }
};

const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}?fields=sheets.properties(title,index)`);
const tabs = (meta.sheets || []).map((s: any) => S(s.properties.title));

type Sheet = { tab: string; headRow: number; cols: string[]; rows: number };
const sheets: Sheet[] = [];
for (const tab of tabs) {
  let g: string[][];
  try { g = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}/values/${encodeURIComponent(`'${tab}'!A1:CZ1400`)}`)).values || []).map((r: any[]) => (r || []).map(S)); } catch { continue; }
  const hi = g.findIndex((r) => r.some((c) => norm(c) === '차량번호'));
  if (hi < 0) { console.log(`   · ${tab.padEnd(16)} 「차량번호」 없음 — 데이터 탭이 아니다`); continue; }
  const cols = g[hi].map((c) => S(c).replace(/\n/g, ' '));
  const ip = cols.findIndex((c) => norm(c) === '차량번호');
  sheets.push({ tab, headRow: hi + 1, cols, rows: g.slice(hi + 1).filter((r) => S(r[ip])).length });
}

console.log(`\n■ 데이터 탭 ${sheets.length}개 · 줄 합계 ${sheets.reduce((n, s) => n + s.rows, 0)}\n`);

// ── 열 이름이 몇 곳에 나오나
const seen = new Map<string, { n: number; at: Set<number> }>();
for (const s of sheets) s.cols.forEach((c, i) => { if (!c) return; const k = norm(c); const x = seen.get(k) || { n: 0, at: new Set<number>() }; x.n++; x.at.add(i); seen.set(k, x); });

const all = sheets.length;
const 공통 = [...seen].filter(([, x]) => x.n === all);
const 일부 = [...seen].filter(([, x]) => x.n < all).sort((a, b) => b[1].n - a[1].n);
const 자리흔들 = [...seen].filter(([, x]) => x.at.size > 1);

console.log(`  모든 탭에 있는 열 ${공통.length} · 일부에만 ${일부.length} · **자리가 흔들리는 열 ${자리흔들.length}**\n`);
console.log('  ── 일부 탭에만 있는 열 (몇 탭에 있나)');
for (const [k, x] of 일부.slice(0, 20)) console.log(`     ${String(x.n).padStart(3)}/${all}  ${k}`);
if (일부.length > 20) console.log(`     … 외 ${일부.length - 20}`);

console.log('\n  ── ★자리가 흔들리는 열 — 자리로 읽으면 안 되는 증거');
for (const [k, x] of 자리흔들.slice(0, 15)) console.log(`     ${k.padEnd(24)} ${[...x.at].sort((a, b) => a - b).map((i) => i + 1).join(' · ')}번째`);
if (자리흔들.length > 15) console.log(`     … 외 ${자리흔들.length - 15}`);

console.log('\n  ── 탭별 열 수·머리행');
const byShape = new Map<string, string[]>();
for (const s of sheets) { const k = `${s.cols.filter(Boolean).length}열 · 머리${s.headRow}행`; byShape.set(k, [...(byShape.get(k) || []), s.tab]); }
for (const [k, v] of [...byShape].sort((a, b) => b[1].length - a[1].length)) console.log(`     ${k.padEnd(18)} ${v.length}탭  ${v.slice(0, 6).join(' · ')}${v.length > 6 ? ' …' : ''}`);

writeFileSync('tmp/source-columns.json', JSON.stringify({ sheets, 공통: 공통.map(([k]) => k), 일부: 일부.map(([k, x]) => ({ 열: k, 탭수: x.n })) }, null, 2));
console.log(`\n  목록 tmp/source-columns.json\n`);
