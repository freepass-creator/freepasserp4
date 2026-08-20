/**
 * **재고 탭 값을 구글 시트 버전기록(revision)에서 되살린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-18 18:00) — `reformat-supplier-stock-tabs` 가 표(Table)를 `deleteTable` 로 지웠다 다시 만들었는데,
 *   구글의 deleteTable 은 «표 안의 값까지» 지운다. 22개 재고 탭의 표 안 열(차량번호~드롭다운 칸)이 통째로 비었다.
 *   드라이브 revision export(`/export?format=csv&gid=&revision=`)가 옛 값을 준다 — 마지막으로 값이 있던 revision 을 골라 되살린다.
 * ★**비어 있는 칸만 채운다.** 지금 값이 있는 칸(표 밖 열·그 뒤 미러가 쓴 값)은 그대로 둔다.
 * ★열은 이름으로 맞춘다(옛 revision 의 열 차례가 지금과 달라도 된다). 이름이 빈 옛 열은 같은 자리로 본다.
 * ⚠ 셀 메모·링크는 CSV 에 없다 — 우리캐피탈 장기보증 메모는 따로 되살린다(add-woori-notes).
 *
 *   npx tsx scripts/restore-stock-tabs-from-revision.mts
 *   npx tsx scripts/restore-stock-tabs-from-revision.mts --apply
 *   npx tsx scripts/restore-stock-tabs-from-revision.mts --apply --sheet=<ID>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, TEMPLATE_COLUMNS, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { parseDelimited } from '../lib/domain/sheet-import';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
/** 이 시각(UTC ISO) 이전의 revision 만 쓴다 — 지운 뒤에 잘린 revision 을 고르지 않게. */
const BEFORE = arg('before', '2026-08-18T08:45:00Z');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const tokOf = async () => (await jwt.getAccessToken()).token!;
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${await tokOf()}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
/** ⚠ export 는 가끔 CSV 대신 HTML(오류 페이지)을 200 으로 준다 — 그걸 표로 읽으면 «9줄짜리 헛 표»가 된다. HTML 이면 쉬었다 다시. */
const csvAt = async (id: string, gid: number, rev: string): Promise<string[][]> => {
  for (let n = 0; ; n++) {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}&revision=${rev}`, { headers: { Authorization: `Bearer ${await tokOf()}` } });
    const t = await r.text();
    const html = /^\s*<!DOCTYPE|<html/i.test(t.slice(0, 200));
    if (r.ok && !html) return parseDelimited(t).map((row) => row.map((c) => S(c)));
    if ((r.status === 429 || r.status >= 500 || html) && n < 6) { await sleep(8_000 * (n + 1)); continue; }
    throw new Error(`export ${r.status} ${html ? 'HTML' : t.slice(0, 120)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(S(f.name)) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
console.log(`■ 재고 탭 값 되살리기 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳 · revision 은 ${BEFORE} 이전 중 마지막\n`);
const report: string[] = [];
for (const t of targets) {
  const revs = ((await call(`https://www.googleapis.com/drive/v3/files/${t.id}/revisions?fields=revisions(id,modifiedTime)&pageSize=1000`)).revisions || []) as Rec[];
  const usable = revs.filter((r) => S(r.modifiedTime) < BEFORE).sort((a, b) => S(a.modifiedTime).localeCompare(S(b.modifiedTime)));
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const cur = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const grid = ((cur.values || []) as string[][]).map((r) => r.map(S));
    const hi = grid.findIndex((r) => r.some((c) => norm(c) === '차명(세부모델+트림)'));
    if (hi < 0) continue;
    const header = grid[hi];
    // 옛 revision — 마지막부터 거슬러 «차량번호가 있는 줄이 있는» 첫 것(표 안 열이 비어 있던 revision 은 건너뛴다)
    let old: string[][] | null = null; let usedRev = '';
    for (let i = usable.length - 1; i >= 0 && i >= usable.length - 14; i--) {
      let rows: string[][];
      try { rows = await csvAt(t.id, Number(p.sheetId), S(usable[i].id)); } catch (e) { console.log(`     (rev ${usable[i].id} export 실패 — ${String((e as Error).message).slice(0, 60)})`); continue; }
      const oh = rows.findIndex((r) => r.some((c) => norm(c) === '차명(세부모델+트림)'));
      if (oh < 0) continue;
      const opl = rows[oh].findIndex((c) => norm(c) === '차량번호');
      const body = rows.slice(oh + 1).filter((r) => r.some(Boolean));
      const plates = opl >= 0 ? body.filter((r) => S(r[opl])).length : 0;
      if (plates > 0) { old = rows.slice(oh); usedRev = `${usable[i].id}@${S(usable[i].modifiedTime).slice(5, 16)}`; break; }
    }
    if (!old) { report.push(`${t.name}「${title}」 — 값 있는 revision 없음(원래 빈 탭이었을 수 있음)`); console.log(`  · ${t.name}「${title}」 옛 값 없음`); continue; }
    const oldHdr = old[0].map(S);
    // 지금 머리행에 빈 칸이 있으면 표준 차례 이름으로 메운다(실측: 웰릭스 K·L = 주행거리·연료 가 비어 있었다)
    const headerFixes: { range: string; values: string[][] }[] = [];
    header.forEach((h, i) => { if (!h && TEMPLATE_COLUMNS[i] && header[i - 1] === TEMPLATE_COLUMNS[i - 1]?.name) { header[i] = TEMPLATE_COLUMNS[i].name; headerFixes.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(i)}${hi + 1}`, values: [[TEMPLATE_COLUMNS[i].name]] }); } });
    // 지금 탭에 차량번호가 하나도 없으면(통째로 지워진 탭) 본문을 비우고 옛 줄 순서 그대로 쓴다 — 반쪽 복원 위에 겹치지 않게
    const curPlateCount = grid.slice(hi + 1).filter((r) => S(r[header.findIndex((h) => norm(h) === '차량번호')])).length;
    const wipeBody = curPlateCount === 0;
    // 열 대응 — 이름으로, 빈 이름은 같은 자리로
    const at = new Map<string, number>(); header.forEach((h, i) => { if (h && !at.has(norm(h))) at.set(norm(h), i); });
    const map: (number | -1)[] = oldHdr.map((h, i) => (h ? (at.get(norm(h)) ?? -1) : (i < header.length && !oldHdr.some((x, j) => j !== i && x && norm(x) === norm(header[i])) ? i : -1)));
    const unmatched = oldHdr.filter((h, i) => h && map[i] < 0);
    const writes: { range: string; values: string[][] }[] = [];
    let filled = 0, kept = 0;
    // 옛 줄을 지금 줄에 «차량번호»로 맞춘다 — 없으면 옛 줄 순서대로 빈 줄에
    const plateAt = at.get('차량번호') ?? 0;
    const oldPlateAt = oldHdr.findIndex((h) => norm(h) === '차량번호');
    const curPlateRow = new Map<string, number>();
    grid.slice(hi + 1).forEach((r, k) => { const pl = norm(r[plateAt]); if (pl && !curPlateRow.has(pl)) curPlateRow.set(pl, hi + 1 + k); });
    let nextFree = hi + 1;
    const usedRows = new Set<number>(curPlateRow.values());
    const bodyOld = old.slice(1).filter((r) => r.some(Boolean));
    for (const orow of bodyOld) {
      const pl = oldPlateAt >= 0 ? norm(orow[oldPlateAt]) : '';
      let rowIdx = pl ? curPlateRow.get(pl) : undefined;
      if (rowIdx === undefined) { while (usedRows.has(nextFree) || (!wipeBody && (grid[nextFree] || []).some((c) => S(c)))) nextFree++; rowIdx = nextFree; usedRows.add(rowIdx); nextFree++; }
      const curRow = wipeBody ? [] : (grid[rowIdx] || []);
      orow.forEach((v, oi) => {
        const ci = map[oi]; if (ci < 0 || !S(v)) return;
        if (S(curRow[ci])) { kept++; return; }
        writes.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(ci)}${rowIdx + 1}`, values: [[v]] }); filled++;
      });
    }
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 옛 ${bodyOld.length}줄(rev ${usedRev}) · 지금 차번 ${curPlateRow.size}줄${wipeBody ? '(본문 비우고 통째 복원)' : ''} · 채울 칸 ${filled} · 있는 칸 둠 ${kept}${headerFixes.length ? ` · 머리행 메움 ${headerFixes.length}` : ''}${unmatched.length ? ` · 못 맞춘 옛 열: ${unmatched.join('·')}` : ''}`);
    report.push(`${t.name}「${title}」 옛 ${bodyOld.length}줄 rev ${usedRev} 채움 ${filled}`);
    if (!APPLY || (!writes.length && !headerFixes.length)) continue;
    if (wipeBody) await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A${hi + 2}:BZ${Math.max(600, grid.length + 5)}`)}:clear`, { method: 'POST', body: '{}' });
    if (headerFixes.length) await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: headerFixes }) });
    for (let i = 0; i < writes.length; i += 800) {
      await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes.slice(i, i + 800) }) });
    }
    await sleep(1500);
  }
}
writeFileSync('tmp/restore-stock-tabs-report.txt', report.join('\n'));
console.log(`\n  ${APPLY ? '반영 끝' : '※ dry-run. 반영은 --apply'} · 보고 tmp/restore-stock-tabs-report.txt`);
