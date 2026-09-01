/**
 * **`mark-contract-in-listings` 가 세운 상태를 원래 값으로 되돌린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「1266은 계약중이 아니고 · 정산시트랑 뭘 대조해서 반영한거지??」 —
 *   내가 **기존실적(지난 계약 1,661줄)까지 현재 상태로 읽었다.** 그게 틀렸다.
 *
 * ★무엇이 틀렸나 — 기존실적은 **정산월마다 쌓이는 이력**이다. 같은 차가 여러 줄이다.
 *   실측: 109호4100 이 여섯 줄(45778 계약서업로드 … 45901 계약 완료 … 46204 계약 불가(취소)).
 *   **마지막 줄이 지금 상태**인데 나는 「센 말이 이긴다」로 뭉쳐서
 *   **과거의 «계약 완료»가 최근의 «환수»·«계약 불가»를 이기게** 만들었다.
 *   그래서 다시 팔 수 있는 차(환수·취소)를 **출고불가로 잠갔다.**
 *   렌터카는 환수 뒤 재렌트가 본업이다(원장 재렌트 717건) — 이건 드문 일이 아니라 흔한 일이다.
 *
 * ★되돌리는 값은 `tmp/mark-contract-*.json` 의 **제일 이른 `from`** 이다.
 *   두 번 고친 칸이 있어 나중 백업의 from 은 이미 내가 바꾼 값이다.
 *
 *   npx tsx scripts/undo-mark-contract.mts
 *   npx tsx scripts/undo-mark-contract.mts --apply
 */
import { readFileSync, readdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
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

// ── 제일 이른 from 을 모은다(파일 이름이 곧 시각이라 오름차순이 시간순)
type Back = { where: string; tab: string; row: number; plate: string; back: string };
const first = new Map<string, Back>();
for (const f of readdirSync('tmp').filter((x) => /^mark-contract-.*\.json$/.test(x)).sort()) {
  for (const e of (JSON.parse(readFileSync(`tmp/${f}`, 'utf8')).edits || [])) {
    const k = `${e.where}|${e.tab}|${e.row}`;
    if (first.has(k)) continue;   // 먼저 본 것이 원래 값이다
    first.set(k, { where: S(e.where), tab: S(e.tab), row: Number(e.row), plate: S(e.plate), back: S(e.from) === '(빈칸)' ? '' : S(e.from) });
  }
}

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = ((await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || [])
  .map((f: any) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) }));
const idOf = (label: string) => books.find((b: any) => b.label === label)?.id || '';

console.log(`\n■ 되돌릴 칸 ${first.size} — ${APPLY ? '반영' : 'dry-run'}\n`);
type Job = { id: string; tab: string; col: string; rows: { row: number; back: string; plate: string }[] };
const jobs = new Map<string, Job>();
for (const b of first.values()) {
  const id = b.where === '상품리스트' ? SALES_SHEET_ID : idOf(b.where.replace(/^공급사 /, ''));
  if (!id) { console.log(`   ⚠ ${b.where} 시트를 못 찾음 — ${b.plate}`); continue; }
  const col = b.where === '상품리스트' ? '배차상태' : '상태';
  const k = `${id}|${b.tab}|${col}`;
  const j = jobs.get(k) || { id, tab: b.tab, col, rows: [] };
  j.rows.push({ row: b.row, back: b.back, plate: b.plate });
  jobs.set(k, j);
  console.log(`   ${b.where.slice(0, 16).padEnd(18)} 「${b.tab.slice(0, 12).padEnd(13)}」 ${b.plate.padEnd(10)} → ${b.back || '(빈칸)'}`);
}
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 되돌렸다. 반영은 --apply\n'); process.exit(0); }

let done = 0;
for (const j of jobs.values()) {
  // ★열 자리는 지금 머리행에서 다시 찾는다 — 백업에 적힌 자리를 믿지 않는다(그 사이 열이 늘 수 있다).
  /**
   * ★탭 이름은 **앞부분으로** 찾는다 — 판매시트 탭 이름에 시각·대수가 붙어 매 발행마다 바뀐다
   *   (「손오공구독 08.25 09:28 · 42대」). 백업에 적힌 이름을 그대로 쓰면 못 찾는다(실측 2026-08-25).
   */
  const meta = await api(`${SH}/${j.id}?fields=sheets.properties.title`);
  const head = j.tab.split(/[ ·]/)[0];
  const live = ((meta.sheets || []) as any[]).map((x) => S(x.properties.title)).find((t) => t === j.tab)
    || ((meta.sheets || []) as any[]).map((x) => S(x.properties.title)).find((t) => t.startsWith(head));
  if (!live) { console.log(`   ⚠ 「${j.tab}」 탭을 못 찾음 — 건너뜀`); continue; }
  j.tab = live;
  const g = await api(`${SH}/${j.id}/values/${encodeURIComponent(`${a1(j.tab)}!A1:CZ2000`)}`);
  const rows = ((g?.values || []) as string[][]).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  const h = rows[hi] || [];
  const ic = h.indexOf(j.col);
  const ip = h.indexOf('차량번호');
  if (ic < 0) { console.log(`   ⚠ 「${j.tab}」에 ${j.col} 열이 없다 — 건너뜀`); continue; }
  const data: { range: string; values: string[][] }[] = [];
  for (const r of j.rows) {
    // ★그 줄이 정말 그 차인지 확인하고 쓴다 — 줄이 밀렸으면 남의 차를 고친다.
    const at = rows[r.row - 1];
    if (!at || S(at[ip]).replace(/\s/g, '') !== r.plate) { console.log(`   ⚠ 「${j.tab}」 ${r.row}행이 ${r.plate} 가 아니다 — 건너뜀`); continue; }
    data.push({ range: `${a1(j.tab)}!${colA1(ic)}${r.row}`, values: [[r.back]] });
  }
  if (data.length) { await api(`${SH}/${j.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) }); done += data.length; }
}
console.log(`\n■ 되돌렸다 — ${done}칸\n`);
