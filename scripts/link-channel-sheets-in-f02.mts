/**
 * **거래처 정리 시트(F02) 「영업채널」 탭에 «정산시트» 칸을 만들고 링크를 건다.** 반영은 `--apply`.
 *
 * ★사장님 2026-09-04 「f02시트에 영업채널에 정산시트 항목칸 만들어주고 링크 걸어주세요」
 *
 * ★**공급사 탭에는 이미 있다.** 「원본시트 · 정제시트」 두 칸이 홈페이지 뒤에 서서 링크로 열린다.
 *   영업채널 탭에만 그게 없어서, 어느 채널의 정산시트가 어디인지 사람이 매번 찾아야 했다.
 *   ⇒ 같은 자리(홈페이지 뒤)에 「정산시트」 한 칸을 세운다. 자리가 같아야 두 탭을 같은 눈으로 본다.
 *
 * ★★**링크는 «짧은 글자»에 건다** — 주소를 통째로 넣으면 열이 화면 밖까지 늘어난다.
 *   공급사 탭이 그렇게 하고 있다(`partners-rebuild.mjs` 의 `sheetLabel`). 같은 짜임을 쓴다.
 *
 * ⚠⚠ **`C:\dev\sheetops\partners-rebuild.mjs` 도 같이 고쳐야 한다.**
 *   그 스크립트가 이 탭을 «다시 찍는다»(`A1:R`). CH_HEAD 에 이 칸을 안 더하면 다음 실행 때
 *   통째로 사라진다 — 오늘 걸어 놓고 내일 없어지는 꼴이다.
 *
 *   npx tsx scripts/link-channel-sheets-in-f02.mts
 *   npx tsx scripts/link-channel-sheets-in-f02.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { CHANNEL_F_CODE } from '../lib/server/channel-sheet-tabs';

const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
/** 이름 맞추기 — 「주식회사 렌트야」와 「렌트야」가 한곳으로 떨어지게. */
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s()·\-_.]/g, '')
  .replace(/(주식회사|㈜|무심사|모빌리티|렌터카|렌트카)/g, '');

const F02 = '1TpYMQh9yxMjww7OjxIkQIC79Uig4tKJamkFeTxjtr68';   // [F02 사용중] 프리패스 거래처 정리
const TAB = '영업채널';
/** ★공급사 탭과 «같은 자리» — 홈페이지 바로 뒤. */
const AFTER = '홈페이지';
const NEW = '정산시트';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;
/**
 * ⚠⚠ **실패를 «없음»으로 삼키지 않는다.** 응답을 안 보고 넘기면 조회가 깨졌을 때
 *   빈 값이 돌아오고, 그것을 「탭이 없습니다」로 적게 된다 — 실제로는 탭이 멀쩡한데도.
 *   같은 병을 오늘 대조기에서도 잡았다(채널 넷이 「시트 없음」으로 떴다). 그 자리에서 멈춘다.
 */
const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, {
    ...init, headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!r.ok) { console.log(`\n  ✕ 시트·드라이브 조회 실패 ${r.status} — ${(await r.text()).slice(0, 160)}\n`); process.exit(1); }
  return r;
};

/** ── 채널 정산시트를 드라이브에서 찾는다 (F8x) ── */
const found = (((await (await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name contains '프리패스 정산' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")}&fields=files(id,name)&pageSize=60&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json()) as { files?: { id: string; name: string }[] }).files) || [];
const books = new Map<string, { id: string; name: string }>();
for (const f of found) {
  if (/구버전|폐기|백업|사용 안 함|정산원장|정산기준/.test(f.name)) continue;
  const who = f.name.replace(/^\[[^\]]*\]\s*/, '').replace(/\s*프리패스 정산.*$/, '');
  books.set(key(who), { id: f.id, name: f.name });
}
console.log(`\n■ F02 「${TAB}」 — 「${NEW}」 칸 ${APPLY ? '(반영)' : '(대조만)'}`);
console.log(`   찾은 채널 정산시트 ${books.size}개 — ${[...books.keys()].join(' · ')}\n`);

const meta = await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02}?fields=sheets.properties(title,sheetId,gridProperties(columnCount))`)).json() as {
  sheets?: { properties: { title: string; sheetId: number; gridProperties?: { columnCount?: number } } }[] };
const sheet = (meta.sheets || []).find((s) => s.properties.title === TAB);
if (!sheet) { console.log(`  ✕ 「${TAB}」 탭이 없습니다\n`); process.exit(1); }
const sheetId = sheet.properties.sheetId;

const grid = (((await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02}/values/${encodeURIComponent(`'${TAB}'!A1:BA200`)}`)).json()) as { values?: unknown[][] }).values) || [];
const hi = grid.findIndex((r) => (r || []).some((c) => S(c) === '업체명'));
if (hi < 0) { console.log('  ✕ 머리글을 못 찾았습니다\n'); process.exit(1); }
const head = (grid[hi] || []).map(S);
const already = head.indexOf(NEW);
const at = already >= 0 ? already : head.indexOf(AFTER) + 1;
if (head.indexOf(AFTER) < 0) { console.log(`  ✕ 「${AFTER}」 열이 없습니다 — 자리를 못 잡습니다\n`); process.exit(1); }
const iName = head.indexOf('업체명');

