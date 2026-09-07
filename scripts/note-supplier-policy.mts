/**
 * **공급사 시트의 «칸 머리글»에 정책 요약을 메모로 박는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-05 「텍스트 요약해서 우리캐피탈 보증금칸에 시트메모로 박자」
 *   — 우리캐피탈 안내: 「소득증빙 및 공동임차인 등재시 보증금 완화 조건은 차량가에 따라 조금씩
 *     다릅니다. 비율로 정하자면 기존 보증금에서 25% 할인이라고 보시면 됩니다」
 *
 * ★★**왜 «머리글 메모»인가.** 조건은 차마다 다르지 않고 «그 칸 전체»에 걸린다.
 *   줄마다 적으면 차가 늘 때마다 다시 적어야 하고, 안 적힌 줄은 조건이 없는 것처럼 보인다.
 *   머리글에 한 번 박으면 그 열을 누르는 사람이 언제나 같은 말을 본다.
 *
 * ⚠⚠ **있는 메모를 덮지 않는다.** 머리글 메모에는 이미 규격 설명이 들어 있다
 *   (「보증금(원). 오른쪽 장기 기간을 관할한다」). 덮으면 그 규격이 사라진다 — 뒤에 «덧붙인다».
 * ⚠ 같은 말을 두 번 붙이지 않는다 — 이미 들어 있으면 건너뛴다.
 *
 * ```
 * npx tsx scripts/note-supplier-policy.mts --공급사=우리캐피탈 --칸=단기보증,장기보증 --메모="..."
 * npx tsx scripts/note-supplier-policy.mts --공급사=우리캐피탈 --칸=단기보증,장기보증 --메모="..." --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const S = (v: unknown) => String(v ?? '').trim();
const arg = (n: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
const SUP = S(arg('공급사')); const COLS = S(arg('칸')).split(',').map(S).filter(Boolean);
const MEMO = S(arg('메모')); const TAB = S(arg('탭')) || '재고';
const APPLY = process.argv.includes('--apply');
if (!SUP || !COLS.length || !MEMO) {
  console.log('\n  npx tsx scripts/note-supplier-policy.mts --공급사=우리캐피탈 --칸=단기보증,장기보증 --메모="..." [--탭=재고] [--apply]\n');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;
/** ⚠ 실패를 «없음»으로 삼키지 않는다 — 그 자리에서 멈춘다. */
const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!r.ok) { console.log(`\n  ✕ 조회·쓰기 실패 ${r.status} — ${(await r.text()).slice(0, 160)}\n`); process.exit(1); }
  return r;
};

const files = (((await (await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${SUP}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json()) as { files?: { id: string; name: string }[] }).files || [])
  .filter((f) => !/구버전|폐기|백업/.test(f.name) && /재고/.test(f.name));
if (files.length !== 1) { console.log(`\n  ✕ 「${SUP}」 재고 시트를 «하나»로 못 맞췄습니다(${files.length}개)\n`); process.exit(1); }
const book = files[0];
console.log(`\n■ ${book.name} → 「${TAB}」 탭 · 칸 ${COLS.join(' · ')} ${APPLY ? '(반영)' : '(대조만)'}\n`);

const meta = await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${book.id}?fields=sheets.properties(title,sheetId)`)).json() as {
  sheets?: { properties: { title: string; sheetId: number } }[] };
const sheet = (meta.sheets || []).find((s) => s.properties.title === TAB);
if (!sheet) { console.log(`  ✕ 「${TAB}」 탭이 없습니다\n`); process.exit(1); }

/** 머리글은 «첫 줄»이다 — 값이 아니라 이름이 선 줄. */
const grid = await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${book.id}?ranges=${encodeURIComponent(`'${TAB}'!A1:BZ1`)}&fields=sheets(data(rowData(values(formattedValue,note))))&includeGridData=true`)).json() as {
  sheets?: { data?: { rowData?: { values?: { formattedValue?: string; note?: string }[] }[] }[] }[] };
const cells = grid.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || [];
const A1 = (n: number) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

const reqs: Record<string, unknown>[] = [];
for (const want of COLS) {
  const i = cells.findIndex((c) => S(c?.formattedValue) === want);
  if (i < 0) { console.log(`  ✕ 「${want}」 머리글을 못 찾았습니다`); continue; }
  const had = S(cells[i]?.note);
  if (had.includes(MEMO)) { console.log(`  ○ ${A1(i)}1 「${want}」 — 이미 같은 말이 들어 있습니다`); continue; }
  /** ★있는 메모 «뒤»에 붙인다 — 규격 설명을 지우지 않는다. */
  const next = had ? `${had}\n\n${MEMO}` : MEMO;
  console.log(`  + ${A1(i)}1 「${want}」`);
  console.log(`      전 ${had ? `「${had.slice(0, 60)}${had.length > 60 ? '…' : ''}」` : '(메모 없음)'}`);
  console.log(`      후 «앞의 것 + 아래 요약»`);
  reqs.push({ updateCells: {
    range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
    rows: [{ values: [{ note: next }] }], fields: 'note' } });
}
console.log(`\n  요약\n     ${MEMO.split('\n').join('\n     ')}`);
console.log(`\n   메모를 달 칸 ${reqs.length}개`);
if (!reqs.length) { console.log('\n  달 것이 없습니다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 답니다.\n'); process.exit(0); }
await api(`https://sheets.googleapis.com/v4/spreadsheets/${book.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
console.log(`\n  ✓ ${reqs.length}칸에 메모를 달았습니다.\n`);
process.exit(0);
