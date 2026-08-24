/**
 * **차량번호 셀 링크를 사진링크와 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-23 「시트는 원본시트에 다 있잖아 · 과거시트 참조해봐」 ·
 *   「링크 다 반영해 주고 · **공급사 정제시트에 차량번호에 링크 제대로 걸고**」
 *
 * ★왜 이 도구가 따로 있나
 *   공급사 시트에서 사진은 **두 자리**에 있다 — 「사진링크」 열과 **차량번호 셀의 하이퍼링크**.
 *   오토플러스 원본 머리글이 그 규격을 말한다: 「★★★ 차량번호 클릭 후 차량이미지 다운로드 가능합니다 ★★★」.
 *   ⚠ 셀 링크는 **값(values)으로 읽으면 안 보인다.** `includeGridData` 로 읽어야 한다 —
 *     그래서 2026-08-23 에 「원본에 사진이 없다」고 잘못 봤다.
 *   사진링크 열만 고치면 두 자리가 갈린다. 여기서 **차번 셀 링크를 사진링크에 맞춘다.**
 *
 * ⚠ 사진링크가 빈 줄은 건드리지 않는다(없는 링크를 셀에 걸 수는 없다).
 *
 *   npx tsx scripts/sync-plate-cell-links.mts
 *   npx tsx scripts/sync-plate-cell-links.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const WHO = arg('who');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const call = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    if (r.ok) return r.json();
    if (r.status === 404 || r.status === 403) return null;
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
/** 셀에 걸린 링크 — hyperlink · textFormatRuns · userEnteredFormat 세 자리를 다 본다. */
const linkOf = (c: any): string => {
  if (!c) return '';
  const direct = S(c.hyperlink) || S(c.userEnteredFormat?.textFormat?.link?.uri);
  if (direct) return direct;
  for (const r of (c.textFormatRuns || [])) { const u = S(r?.format?.link?.uri); if (u) return u; }
  return '';
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
console.log('■ 차량번호 셀 링크를 사진링크와 맞춘다\n');

let same = 0; let fix = 0; let noPhoto = 0;
const sample: string[] = [];
for (const f of (found?.files || [])) {
  const label = supplierSheetLabel(S(f.name));
  if (WHO && !label.includes(WHO)) continue;
  if (/구버전|폐기/.test(label)) continue;
  const meta = await call(`${SH}/${S(f.id)}?fields=sheets.properties(sheetId,title,hidden)`);
  const sheet = (meta?.sheets || []).find((s: any) => !s.properties.hidden && !isOurNonInventoryTab(S(s.properties.title)));
  if (!sheet) continue;
  const title = S(sheet.properties.title);
  const gid = sheet.properties.sheetId;
  const grid = await call(`${SH}/${S(f.id)}?ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:CZ700`)}&includeGridData=true&fields=${encodeURIComponent('sheets(data(rowData(values(formattedValue,hyperlink,textFormatRuns(format(link)),userEnteredFormat(textFormat(link))))))')}`);
  const rowData = grid?.sheets?.[0]?.data?.[0]?.rowData || [];
  const head = (rowData.find((r: any) => (r.values || []).some((c: any) => S(c?.formattedValue) === '차량번호'))?.values || []).map((c: any) => S(c?.formattedValue));
  if (!head.length) continue;
  const hi = rowData.findIndex((r: any) => (r.values || []).some((c: any) => S(c?.formattedValue) === '차량번호'));
  const ip = head.indexOf('차량번호');
  const ic = head.findIndex((h: string) => /사진링크|사진|이미지/.test(h));
  if (ip < 0 || ic < 0) continue;

  const reqs: any[] = [];
  for (let r = hi + 1; r < rowData.length; r++) {
    const cells = rowData[r]?.values || [];
    const plate = S(cells[ip]?.formattedValue).replace(/\s+/g, '');
    if (!plate) continue;
    const photo = S(cells[ic]?.formattedValue);
    if (!photo) { noPhoto++; continue; }
    if (linkOf(cells[ip]) === photo) { same++; continue; }
    fix++;
    if (sample.length < 8) sample.push(`  ${label} ${plate} ▶ ${photo.slice(0, 56)}`);
    reqs.push({
      updateCells: {
        range: { sheetId: gid, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: ip, endColumnIndex: ip + 1 },
        rows: [{ values: [{ userEnteredFormat: { textFormat: { link: { uri: photo } } } }] }],
        fields: 'userEnteredFormat.textFormat.link',
      },
    });
  }
  if (APPLY && reqs.length) {
    for (let i = 0; i < reqs.length; i += 200) {
      await call(`${SH}/${S(f.id)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs.slice(i, i + 200) }) });
    }
    console.log(`  ✓ ${label} ${reqs.length}줄`);
  }
  await sleep(150);
}
console.log(`\n  고칠 줄 ${fix} · 이미 맞음 ${same} · 사진링크가 빈 줄 ${noPhoto}`);
if (sample.length) { console.log('\n  보기:'); sample.forEach((l) => console.log(l)); }
if (!APPLY) console.log('\n  (미리보기다 — 반영하려면 --apply)');
