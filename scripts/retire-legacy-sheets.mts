/**
 * **옛 우리 시트(구버전)를 「폐기」로 표기한다** — 이름 앞 「[구버전·폐기] 」 + 첫 탭 「⚠ 구버전 — 안 씀」(지금 쓰는 시트 링크 · 이 시트는). 값·탭·권한은 건드리지 않는다.
 * 기본 dry-run, 반영은 `--apply`. 되돌리기: `--restore`(이름에서 접두 제거 + 안내 탭 삭제).
 *
 * ★사장님 2026-08-19 — 「구버전 우리 거는 폐기 또는 구버전이라고 안 쓴다고 해 주고, 외부시트는 원본만 알면 되고」
 *   · 대상은 `lib/domain/legacy-sheets.ts` 명부(옛 제공시트 15 · 옛 문패 · 옛 판매시트 · 옛 공급사 상품리스트). 외부(공급사 소유) 원본은 명부에 없다 — 안 건드린다.
 *   · 실측 2026-08-19: 손오공·우리캐피탈·렌트존 옛 시트에 문패 전환 직전까지 공급사가 적고 있었다 → 이름만으로는 부족해 첫 탭에 안내를 둔다(맨 앞, 빨간 탭).
 *   · 「프리패스 재고」 글자는 옛 이름에 넣지 않는다(드라이브 검색으로 21곳을 찾는 도구에 잡히면 안 된다).
 * ⚠ 되돌릴 이름은 tmp/retire-legacy-sheets-log.txt 와 명부 `name` 에 있다.
 *
 *   npx tsx scripts/retire-legacy-sheets.mts
 *   npx tsx scripts/retire-legacy-sheets.mts --apply
 *   npx tsx scripts/retire-legacy-sheets.mts --apply --restore
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HUB_CODE_SHEET_ID, LEGACY_SHEETS } from '../lib/domain/legacy-sheets';
import { buildLegacyNoticeRows, sheetUrl } from '../lib/domain/sheet-identity';
import { LEGACY_NOTICE_TAB, LEGACY_SHEET_PREFIX } from '../lib/domain/supplier-template-sheet';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const RESTORE = process.argv.includes('--restore');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const kstNow = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const DR = 'https://www.googleapis.com/drive/v3/files';
const idOf = (url: string) => (String(url).match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || '';
const rgb = (hex: string) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });

// 문패: 공급사코드 → 지금 쓰는 시트
const hubVals = (await call(`${SH}/${HUB_CODE_SHEET_ID}/values/A1:Z200`)).values as string[][] | undefined;
const hubRows = (hubVals || []).map((r) => r.map(S));
const hi = hubRows.findIndex((r) => r.some((c) => /공급사코드|코드/.test(c)) && r.some((c) => /시트주소|주소|URL/i.test(c)));
const hdr = hubRows[hi] || []; const ci = hdr.findIndex((c) => /공급사코드|코드/.test(c)); const ui = hdr.findIndex((c) => /시트주소|주소|URL/i.test(c));
const currentByCode = new Map<string, string>();
for (const r of hubRows.slice(hi + 1)) { const id = idOf(r[ui] || ''); if (id && r[ci]) currentByCode.set(S(r[ci]), id); }
const nameCache = new Map<string, string>();
const nameOf = async (id: string) => { if (!nameCache.has(id)) nameCache.set(id, S((await call(`${DR}/${id}?fields=name&supportsAllDrives=true`)).name)); return nameCache.get(id)!; };

console.log(`■ 구버전 시트 ${RESTORE ? '되돌리기' : '폐기 표기'} ${APPLY ? '반영' : '미리보기'} — ${LEGACY_SHEETS.length}곳\n`);
const at = kstNow();
let renamed = 0, noticed = 0, blocked = 0;
for (const l of LEGACY_SHEETS) {
  let meta: Rec;
  try { meta = await call(`${DR}/${l.id}?fields=name,capabilities(canEdit,canRename),owners(emailAddress)&supportsAllDrives=true`); }
  catch (e) { console.log(`  ✗ ${l.name} — 못 읽음 ${String(e).slice(0, 80)}`); blocked++; continue; }
  const now = S(meta.name);
  const canRename = meta.capabilities?.canRename !== false; const canEdit = meta.capabilities?.canEdit !== false;
  const replacementId = l.code ? currentByCode.get(l.code) : l.replacedBy;
  const replacement = replacementId ? { name: await nameOf(replacementId), url: sheetUrl(replacementId) } : null;
  const nextName = RESTORE ? now.replace(LEGACY_SHEET_PREFIX, '') : (now.startsWith(LEGACY_SHEET_PREFIX) ? now : `${LEGACY_SHEET_PREFIX}${now}`);
  const willRename = nextName !== now;
  console.log(`  ${APPLY ? '✓' : '→'} ${now}${willRename ? `  →  ${nextName}` : '  (이름 그대로)'}  · 지금 쓰는 시트: ${replacement?.name || '(문패에서 못 찾음)'}${canRename && canEdit ? '' : `  ⚠ 권한: rename ${canRename} edit ${canEdit}`}`);
  if (!APPLY) { if (willRename) renamed++; if (!canRename || !canEdit) blocked++; continue; }
  if (willRename) {
    if (!canRename) { console.log('     ✗ 이름 못 바꿈(권한)'); blocked++; }
    else { await call(`${DR}/${l.id}?supportsAllDrives=true`, { method: 'PATCH', body: JSON.stringify({ name: nextName }) }); appendFileSync('tmp/retire-legacy-sheets-log.txt', `${new Date().toISOString()}\t${l.id}\t${now}\t→\t${nextName}\n`); renamed++; }
  }
  if (!canEdit) { console.log('     ✗ 안내 탭 못 씀(권한)'); blocked++; continue; }
  const sm = await call(`${SH}/${l.id}?fields=sheets.properties(sheetId,title,index)`);
  const props = ((sm.sheets || []) as Rec[]).map((x) => x.properties as Rec);
  const existing = props.find((p) => S(p.title) === LEGACY_NOTICE_TAB);
  if (RESTORE) {
    if (existing) { await call(`${SH}/${l.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: existing.sheetId } }] }) }); noticed++; }
    continue;
  }
  const rows = buildLegacyNoticeRows(l, replacement, at);
  let gid = existing?.sheetId;
  if (gid === undefined) {
    const added = await call(`${SH}/${l.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: LEGACY_NOTICE_TAB, index: 0, gridProperties: { rowCount: rows.length + 10, columnCount: 3 } } } }] }) });
    gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  await call(`${SH}/${l.id}/values/${encodeURIComponent(`'${LEGACY_NOTICE_TAB}'!A1:Z100`)}:clear`, { method: 'POST', body: '{}' });
  await call(`${SH}/${l.id}/values/${encodeURIComponent(`'${LEGACY_NOTICE_TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: rows }) });
  const reqs: Rec[] = [
    { updateSheetProperties: { properties: { sheetId: gid, index: 0, tabColor: rgb('E53935') }, fields: 'index,tabColor' } },
    { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: rgb('FDE0DC'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: 14, bold: true, foregroundColor: rgb('B71C1C') } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: rgb('FFF4D6'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: 11, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 5, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
    ...[200, 640, 360].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
  ];
  await call(`${SH}/${l.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  noticed++;
}
console.log(`\n  ${APPLY ? '이름 바꿈' : '이름 바꿀 것'} ${renamed}${APPLY ? ` · 안내 탭 ${RESTORE ? '삭제' : '반영'} ${noticed}` : ''} · 권한 막힘 ${blocked}${APPLY ? ' · 되돌릴 이름은 tmp/retire-legacy-sheets-log.txt' : ' (반영은 --apply)'}`);
