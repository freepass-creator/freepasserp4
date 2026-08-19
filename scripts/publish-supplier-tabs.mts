/**
 * **공급사 제공시트 탭 정리** — 사장님 2026-08-19 「탭은 렌트재고 · 구독재고(있는 업체면) · 운영정책 · 공지사항 · 회사정보만 두고, AI가 보는 건 다 숨겨」.
 *
 *   ① 「정책」 탭 → 「운영정책」 으로 개명(별칭 읽기는 `POLICY_TAB_ALIASES`).
 *   ② 「회사정보」 탭을 만들고(없으면) 항목·설명·서식을 찍는다 — **B열(회사가 적는 칸)은 건드리지 않는다.**
 *   ③ 보이는 탭(SUPPLIER_VISIBLE_TABS) 외엔 전부 숨긴다. 보이는 탭은 그 차례로 세운다.
 *   기본 dry-run, 반영은 --apply. 한 곳은 --sheet=<ID>, 전체는 --all.
 *
 *   npx tsx scripts/publish-supplier-tabs.mts --sheet=<ID>
 *   npx tsx scripts/publish-supplier-tabs.mts --apply --sheet=<ID>
 *   npx tsx scripts/publish-supplier-tabs.mts --apply --all
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { COMPANY_INFO_HEADER, COMPANY_INFO_INTRO, COMPANY_INFO_ROWS, COMPANY_INFO_TAB_TITLE } from '../lib/domain/company-info-sheet';
import { POLICY_TAB_NAME, SHEET_NAME_MATCH, SUPPLIER_HIDDEN_TABS, SUPPLIER_VISIBLE_TABS, policyTabTitle } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const ONE = arg('sheet');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 250)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const rgb = (h: string) => ({ red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 });

const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else if (ALL) {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of (r.files || []) as Rec[]) targets.push({ id: S(f.id), name: S(f.name) });
} else { console.log('--sheet=<ID> 또는 --all'); process.exit(1); }

console.log(`■ 제공시트 탭 정리 ${APPLY ? '반영' : '미리보기(dry-run)'} — 대상 ${targets.length}곳\n`);

for (const t of targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
  const meta = await call(`${SH}/${t.id}?fields=properties.title,sheets.properties(sheetId,title,hidden,index)`);
  const book = S(meta.properties?.title) || t.name;
  const sheets = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec);
  const titles = sheets.map((s) => S(s.title));
  const reqs: Rec[] = [];
  const log: string[] = [];

  // ① 정책 → 운영정책
  const polTitle = policyTabTitle(titles);
  const pol = sheets.find((s) => S(s.title) === polTitle);
  if (pol && polTitle !== POLICY_TAB_NAME) {
    reqs.push({ updateSheetProperties: { properties: { sheetId: pol.sheetId, title: POLICY_TAB_NAME }, fields: 'title' } });
    log.push(`「${polTitle}」→「${POLICY_TAB_NAME}」`);
  } else if (!pol) log.push('정책 탭 없음');

  // ② 회사정보 탭
  let company = sheets.find((s) => S(s.title) === COMPANY_INFO_TAB_TITLE);
  const needCompany = !company;
  if (needCompany) log.push(`「${COMPANY_INFO_TAB_TITLE}」 탭 새로 만듦`);

  // ②-1 공지사항 탭이 없으면 만든다(사장님 2026-08-19 「운영정책·공지사항·회사정보는 전체 공급사 시트 통일」)
  const needNotice = !sheets.some((s) => S(s.title) === '공지사항');
  if (needNotice) log.push('「공지사항」 탭 새로 만듦');

  // ③ 숨김/보임 — 우리(AI) 탭만 숨기고, 운영정책·공지사항·회사정보는 보이게. 재고 탭 등 모르는 탭은 손대지 않는다.
  const finalTitle = (s: Rec) => (S(s.title) === polTitle && polTitle !== POLICY_TAB_NAME ? POLICY_TAB_NAME : S(s.title));
  for (const s of sheets) {
    const title = finalTitle(s);
    const mustShow = SUPPLIER_VISIBLE_TABS.includes(title);
    const mustHide = SUPPLIER_HIDDEN_TABS.includes(title);
    if (!mustShow && !mustHide) continue;
    const show = mustShow;
    if (!!s.hidden === !show) continue;
    reqs.push({ updateSheetProperties: { properties: { sheetId: s.sheetId, hidden: !show }, fields: 'hidden' } });
    log.push(`${show ? '보임' : '숨김'} 「${title}」`);
  }

  console.log(`  ${book}\n     ${log.length ? log.join(' · ') : '변경 없음'}`);
  if (!APPLY) continue;

  if (reqs.length) await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  if (needNotice) {
    const made = await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: '공지사항', gridProperties: { rowCount: 100, columnCount: 6 } } } }] }) });
    const ngid = made.replies?.[0]?.addSheet?.properties?.sheetId;
    await call(`${SH}/${t.id}/values/${encodeURIComponent("'공지사항'!A1")}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ values: [['프리패스 공지사항 — 프리패스가 적는 칸입니다. 공급사 확인용.'], ['날짜', '내용']] }) });
    if (ngid != null) await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
      { repeatCell: { range: { sheetId: ngid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11 } } }, fields: 'userEnteredFormat(textFormat)' } },
      { repeatCell: { range: { sheetId: ngid, startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: rgb('E6E6E6'), textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
      { updateDimensionProperties: { range: { sheetId: ngid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: ngid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 640 }, fields: 'pixelSize' } },
    ] }) });
  }

  // 회사정보 탭 만들기 + 내용(라벨·설명·서식). B열은 사람이 적는 칸 — 기존 탭이면 값을 덮지 않는다.
  if (needCompany) {
    const made = await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: COMPANY_INFO_TAB_TITLE, gridProperties: { rowCount: 60, columnCount: 4, frozenRowCount: 3 } } } }] }) });
    company = made.replies?.[0]?.addSheet?.properties;
  }
  const gid = company!.sheetId as number;
  const rows: string[][] = [];
  rows.push([COMPANY_INFO_INTRO[0], '', '']);
  rows.push([COMPANY_INFO_INTRO[1], '', '']);
  rows.push([...COMPANY_INFO_HEADER]);
  const sectionRows: number[] = [];
  const attachRows: number[] = [];
  const fieldRows: number[] = [];
  for (const r of COMPANY_INFO_ROWS) {
    const at = rows.length;
    if (r.kind === 'section') { sectionRows.push(at); rows.push([r.title, '', r.note || '']); }
    else if (r.kind === 'attach') { attachRows.push(at); rows.push([r.label, '', r.note]); }
    else { fieldRows.push(at); rows.push([r.label, '', [r.note, r.example ? `예: ${r.example}` : '', r.ocr ? `(${r.ocr}에서 자동)` : ''].filter(Boolean).join(' · ')]); }
  }
  // 라벨(A)·설명(C)만 쓴다. B 는 기존 값을 두기 위해 개별 셀로 쓰지 않는다. 다시 찍을 땐 옛 라벨·서식이 남지 않게 A·C 열과 서식을 먼저 비운다.
  if (!needCompany) {
    await call(`${SH}/${t.id}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: [`'${COMPANY_INFO_TAB_TITLE}'!A1:A200`, `'${COMPANY_INFO_TAB_TITLE}'!C1:C200`] }) });
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
      { unmergeCells: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 3 } } },
      { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 200 }, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 3, endIndex: 200 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    ] }) });
  }
  const data = [
    { range: `'${COMPANY_INFO_TAB_TITLE}'!A1:A${rows.length}`, values: rows.map((r) => [r[0]]) },
    { range: `'${COMPANY_INFO_TAB_TITLE}'!C1:C${rows.length}`, values: rows.map((r) => [r[2]]) },
    ...(needCompany ? [{ range: `'${COMPANY_INFO_TAB_TITLE}'!B3`, values: [[COMPANY_INFO_HEADER[1]]] }] : []),
  ];
  await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });

  const fmt: Rec[] = [
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 320 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 460 }, fields: 'pixelSize' } },
    { mergeCells: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 }, wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { textFormat: { fontSize: 9, foregroundColor: rgb('555555') }, wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: rgb('E6E6E6'), textFormat: { bold: true, fontSize: 9 } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 3, endRowIndex: rows.length, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { textFormat: { fontSize: 9, foregroundColor: rgb('555555') }, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 3, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontSize: 10 }, verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 3, endRowIndex: rows.length, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: rgb('FFF8E1'), textFormat: { fontSize: 10 }, verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)' } },
  ];
  for (const r of sectionRows) fmt.push({ repeatCell: { range: { sheetId: gid, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: rgb('D0DAF5'), textFormat: { bold: true, fontSize: 10 } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
  for (const r of attachRows) {
    fmt.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } });
    fmt.push({ repeatCell: { range: { sheetId: gid, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: rgb('FDE3C8') } }, fields: 'userEnteredFormat(backgroundColor)' } });
  }
  await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt }) });

  // 탭 차례 — 보이는 탭을 그 순서로 앞에 세운다
  const now = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,index,hidden)`);
  const nowSheets = ((now.sheets || []) as Rec[]).map((s) => s.properties as Rec);
  const order: Rec[] = [];
  // 재고 탭(보이는 다른 탭들)은 지금 차례 그대로 앞에, 그 뒤에 운영정책 → 공지사항 → 회사정보, 숨긴 탭은 맨 뒤.
  const front = nowSheets.filter((x) => !x.hidden && !SUPPLIER_VISIBLE_TABS.includes(S(x.title))).sort((a, b) => Number(a.index) - Number(b.index));
  const tail = SUPPLIER_VISIBLE_TABS.map((title) => nowSheets.find((x) => S(x.title) === title)).filter(Boolean) as Rec[];
  const hidden = nowSheets.filter((x) => x.hidden).sort((a, b) => Number(a.index) - Number(b.index));
  [...front, ...tail, ...hidden].forEach((s, idx) => {
    if (Number(s.index) !== idx) order.push({ updateSheetProperties: { properties: { sheetId: s.sheetId, index: idx }, fields: 'index' } });
  });
  if (order.length) await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: order }) });
  console.log(`     ✓ 반영 — 회사정보 ${rows.length}줄 · 탭 차례 ${[...front, ...tail].map((x) => S(x.title)).join(' · ')}`);
}
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply');
