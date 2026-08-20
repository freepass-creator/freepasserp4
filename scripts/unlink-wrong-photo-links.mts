/**
 * **남의 차 사진링크를 뗀다** — 사장님 2026-08-20 「차량번호로 매칭이 안 되면 아예 안 걸어야 한다」.
 *   `publish-plate-links` 의 문지기와 **같은 기준**으로 어긋난 줄을 골라, 차량번호 셀 하이퍼링크와
 *   「사진링크」 칸 값을 **함께** 지운다(칸만 두면 다음 시각 동기에서 ERP·판매시트로 다시 흘러간다).
 *     ① 드라이브 폴더·파일 이름의 차번이 그 줄 차번과 다름
 *     ② 같은 주소를 서로 다른 차가 나눠 씀(모델·날짜 묶음 폴더)
 *     ③ 열리지 않는(지워졌거나 권한 없는) 드라이브 주소
 *   뗀 값은 tmp/unlinked-photo-links-<시각>.json 에 남긴다 — 되돌릴 수 있다.
 *   기본 dry-run, 반영은 --apply. --who=스타 로 한 곳만.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { countPlatesByUrl, driveIdOf, judgePhotoLink } from '../lib/domain/photo-link-guard';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply'); const WHO = (process.argv.find((a) => a.startsWith('--who=')) || '').slice(6);
const STAMP = (process.argv.find((a) => a.startsWith('--stamp=')) || '').slice(8) || 'now';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => { for (let n = 0; ; n++) { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }); const t = await r.text(); if (r.ok) return t ? JSON.parse(t) : {}; if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 4_000 * 2 ** n)); continue; } throw new Error(`${r.status} ${t.slice(0, 300)}`); } };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const isUrl = (v: string) => /^https?:\/\//i.test(S(v));
const linkOf = (c: Rec | undefined): string => {
  if (!c) return '';
  if (S(c.hyperlink)) return S(c.hyperlink);
  for (const r of (c.textFormatRuns || []) as Rec[]) { const u = S(r.format?.link?.uri); if (u) return u; }
  const u2 = S(c.userEnteredFormat?.textFormat?.link?.uri); if (u2) return u2;
  for (const r of (c.chipRuns || []) as Rec[]) { const u = S(r.chip?.richLinkProperties?.uri); if (u) return u; }
  return '';
};
const driveInfo = new Map<string, { name: string; ok: boolean }>();
const askDrive = async (id: string) => {
  if (driveInfo.has(id)) return driveInfo.get(id)!;
  let info = { name: '', ok: false };
  try { const r = await call(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,trashed&includeItemsFromAllDrives=true&supportsAllDrives=true`); info = { name: S(r.name), ok: r.trashed !== true }; }
  catch { info = { name: '', ok: false }; }
  driveInfo.set(id, info); return info;
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));

type Removed = { supplier: string; tab: string; row: number; plate: string; url: string; reason: string; folder: string };
const removed: Removed[] = [];
let totalCut = 0;

for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  type Cand = { title: string; gid: number; rn: number; pi: number; li: number; plate: string; photo: string; cur: string };
  const cands: Cand[] = [];
  for (const p of tabs) {
    const title = S(p.title); const gid = p.sheetId;
    const grid = await call(`${SH}/${b.id}?ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}&includeGridData=true&fields=${encodeURIComponent('sheets(data(rowData(values(formattedValue,hyperlink,textFormatRuns(format(link)),userEnteredFormat(textFormat(link)),chipRuns(chip(richLinkProperties(uri)))))))')}`);
    const rows = ((((grid.sheets || []) as Rec[])[0]?.data || [])[0]?.rowData || []).map((r: Rec) => ((r.values || []) as Rec[]));
    const hi = rows.findIndex((r: Rec[]) => r.some((c) => norm(c.formattedValue) === '차량번호')); if (hi < 0) continue;
    const hdr = rows[hi].map((c: Rec) => norm(c.formattedValue));
    const pi = hdr.indexOf('차량번호'); const li = hdr.indexOf('사진링크');
    if (pi < 0 || li < 0) continue;
    rows.slice(hi + 1).forEach((r: Rec[], k: number) => {
      const rn = hi + 1 + k; const plate = S(r[pi]?.formattedValue); if (!plate) return;
      cands.push({ title, gid, rn, pi, li, plate, photo: S(r[li]?.formattedValue), cur: linkOf(r[pi]) });
    });
  }
  const shared = countPlatesByUrl(cands.map((c) => ({ plate: c.plate, urls: [c.photo, c.cur] })));
  for (const c of cands) for (const u of [c.photo, c.cur]) { const id = driveIdOf(u); if (id) await askDrive(id); }
  const why = (plate: string, url: string): { bad: string; folder: string } => {
    const id = driveIdOf(url);
    const info = id ? driveInfo.get(id) || { name: '', ok: false } : { name: '', ok: true };
    const v = judgePhotoLink(plate, url, info, shared.get(url) || 1);
    return { bad: v.fit ? '' : v.why.replace(/\(.*\)$/, '').trim(), folder: info.name };
  };


  const reqs: Rec[] = []; const clears: string[] = []; const lines: string[] = [];
  for (const c of cands) {
    const url = isUrl(c.photo) ? c.photo : c.cur;
    if (!isUrl(url)) continue;
    const v = why(c.plate, url);
    if (!v.bad) continue;
    // 차량번호 셀의 링크 서식만 지운다 — 글자(차번)는 그대로 둔다.
    reqs.push({ updateCells: { range: { sheetId: c.gid, startRowIndex: c.rn, endRowIndex: c.rn + 1, startColumnIndex: c.pi, endColumnIndex: c.pi + 1 }, rows: [{ values: [{ userEnteredFormat: { textFormat: {} } }] }], fields: 'userEnteredFormat.textFormat.link' } });
    if (isUrl(c.photo)) clears.push(`'${c.title.replace(/'/g, "''")}'!${colA1(c.li)}${c.rn + 1}`);
    removed.push({ supplier: b.label, tab: c.title, row: c.rn + 1, plate: c.plate, url, reason: v.bad, folder: v.folder });
    lines.push(`   ${c.plate.padEnd(10)} ${v.bad}${v.folder ? ` — ${v.folder.slice(0, 24)}` : ''}`);
  }
  if (!reqs.length) { console.log(`■ ${b.label.padEnd(10)} 뗄 것 없음`); continue; }
  totalCut += reqs.length;
  console.log(`■ ${b.label.padEnd(10)} 뗄 링크 ${reqs.length}건`);
  for (const l of lines.slice(0, 8)) console.log(l);
  if (lines.length > 8) console.log(`   … 그 밖 ${lines.length - 8}건`);
  if (!APPLY) continue;
  for (let i = 0; i < reqs.length; i += 500) await call(`${SH}/${b.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs.slice(i, i + 500) }) });
  if (clears.length) await call(`${SH}/${b.id}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: clears }) });
  console.log(`   ✓ 뗌 — 셀 링크 ${reqs.length} · 사진링크 칸 ${clears.length}`);
  await sleep(300);
}

const path = `tmp/unlinked-photo-links-${STAMP}.json`;
writeFileSync(path, JSON.stringify(removed, null, 2));
console.log(`\n■ 합계 — 뗄 링크 ${totalCut}건 ${APPLY ? '(반영됨)' : '(dry-run, --apply 로 반영)'} · 뗀 값 기록 ${path}`);
