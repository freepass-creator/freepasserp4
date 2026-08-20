/**
 * **차량번호 셀에 사진 링크를 건다(모든 공급사 시트 동일)** — 사장님 2026-08-19 「차량번호에 링크 삽입하는 거 동일하게 · 모든 시트 그냥 링크 삽입 방식도 동일하게 가자」.
 *   공급사 원본(아이카 상세페이지·오플 드라이브 폴더)이 차량번호 셀에 링크를 거는 방식 그대로, 우리 시트도 「사진링크」 칸의 주소를 차량번호 셀 하이퍼링크로 건다.
 *   · 사진링크 있고 차량번호 셀 링크 없음(또는 다름) → 차량번호 셀에 링크(글자는 그대로, 서식 link 만)
 *   · 차량번호 셀에 링크 있고 사진링크 비어 있음 → 사진링크 칸에 주소를 적는다(양쪽이 같아진다)
 *   기본 dry-run, 반영은 --apply. --who=손오공 으로 한 곳만.
 *
 * ★**그 차 사진이 아니면 걸지 않는다**(사장님 2026-08-20 「차량번호로 매칭이 안 되는 게 있다 ·
 *   없으면 매칭을 안 해야 한다」). 실측 2026-08-20 — 링크가 걸린 430대 가운데 101대가 남의 차였다:
 *   스타는 줄이 밀려 쏘렌토 줄에 GV70 폴더가 걸렸고, 이안카는 「137 2027 토레스」 폴더 하나를
 *   12대가 같이 쓰고 있었다. 이 스크립트는 사진링크 칸을 그대로 옮기기만 해서 그 어긋남을 셀에
 *   그대로 박아 넣었다. 그래서 걸기 전에 세 가지를 본다(어긋나면 건너뛰고 이유를 적는다).
 *     ① 드라이브 폴더·파일 «이름»에 차번이 있으면 그 줄 차번과 같아야 한다
 *     ② 같은 주소를 서로 다른 차가 쓰면 한 차 사진이 아니다(모델·날짜 묶음 폴더)
 *     ③ 열리지 않는(지워졌거나 권한 없는) 드라이브 주소는 걸지 않는다
 *   이름에 차번이 없는 «공급사 상세페이지 주소»는 지금까지처럼 통과시킨다 — 대조할 근거가 없다.
 *   이미 걸려 있는 어긋난 링크는 여기서 떼지 않는다(세는 것까지). 회수는 별도로 한다.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { countPlatesByUrl, driveIdOf, judgePhotoLink } from '../lib/domain/photo-link-guard';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply'); const WHO = (process.argv.find((a) => a.startsWith('--who=')) || '').slice(6);
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
  const runs = (c.textFormatRuns || []) as Rec[]; for (const r of runs) { const u = S(r.format?.link?.uri); if (u) return u; }
  const u2 = S(c.userEnteredFormat?.textFormat?.link?.uri); if (u2) return u2;
  const chips = (c.chipRuns || []) as Rec[]; for (const r of chips) { const u = S(r.chip?.richLinkProperties?.uri); if (u) return u; }
  return '';
};

/** 이름을 한 번만 물어보고 들고 있는다 — 한 폴더를 여러 줄이 가리킬 수 있다. */
const driveInfo = new Map<string, { name: string; ok: boolean }>();
const askDrive = async (id: string) => {
  if (driveInfo.has(id)) return driveInfo.get(id)!;
  let info = { name: '', ok: false };
  try {
    const r = await call(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,trashed&includeItemsFromAllDrives=true&supportsAllDrives=true`);
    info = { name: S(r.name), ok: r.trashed !== true };
  } catch { info = { name: '', ok: false }; }
  driveInfo.set(id, info);
  return info;
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));
let totalLink = 0, totalFill = 0, totalSkip = 0, totalStuck = 0;
for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  const reqs: Rec[] = []; const fills: { range: string; values: string[][] }[] = []; const notes: string[] = [];
  /** 한 시트의 줄을 다 모아 두고 «같은 주소를 여러 차가 쓰나»까지 본 뒤에 판정한다. */
  type Cand = { title: string; gid: number; rn: number; pi: number; li: number; plate: string; photo: string; cur: string };
  const cands: Cand[] = [];
  for (const p of tabs) {
    const title = S(p.title); const gid = p.sheetId;
    const grid = await call(`${SH}/${b.id}?ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}&includeGridData=true&fields=${encodeURIComponent('sheets(properties(sheetId,title),data(startRow,rowData(values(formattedValue,hyperlink,textFormatRuns(format(link)),userEnteredFormat(textFormat(link)),chipRuns(chip(richLinkProperties(uri)))))))')}`);
  const sheet = ((grid.sheets || []) as Rec[])[0]; if (!sheet) continue;
    const rowData = ((sheet.data || [])[0]?.rowData || []) as Rec[];
    const rows = rowData.map((r) => ((r.values || []) as Rec[]));
    const hi = rows.findIndex((r) => r.some((c) => norm(c.formattedValue) === '차량번호') && r.some((c) => norm(c.formattedValue) === '차명(세부모델+트림)')); if (hi < 0) continue;
    const hdr = rows[hi].map((c) => S(c.formattedValue)); const pi = hdr.findIndex((h) => norm(h) === '차량번호'); const li = hdr.findIndex((h) => norm(h) === '사진링크');
    if (pi < 0 || li < 0) { notes.push(`「${title}」 차량번호/사진링크 열 없음`); continue; }
    rows.slice(hi + 1).forEach((r, k) => {
      const rn = hi + 1 + k; const pc = r[pi]; const plate = S(pc?.formattedValue); if (!plate) return;
      cands.push({ title, gid, rn, pi, li, plate, photo: S(r[li]?.formattedValue), cur: linkOf(pc) });
    });
  }

  // ① 한 주소를 서로 다른 차가 쓰나 — 그러면 그건 그 차 사진이 아니다.
  const shared = countPlatesByUrl(cands.map((c) => ({ plate: c.plate, urls: [c.photo, c.cur] })));
  // ② 드라이브 대상 이름을 미리 물어 둔다.
  for (const c of cands) for (const u of [c.photo, c.cur]) { const id = driveIdOf(u); if (id) await askDrive(id); }
  /** 이 주소를 이 차에 걸어도 되나 — 되면 '', 안 되면 이유. */
  const why = (plate: string, url: string): string => {
    if (!isUrl(url)) return '';
    const id = driveIdOf(url);
    return judgePhotoLink(plate, url, id ? driveInfo.get(id) || { name: '', ok: false } : { name: '', ok: true }, shared.get(url) || 1).why;
  };

  let nLink = 0, nFill = 0; const skips: string[] = []; let stuck = 0;
  for (const c of cands) {
    if (isUrl(c.photo) && c.cur !== c.photo) {
      const bad = why(c.plate, c.photo);
      if (bad) { skips.push(`${c.plate} ${bad}`); continue; }
      reqs.push({ updateCells: { range: { sheetId: c.gid, startRowIndex: c.rn, endRowIndex: c.rn + 1, startColumnIndex: c.pi, endColumnIndex: c.pi + 1 }, rows: [{ values: [{ userEnteredFormat: { textFormat: { link: { uri: c.photo } } } }] }], fields: 'userEnteredFormat.textFormat.link' } }); nLink++;
    } else if (!c.photo && isUrl(c.cur)) {
      const bad = why(c.plate, c.cur);
      if (bad) { skips.push(`${c.plate} ${bad}`); continue; }
      fills.push({ range: `'${c.title.replace(/'/g, "''")}'!${colA1(c.li)}${c.rn + 1}`, values: [[c.cur]] }); nFill++;
    } else if (isUrl(c.photo) && c.cur === c.photo && why(c.plate, c.photo)) stuck++;   // 이미 걸린 어긋난 링크
  }
  notes.push(`링크 걸 차량번호 ${nLink} · 사진링크 채움 ${nFill}`);
  if (skips.length) notes.push(`걸지 않음 ${skips.length}(${skips.slice(0, 3).join(' · ')}${skips.length > 3 ? ' …' : ''})`);
  if (stuck) notes.push(`이미 걸린 어긋난 링크 ${stuck}`);
  totalLink += nLink; totalFill += nFill; totalSkip += skips.length; totalStuck += stuck;
  console.log(`■ ${b.label.padEnd(10)} ${notes.join(' · ')}`);
  if (APPLY) {
    for (let i = 0; i < reqs.length; i += 500) await call(`${SH}/${b.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs.slice(i, i + 500) }) });
    if (fills.length) await call(`${SH}/${b.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: fills }) });
    if (reqs.length || fills.length) console.log(`   ✓ 반영 링크 ${reqs.length} · 사진링크 ${fills.length}`);
    await sleep(300);
  }
}
console.log(`■ 합계 — 차량번호 링크 ${totalLink} · 사진링크 채움 ${totalFill} · 차번이 안 맞아 걸지 않음 ${totalSkip} · 이미 걸린 어긋난 링크 ${totalStuck} ${APPLY ? '(반영됨)' : '(dry-run, --apply 로 반영)'}`);
if (totalStuck) console.log('  ※ 이미 걸린 어긋난 링크는 여기서 떼지 않는다 — tmp/audit-plate-photo-match.mts 로 목록을 뽑아 회수한다.');
