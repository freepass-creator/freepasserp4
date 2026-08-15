/**
 * **정제시트 한 장을 만든다 — 공급사가 탭이다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-15 — 「정제시트 하나 만들자. 공급사를 탭렬로 두는거야」)
 *   정제칸이 공급사 문서 21개에 흩어져 있다. 한 대를 고치려면 어느 문서인지 찾아 열어야 하고,
 *   전체가 얼마나 됐는지는 아무 데서도 안 보인다.
 *   **한 장에 모아 탭으로 가르면** 그 자리에서 다 보이고, 옆 탭과 견주며 판단할 수 있다.
 *
 * ★**이 시트가 정제의 정본이다.** 흐름은 이렇게 갈린다 —
 *     공급사 제공시트  공급사가 만진다. 상태·대여료가 여기서 온다(live)
 *     정제시트(여기)   우리가 만진다. 차번 → 차종코드와 차종 값이 여기서 온다(ours)
 *   만지는 사람이 갈리면 서로 덮을 일이 없다. 그게 이 구조의 값어치다.
 *
 * ★한 탭의 생김새 — 왼쪽은 **공급사가 쓴 글자**(판단 근거), 오른쪽은 **우리가 정한 값**.
 *   가운데 세로줄로 갈라 눈으로도 구분되게 한다.
 *
 * ⚠ **이미 박아 둔 코드와 정제값을 가져온다.** 빈 시트로 만들면 오늘 한 일이 날아간다.
 * ⚠ 차번이 열쇠다. 같은 차가 두 줄이면 안 된다 — 탭 안에서 중복은 걸러 낸다.
 *
 *   npx tsx scripts/build-refine-sheet.mts
 *   npx tsx scripts/build-refine-sheet.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { companyAlias } from '../lib/domain/identity';
import { AI_TAIL_COLUMNS, TEMPLATE_COLUMNS } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const DOC_NAME = arg('name', '프리패스 재고');
const TITLE = arg('title', '프리패스 차량정제');
/** 이미 만들어 둔 정제시트가 있으면 그 ID. 없으면 새로 만든다. */
const SHEET_ID = arg('sheet');

/**
 * ★**한 탭의 규격 = 제공시트 규격 그대로 + 「공급사」 한 칸.**
 *   (사장님 2026-08-15 — 「거기에 정제된 시트로 공급사별 다 통일해서 1차 변환해놓고
 *    그거를 판매시트가 댕겨가는거지」)
 *
 *   그래서 **판매시트는 이 문서 하나만 당겨가면 된다.** 지금은 발행기가 공급사 18곳 ×
 *   여러 탭을 훑느라 429 를 맞고, 곳마다 열 이름이 달라 별칭 표를 유지해야 한다.
 *   여기서 규격이 이미 하나면 그 둘이 통째로 사라진다.
 *
 * ⚠ 규격을 **여기서 새로 정의하지 마라.** `TEMPLATE_COLUMNS` 를 그대로 쓴다 —
 *   따로 적으면 제공시트와 갈리고, 갈리는 순간 «어느 쪽이 규격인지» 아무도 모른다.
 */
const TEMPLATE = TEMPLATE_COLUMNS.map((c) => c.name);
/** 왼쪽 — 공급사가 만지는 값(상태·대여료)과 처음 한 번 옮겨 온 원문. */
const RAW_COLUMNS = ['공급사', ...TEMPLATE];
/** 오른쪽 — 우리가 정하는 값. 맨 앞 「차종코드」가 정본이고 나머지는 거기서 나온다. */
const OUR_COLUMNS = AI_TAIL_COLUMNS.map((c) => c.name);
const COLUMNS = [...RAW_COLUMNS, ...OUR_COLUMNS];
/** 갈라 보이게 할 자리 — 여기부터 우리 것이다. */
const SPLIT_AT = RAW_COLUMNS.length;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));

/** ── 제공시트에서 차를 모은다. 원문과 «이미 박은 정제값»을 함께 가져온다. */
const files = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);

type Row = Record<string, string>;
const byWho = new Map<string, Row[]>();
let cars = 0, withCode = 0;

