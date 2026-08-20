/**
 * **재고 탭에 구분선 열 「│」를 넣고 정책코드를 정제칸 바로 앞으로 옮긴다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「정책코드를 차종코드 앞으로 옮겨 주고, 정책코드 앞에 한 줄 넣어서 여기는 손대는 거 아닌 느낌이 들게 — 전체 통일」
 *   결과 차례: … 최초등록일 | 사진링크 | **│** | 정책코드 | 차종코드 | 제조사(정제) | … (표준 `TEMPLATE_COLUMNS` 2026-08-18)
 * ★열을 **넣고 옮기기만** 한다(insertDimension · moveDimension) — 값·서식·드롭다운이 열과 함께 간다. 셀을 다시 쓰지 않는다.
 *   구분선 열은 어두운 보라 한 줄(폭 6px, 값 없음), 머리는 보라(프리패스 칸 색).
 * ★정제시트 4곳은 기본 제외(사장님 「너는 우리 제공 시트만」) — `--include-mirror`.
 * ⚠ 표(Table)는 안 건드린다(deleteTable 금지). 구분선·정책코드·정제칸은 표 밖이라 옮겨도 표에 영향이 없다.
 *
 *   npx tsx scripts/insert-divider-column.mts
 *   npx tsx scripts/insert-divider-column.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { DIVIDER_COLUMN, SHEET_NAME_MATCH, buildDividerFormat, buildHeaderOwnerColors, isDividerColumn, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

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
let targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(S(f.name)) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  targets = excludeMirrorSheets(targets);
}
console.log(`■ 구분선 열 넣기 + 정책코드 이동 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳`);
const AI_FIRST = '차종코드';   // 정제칸 첫 열(엔카 코드 2칸이 정책코드와 이 열 사이에 온다)
let done = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden,gridProperties(columnCount,rowCount))`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    let hdr = (((await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ1`)}`) as { values?: string[][] }).values || [])[0] || []).map(S);
    if (!hdr.some((c) => norm(c) === '차명(세부모델+트림)')) continue;
    const gid = p.sheetId;
    const steps: string[] = [];
    const reqs: Rec[] = [];
    // ① 구분선 열이 없으면 정제칸 첫 열(차종코드) 앞에 넣는다(없으면 맨 뒤)
    let divAt = hdr.findIndex(isDividerColumn);
    if (divAt < 0) {
      const aiAt = hdr.findIndex((h) => norm(h) === norm(AI_FIRST));
      const at = aiAt >= 0 ? aiAt : hdr.length;
      reqs.push({ insertDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, inheritFromBefore: false } });
      hdr = [...hdr.slice(0, at), DIVIDER_COLUMN.name, ...hdr.slice(at)];
      divAt = at; steps.push(`구분선 ${colA1(at)}열 삽입`);
    }
    // ② 정책코드를 구분선 바로 뒤로
    const polAt = hdr.findIndex((h) => norm(h) === '정책코드');
    if (polAt >= 0 && polAt !== divAt + 1) {
      const dest = polAt < divAt ? divAt + 1 : divAt + 1;   // moveDimension destinationIndex 는 «옮기기 전» 기준
      reqs.push({ moveDimension: { source: { sheetId: gid, dimension: 'COLUMNS', startIndex: polAt, endIndex: polAt + 1 }, destinationIndex: dest } });
      const name = hdr[polAt]; hdr.splice(polAt, 1); const newDiv = hdr.findIndex(isDividerColumn); hdr.splice(newDiv + 1, 0, name);
      steps.push(`정책코드 → 구분선 뒤`);
    }
    if (!reqs.length && hdr[divAt + 1] && norm(hdr[divAt + 1]) === '정책코드') { console.log(`  · ${t.name.padEnd(10)} 「${title}」 이미 규격`); continue; }
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 ${steps.join(' · ')} → … ${hdr.slice(Math.max(0, hdr.findIndex(isDividerColumn) - 2), hdr.findIndex(isDividerColumn) + 4).join(' | ')} …`);
    if (!APPLY) continue;
    if (reqs.length) await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
    // ③ 머리글·서식 — 구분선 이름, 보라 머리, 어두운 줄, 폭
    const dAt = hdr.findIndex(isDividerColumn);
    await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(dAt)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[DIVIDER_COLUMN.name]] }) });
    const cols = hdr.map((name) => ({ name }));
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
      ...buildDividerFormat(gid, cols, Number(p.gridProperties?.rowCount) || 500),
      ...buildHeaderOwnerColors(gid, cols),
      { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: dAt, endColumnIndex: dAt + 1 }, cell: { note: DIVIDER_COLUMN.note }, fields: 'note' } },
    ] }) });
    done++; await sleep(1500);
  }
}
console.log(APPLY ? `  반영 탭 ${done}` : '※ dry-run. 반영은 --apply');
