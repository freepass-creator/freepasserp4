/**
 * **정책 작성 매뉴얼을 찍는다** — 리포 `docs/SUPPLIER_POLICY_SHEET_MANUAL.md`. (공급사 시트의 「정책 작성법」 탭은 사장님 2026-08-18
 * 「필요가 없지」로 20곳 모두 지웠다 — 탭 발행은 `--apply --tabs` 를 둘 다 줄 때만.)
 *
 * ★왜(사장님 2026-08-18 — 「규격 통일 좀 하고 매뉴얼 만들면 되잖아」)
 *   시트를 여는 사람이 리포를 여는 것은 아니다 — 매뉴얼은 정책 탭 옆에 있어야 한다. 그래서 탭으로 찍는다.
 *   내용은 `lib/domain/policy-guide.ts` 한 곳에서 나온다. 문서와 탭이 갈릴 수가 없다.
 * ⚠ 이 탭은 기계가 통째로 다시 쓴다(사람이 적는 칸이 없다). 사람 메모는 「AI 인계」 @메모에.
 *
 *   npx tsx scripts/publish-policy-guide.mts            # 문서 갱신 + 시트 dry-run
 *   npx tsx scripts/publish-policy-guide.mts --apply    # 20곳 탭 반영
 *   npx tsx scripts/publish-policy-guide.mts --apply --sheet=<ID>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { SHEET_NAME_MATCH, isPolicyTabTitle, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import {
  POLICY_GUIDE_HEADER, POLICY_GUIDE_TAB, POLICY_WRITING_PRINCIPLES,
  policyGuideMarkdown, policyGuideRows, policyGuideSynonymRows,
} from '../lib/domain/policy-guide';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONE = arg('sheet');
const DOC = 'docs/SUPPLIER_POLICY_SHEET_MANUAL.md';

// ① 리포 문서 — 항상 갱신(로컬 파일이라 dry-run 에서도 쓴다)
writeFileSync(DOC, policyGuideMarkdown(), 'utf8');
console.log(`  문서 갱신 — ${DOC}`);

// ② 시트 탭 내용
const rows: string[][] = [];
rows.push(['정책 탭 작성법', '', '', '', '', '', '']);
rows.push(['', '「정책」 탭은 한 줄이 정책 하나입니다. 첫 줄 「(프리패스 기본)」은 프리패스 기본 정책, 그 아래가 귀사 정책입니다. 차량 시트의 「정책코드」가 이 줄을 가리킵니다.', '', '', '', '', '']);
rows.push(['', '값은 아래 표기 규격대로 적어 주세요. 드롭다운이 있는 칸은 목록에서 고르면 됩니다. 궁금한 칸은 머리글의 메모(빨간 삼각형)를 보세요.', '', '', '', '', '']);
rows.push(['', '', '', '', '', '', '']);
rows.push(['표기 원칙', '', '', '', '', '', '']);
POLICY_WRITING_PRINCIPLES.forEach((p, i) => rows.push(['', `${i + 1}. ${p}`, '', '', '', '', '']));
rows.push(['', '', '', '', '', '', '']);
rows.push([...POLICY_GUIDE_HEADER]);
const tableStart = rows.length;
for (const r of policyGuideRows()) rows.push(r);
rows.push(['', '', '', '', '', '', '']);
rows.push(['자주 틀리는 표기 → 규격', '', '', '', '', '', '']);
rows.push(['', '항목', '이렇게 적혀 있으면', '이렇게', '', '', '']);
for (const r of policyGuideSynonymRows()) rows.push(['', r[0], r[1], r[2], '', '', '']);
rows.push(['', '', '', '', '', '', '']);
rows.push(['', `마지막 갱신 ${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} KST · npx tsx scripts/publish-policy-guide.mts --apply`, '', '', '', '', '']);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(f.name) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
const TARGETS_FILTERED = excludeMirrorSheets([...targets]); targets.length = 0; targets.push(...TARGETS_FILTERED);   // 복사본(--include-mirror 때 같은 배열이 비워지는 버그, 2026-08-19)
console.log(`\n■ 「${POLICY_GUIDE_TAB}」 탭 ${APPLY ? '반영' : '미리보기(dry-run)'} · 대상 ${targets.length}곳 · ${rows.length}줄\n`);
// ★사장님 2026-08-18 — 「공급사 시트에 정책 작성법 필요가 없지」. 공급사 시트에는 안내 탭을 두지 않는다(20곳 지움). 매뉴얼은 리포 문서로만.
if (!process.argv.includes('--tabs')) { console.log('※ 공급사 시트 탭은 안 찍는다(사장님 2026-08-18). 문서만 갱신했다. 굳이 찍으려면 --apply --tabs'); process.exit(0); }
if (!APPLY) { console.log('※ dry-run. 시트 반영은 --apply\n'); process.exit(0); }

const rgb = (hex: string) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties`);
  const props = (meta.sheets || []).map((x: Rec) => x.properties);
  const policy = props.find((p: Rec) => isPolicyTabTitle(p.title));
  let gid = props.find((p: Rec) => S(p.title) === POLICY_GUIDE_TAB)?.sheetId;
  if (gid === undefined) {
    // 「정책」 탭 바로 뒤에 만든다 — 정책 옆에 있어야 본다.
    const index = policy ? Number(policy.index) + 1 : undefined;
    const added = await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: POLICY_GUIDE_TAB, ...(index !== undefined ? { index } : {}), gridProperties: { rowCount: rows.length + 10, columnCount: 7, frozenRowCount: 0 } } } }] }) });
    gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${POLICY_GUIDE_TAB}'!A1:Z${Math.max(400, rows.length + 50)}`)}:clear`, { method: 'POST', body: '{}' });
  await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${POLICY_GUIDE_TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: rows }) });
  const reqs: Rec[] = [
    { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: 12, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: tableStart - 1, endRowIndex: tableStart, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: rgb('D9E7FD'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    ...[110, 150, 120, 300, 340, 220, 260].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
    { updateSheetProperties: { properties: { sheetId: gid, tabColor: rgb('DFF3E4') }, fields: 'tabColor' } },
  ];
  // 표기 원칙·머리 줄은 굵게
  for (const [i, r] of rows.entries()) if (r[0] && i !== tableStart - 1 && i !== 0) reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat.textFormat' } });
  await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  const back = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${POLICY_GUIDE_TAB}'!A1:G${rows.length}`)}`) as { values?: string[][] };
  const n = (back.values || []).length;
  console.log(`  ✓ ${t.name.padEnd(10)} ${n}줄`);
}
console.log('\n  반영 완료\n');