for (const f of ((files.files || []) as Rec[])) {
  const id = S(f.id);
  const who = companyAlias(S(f.name).replace(DOC_NAME, '').trim()) || S(f.name).replace(DOC_NAME, '').trim();
  let meta: Rec;
  try { meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets.properties(title)')}`); } catch { continue; }
  const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter(Boolean);
  if (!titles.length) continue;
  let got: Rec;
  try { got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${titles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&')}&majorDimension=ROWS`); } catch { continue; }

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const vr of ((got.valueRanges || []) as Rec[])) {
    const grid = ((vr.values || []) as string[][]);
    const h = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (h < 0) continue;
    const hdr = (grid[h] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((x, i) => { if (x && !at.has(x)) at.set(x, i); });
    if (!at.has('차량번호')) continue;
    for (const r of grid.slice(h + 1)) {
      const p = plate(r[at.get('차량번호')!]);
      if (!p || seen.has(p)) continue;      // ⚠ 같은 차가 두 줄이면 안 된다
      seen.add(p);
      const o: Row = { 차량번호: p, 공급사: who };
      for (const c of COLUMNS) {
        if (c === '차량번호' || c === '공급사') continue;
        const i = at.get(c);
        o[c] = i === undefined ? '' : S(r[i]);
      }
      rows.push(o);
      cars++;
      if (o['차종코드']) withCode++;
    }
  }
  if (rows.length) byWho.set(who, rows.sort((a, b) => a['차량번호'].localeCompare(b['차량번호'], 'ko')));
}

const whos = [...byWho.keys()].sort((a, b) => (byWho.get(b)!.length - byWho.get(a)!.length) || a.localeCompare(b, 'ko'));
console.log(`\n■ 정제시트 만들기 ${APPLY ? '(반영)' : '(dry-run — 아직 안 만든다)'}\n`);
console.log(`  제공시트 ${files.files?.length || 0}곳에서 ${cars}대 · 코드 있음 ${withCode}대 (${Math.round(100 * withCode / Math.max(1, cars))}%)`);
console.log(`  탭 ${whos.length}장 · 열 ${COLUMNS.length}(왼쪽 원문 ${RAW_COLUMNS.length} + 우리 ${OUR_COLUMNS.length})\n`);
for (const w of whos) {
  const rs = byWho.get(w)!;
  const c = rs.filter((r) => r['차종코드']).length;
  console.log(`  ${pad(w, 14)}${pad(`${rs.length}대`, 8)}코드 ${c}대 (${Math.round(100 * c / rs.length)}%)`);
}
if (!APPLY) { console.log('\n  미리보기였다. 실제로 만들려면 --apply\n'); process.exit(0); }

/** ── 문서를 찾거나 만든다. 같은 이름이 있으면 그걸 쓴다 — 두 장이 되면 어느 게 정본인지 모른다. */
let docId = SHEET_ID;
if (!docId) {
  const hit = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name = '${TITLE}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=5&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  docId = S(((hit.files || []) as Rec[])[0]?.id);
}
if (!docId) {
  const made = await api('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', body: JSON.stringify({ properties: { title: TITLE, locale: 'ko_KR' } }),
  });
  docId = S(made.spreadsheetId);
  console.log(`  새로 만들었다 — ${TITLE}`);
} else console.log(`  이미 있는 문서를 쓴다 — ${docId}`);

const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${docId}?fields=${encodeURIComponent('sheets.properties(sheetId,title,index)')}`);
const have = new Map<string, number>();
for (const s of ((meta.sheets || []) as Rec[])) have.set(S(s.properties?.title), Number(s.properties?.sheetId));

/** 탭을 만들고 값을 넣는다. **기존 탭은 값만 갈아 끼운다** — 지웠다 만들면 서식·보호가 날아간다. */
const reqs: Rec[] = [];
for (const [i, w] of whos.entries()) {
  if (!have.has(w)) reqs.push({ addSheet: { properties: { title: w, index: i, gridProperties: { rowCount: byWho.get(w)!.length + 20, columnCount: COLUMNS.length + 2, frozenRowCount: 1, frozenColumnCount: 1 } } } });
}
if (reqs.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${docId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });

const data = whos.map((w) => ({
  range: `${a1Tab(w)}!A1`,
  values: [COLUMNS, ...byWho.get(w)!.map((r) => COLUMNS.map((c) => r[c] ?? ''))],
}));
for (let i = 0; i < data.length; i += 10) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${docId}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 10) }),
  });
}

/** 서식 — 머리행 굵게, 우리 칸에 색, 가르는 세로줄. 눈으로 «어디부터 우리 것인지» 보여야 한다. */
const meta2 = await api(`https://sheets.googleapis.com/v4/spreadsheets/${docId}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`);
const gid = new Map<string, number>();
for (const s of ((meta2.sheets || []) as Rec[])) gid.set(S(s.properties?.title), Number(s.properties?.sheetId));
const fmt: Rec[] = [];
for (const w of whos) {
  const id = gid.get(w);
  if (id === undefined) continue;
  fmt.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } });
  fmt.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: SPLIT_AT, endColumnIndex: COLUMNS.length }, cell: { userEnteredFormat: { backgroundColor: { red: 0.87, green: 0.95, blue: 0.89 } } }, fields: 'userEnteredFormat.backgroundColor' } });
  fmt.push({ updateBorders: { range: { sheetId: id, startRowIndex: 0, endRowIndex: byWho.get(w)!.length + 1, startColumnIndex: SPLIT_AT, endColumnIndex: SPLIT_AT + 1 }, left: { style: 'SOLID_MEDIUM', color: { red: 0.4, green: 0.6, blue: 0.45 } } } });
  fmt.push({ setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: 0, endRowIndex: byWho.get(w)!.length + 1, startColumnIndex: 0, endColumnIndex: COLUMNS.length } } } });
}
for (let i = 0; i < fmt.length; i += 40) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${docId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt.slice(i, i + 40) }) });
}

console.log(`\n  반영 완료 — 탭 ${whos.length}장 · ${cars}대`);
console.log(`  https://docs.google.com/spreadsheets/d/${docId}/edit\n`);