/** 어느 줄에 무엇을 걸 것인가. */
const hits: { row: number; who: string; label: string; url: string }[] = [];
const miss: string[] = [];
for (let i = hi + 1; i < grid.length; i++) {
  const who = S((grid[i] || [])[iName]); if (!who) continue;
  /**
   * ★★**이름이 두 곳에서 다르다.** F02 는 「에스엠씨(S.M.C)」로 적고 시트 이름은 「SMC」다.
   *   ⇒ 정확히 같은 것을 먼저 보고, 없으면 «한쪽이 다른 쪽에 든» 경우를 본다.
   *   ⚠ 두 글자 미만은 안 본다 — 짧은 조각은 남의 이름에도 들어가 엉뚱한 시트를 건다.
   */
  const k = key(who);
  const b = books.get(k)
    || [...books].find(([bk]) => bk.length >= 2 && (k.includes(bk) || bk.includes(k)))?.[1];
  if (!b) { if (CHANNEL_F_CODE[who] || /거래중/.test(S((grid[i] || [])[0]))) miss.push(who); continue; }
  hits.push({ row: i, who, label: NEW, url: `https://docs.google.com/spreadsheets/d/${b.id}` });
}
hits.forEach((h) => console.log(`  o ${h.who.padEnd(22)} ${String(h.row + 1).padStart(3)}행  →  ${h.url}`));
if (miss.length) console.log(`\n  · 정산시트가 아직 없는 거래중 채널 — ${[...new Set(miss)].join(' · ')}`);
console.log(`\n   ${already >= 0 ? '칸은 이미 있습니다' : `「${AFTER}」 뒤에 칸을 새로 냅니다`} · 링크 ${hits.length}개`);
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 붙입니다.\n'); process.exit(0); }

const reqs: Record<string, unknown>[] = [];
if (already < 0) {
  /** ★칸을 «끼워» 넣는다 — 오른쪽 것들이 밀려야 「접촉일·통화 결과·다음 할 일」이 제자리를 지킨다. */
  reqs.push({ insertDimension: { range: { sheetId, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, inheritFromBefore: false } });
  reqs.push({ updateCells: { range: { sheetId, startRowIndex: hi, endRowIndex: hi + 1, startColumnIndex: at, endColumnIndex: at + 1 },
    rows: [{ values: [{ userEnteredValue: { stringValue: NEW } }] }], fields: 'userEnteredValue' } });
  reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, properties: { pixelSize: 86 }, fields: 'pixelSize' } });
}
/** ★주소가 아니라 «짧은 글자»에 링크를 건다 — 주소를 넣으면 열이 화면 밖까지 늘어난다. */
for (const h of hits) {
  reqs.push({ updateCells: {
    range: { sheetId, startRowIndex: h.row, endRowIndex: h.row + 1, startColumnIndex: at, endColumnIndex: at + 1 },
    rows: [{ values: [{ userEnteredValue: { stringValue: h.label },
      textFormatRuns: [{ startIndex: 0, format: { link: { uri: h.url }, underline: true, foregroundColorStyle: { rgbColor: { red: 17 / 255, green: 85 / 255, blue: 204 / 255 } } } }] }] }],
    fields: 'userEnteredValue,textFormatRuns' } });
}
const r = await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
if (!r.ok) { console.log(`\n  ✕ 못 썼습니다 — ${r.status} ${(await r.text()).slice(0, 200)}\n`); process.exit(1); }
console.log(`\n  ✓ 「${NEW}」 칸에 링크 ${hits.length}개를 걸었습니다.`);
console.log('  ⚠ C:\\dev\\sheetops\\partners-rebuild.mjs 의 CH_HEAD 에도 이 칸을 더해야 합니다 —');
console.log('     그 스크립트가 이 탭을 다시 찍을 때 없으면 통째로 사라집니다.\n');

