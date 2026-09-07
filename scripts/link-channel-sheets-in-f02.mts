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
process.exit(0);