/**
 * ★★**「시작」 탭에 «청구서 폴더» 길을 낸다** — 사장님 2026-09-04
 *   「그리고 시작에는 PDF파일 모아놓은 청구서 링크도 해줘야함」.
 *
 *   달마다 정산서가 드라이브에 쌓이는데 그 자리를 아는 사람이 만든 사람뿐이었다.
 *   거래처를 여는 시트 첫 화면에 길을 내 둔다.
 * ⚠ 주소를 «칸 하나에 홀로» 둔다 — 설명과 섞으면 시트가 링크로 안 알아본다.
 * ⚠ `partners-rebuild.mjs` 의 `startBlocks` 에도 같은 블록이 있어야 한다. 그 스크립트가
 *   이 탭을 통째로 다시 찍는다 — 없으면 다음 실행 때 사라진다.
 */
async function ensureInvoiceLinksOnStart() {
  const TAB2 = '시작';
  const meta2 = await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02}?fields=sheets.properties(title,sheetId)`)).json() as {
    sheets?: { properties: { title: string; sheetId: number } }[] };
  const s2 = (meta2.sheets || []).find((s) => s.properties.title === TAB2);
  if (!s2) { console.log(`  ~ 「${TAB2}」 탭이 없어 건너뜁니다`); return; }
  const g2 = (((await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02}/values/${encodeURIComponent(`'${TAB2}'!A1:B60`)}`)).json()) as { values?: unknown[][] }).values) || [];
  if (g2.some((r) => /정산 서류/.test(S((r || [])[0])))) { console.log(`  ○ 「${TAB2}」에 이미 있습니다`); return; }

  /** 달 폴더는 드라이브에서 찾는다 — 이름을 손으로 박으면 다음 달에 틀린 말이 된다. */
  const folder = async (name: string, parent?: string) => {
    const q = `name = '${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parent ? ` and '${parent}' in parents` : ''}`;
    const f = (((await (await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json()) as { files?: { id: string }[] }).files) || [];
    return f[0]?.id || '';
  };
  const root = await folder('프리패스 정산서');
  if (!root) { console.log('  ~ 「프리패스 정산서」 폴더를 못 찾아 건너뜁니다'); return; }
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const mid = (await folder(month, root)) || (await folder(last, root));
  const midName = (await folder(month, root)) ? month : last;
  const link = (id: string) => `https://drive.google.com/drive/folders/${id}`;
  const rows: [string, string][] = [
    ['달마다 새 폴더가 생기는 곳', link(root)],
    [`${midName} 전체`, mid ? link(mid) : '(아직 없음)'],
    [`${midName} 공급사 청구서 — 우리가 «받을» 것`, mid ? link(await folder('공급사 청구서', mid)) : '(아직 없음)'],
    [`${midName} 영업채널 정산서 — 우리가 «줄» 것`, mid ? link(await folder('영업채널 정산서', mid)) : '(아직 없음)'],
    ['만드는 명령', 'npx tsx scripts/run-settlement-month.mts 2026-08 --apply'],
  ];
  const at = g2.length + 1;                       // 빈 줄 하나 띄우고 이어 붙인다
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02}/values/${encodeURIComponent(`'${TAB2}'!A${at + 1}:B${at + 2 + rows.length}`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values: [['정산 서류 (PDF) — 달마다 여기에 쌓인다', ''], ['무엇', '어디'], ...rows] }) });
  const id2 = s2.properties.sheetId;
  const band = (row: number, bold: boolean, bg?: { red: number; green: number; blue: number }) => ({ repeatCell: {
    range: { sheetId: id2, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 2 },
    cell: { userEnteredFormat: { textFormat: { bold }, ...(bg ? { backgroundColor: bg } : {}) } },
    fields: `userEnteredFormat(textFormat${bg ? ',backgroundColor' : ''})` } });
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
    band(at, true), band(at + 1, true, { red: 0.93, green: 0.95, blue: 0.98 }),
  ] }) });
  console.log(`  ✓ 「${TAB2}」에 「정산 서류」 ${rows.length}줄을 붙였습니다 (${at + 1}행부터)`);
}
await ensureInvoiceLinksOnStart();

process.exit(0);
