/**
 * **재고 탭 앞칸(차량번호~연료)을 구글 버전기록에서 «같은 줄»로 되살린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사고(2026-08-18 16:51~16:58) — `reformat-supplier-stock-tabs` 가 표(Table)를 deleteTable 로 지웠다 다시 만들었고,
 *   구글의 deleteTable 은 **표 안의 값까지 지운다.** 21곳 22개 재고 탭의 A~L(차량번호·입고일자·상태·분류·제조사·차명(트림)·옵션·
 *   외부색상·내부색상·연식·주행거리·연료)이 비었다. 그 오른쪽(배기량·차량가격·대여료·정책코드·정제칸)은 그대로다 — **줄 자리는 안 바뀌었다.**
 * ★그래서 «차량번호로 맞추기»가 아니라 **줄 번호로 맞춘다** — 옛 revision 의 k번째 줄 = 지금 k번째 줄. 맞는지는 남아 있는 칸으로 검증한다
 *   (배기량·차량가격·대여료·정책코드·정제칸 가운데 양쪽에 값이 있는 칸이 하나 이상 같아야 쓴다). 하나라도 다르면 그 줄은 안 쓰고 보고한다.
 *   ⚠ 「차량번호로 맞춰서 없으면 빈 줄에 붙인다」 방식(restore-stock-tabs-from-revision 1판)은 차번이 전부 비어 있어 **줄을 아래에 통째로 복제**한다
 *     (웰릭스 실측 24→47줄). 그렇게 붙은 줄은 이 스크립트가 찾아 지운다(`--prune-dupes`).
 * ★revision 은 «차량번호 칸에 값이 있는» 마지막 것(빈 값이 아니라). 빈 칸만 채운다 — 지금 값이 있는 칸은 안 건드린다.
 * ⚠ CSV 에는 메모·링크가 없다. 사진링크(AB)는 값이라 살아난다. 셀 메모(우리캐피탈 장기보증)는 add-woori-notes 로.
 *
 *   npx tsx scripts/restore-stock-rows-by-index.mts
 *   npx tsx scripts/restore-stock-rows-by-index.mts --apply
 *   npx tsx scripts/restore-stock-rows-by-index.mts --apply --sheet=<ID> --prune-dupes
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { parseDelimited } from '../lib/domain/sheet-import';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const num = (v: unknown) => S(v).replace(/[,\s원]/g, '');
const APPLY = process.argv.includes('--apply');
const PRUNE = process.argv.includes('--prune-dupes');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
/** 사고(표 삭제) 시작 시각 — 이 이전 revision 중 차량번호가 있는 마지막 것을 쓴다. 뒤 revision 은 반쯤 복구된 상태일 수 있다. */
const BEFORE = arg('before', '2026-08-18T07:51:00Z');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
/** 검증에 쓰는 «남아 있던» 칸 — 값이 숫자면 콤마를 떼고 견준다. */
// ⚠ 최초등록일은 뺐다 — 서식이 날아가 「44026」(날짜 일련번호)로 보여 옛 「2020-07-14」와 글자가 다르다(값은 같다).
const VERIFY_COLS = ['배기량', '차량가격', '단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월', '72개월', '84개월', '정책코드', '사진링크', '차종코드', '제조사(정제)', '모델', '세부모델', '세부트림', '선택옵션', '외장색상', '내장색상', '배기량(정제)', '연료(정제)', '차종분류'];
const same = (a: string, b: string) => norm(a) === norm(b) || (num(a) !== '' && num(a) === num(b));

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
const csvAt = async (id: string, gid: number, rev: string): Promise<string[][]> => {
  for (let n = 0; ; n++) {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}&revision=${rev}`, { headers: { Authorization: `Bearer ${await tokOf()}` } });
    const t = await r.text();
    if (r.ok) return parseDelimited(t).map((row) => row.map((c) => S(c)));
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(10_000 * (n + 1)); continue; }
    throw new Error(`export ${r.status} ${t.slice(0, 120)}`);
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
console.log(`■ 재고 탭 앞칸 «같은 줄» 되살리기 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳\n`);
const report: string[] = [];
let totalFilled = 0, totalBad = 0;
for (const t of targets) {
  const revsAll = ((await call(`https://www.googleapis.com/drive/v3/files/${t.id}/revisions?fields=revisions(id,modifiedTime)&pageSize=1000`)).revisions || []) as Rec[];
  const revs = revsAll.filter((r) => S(r.modifiedTime) < BEFORE).sort((a, b) => S(a.modifiedTime).localeCompare(S(b.modifiedTime)));
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const cur = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ900`)}`) as { values?: string[][] };
    const grid = ((cur.values || []) as string[][]).map((r) => r.map(S));
    const hi = grid.findIndex((r) => r.some((c) => norm(c) === '차명(트림)'));
    if (hi < 0) continue;
    const header = grid[hi];
    const at = new Map<string, number>(); header.forEach((h, i) => { if (h && !at.has(norm(h))) at.set(norm(h), i); });
    const plateAt = at.get('차량번호') ?? 0;
    // 지금 값이 있는 줄(머리행 아래) — 앞칸이 비었어도 오른쪽 칸이 있는 줄이 «사고 난 줄»이다.
    const curBody = grid.slice(hi + 1);
    const curPlates = curBody.filter((r) => S(r[plateAt])).length;
    // 옛 revision — 마지막부터 거슬러 «차량번호 칸에 값이 있는» 첫 것
    let old: string[][] | null = null; let usedRev = '';
    for (let i = revs.length - 1; i >= 0 && i >= revs.length - 12; i--) {
      let rows: string[][];
      try { rows = await csvAt(t.id, Number(p.sheetId), S(revs[i].id)); } catch (e) { console.log(`     (rev ${S(revs[i].id)} export 실패 — ${String((e as Error).message).slice(0, 60)})`); continue; }
      const oh = rows.findIndex((r) => r.some((c) => norm(c) === '차명(트림)'));
      if (oh < 0) continue;
      const ohdr = rows[oh];
      const opAt = ohdr.findIndex((h) => norm(h) === '차량번호');
      const body = rows.slice(oh + 1);
      const plates = opAt >= 0 ? body.filter((r) => S(r[opAt])).length : 0;
      if (plates > 0) { old = rows.slice(oh); usedRev = `${revs[i].id}@${S(revs[i].modifiedTime).slice(5, 16)}`; break; }
    }
    if (!old) { report.push(`${t.name}「${title}」 — 차량번호 있는 revision 없음`); console.log(`  · ${t.name}「${title}」 옛 값 없음`); continue; }
    const oldHdr = old[0].map(S);
    const oat = new Map<string, number>(); oldHdr.forEach((h, i) => { if (h && !oat.has(norm(h))) oat.set(norm(h), i); });
    const oldBody = old.slice(1);
    // 옛 줄 뒤쪽의 완전 빈 줄은 뗀다(CSV 는 서식만 있는 줄도 준다)
    while (oldBody.length && !oldBody[oldBody.length - 1].some(Boolean)) oldBody.pop();
    const writes: { range: string; values: string[][] }[] = [];
    let filled = 0, ok = 0, bad = 0, unverifiable = 0, alreadyPlate = 0;
    const badRows: string[] = [];
    // ★줄 번호로 맞춘다 — 옛 k번째 = 지금 k번째. 남아 있는 칸으로 검증.
    for (let k = 0; k < oldBody.length; k++) {
      const orow = oldBody[k]; const crow = curBody[k] || [];
      if (!orow.some(Boolean)) continue;
      if (S(crow[plateAt])) { alreadyPlate++; continue; }             // 이미 차번이 있다 — 사고 안 난 줄(또는 이미 복구)
      let comparable = 0, mismatch = 0;
      for (const name of VERIFY_COLS) {
        const ci = at.get(norm(name)); const oi = oat.get(norm(name));
        if (ci === undefined || oi === undefined) continue;
        const a = S(crow[ci]); const b = S(orow[oi]);
        if (!a || !b) continue;
        comparable++;
        if (!same(a, b)) mismatch++;
      }
      if (mismatch) { bad++; badRows.push(`${hi + 2 + k}행(옛 ${S(orow[oat.get('차량번호') ?? 0])}) 불일치 ${mismatch}/${comparable}`); continue; }
      if (!comparable) {
        // 견줄 칸이 없다 — 지금 줄이 통째로 비었으면 옛 줄이 그 자리에 있던 것으로 본다(줄 수가 같을 때만).
        if (crow.some(Boolean) || oldBody.length !== curBody.filter((r) => r.some(Boolean)).length) { unverifiable++; continue; }
      }
      ok++;
      oldHdr.forEach((h, oi) => {
        if (!h) return;
        const ci = at.get(norm(h)); if (ci === undefined) return;
        const v = S(orow[oi]); if (!v || S(crow[ci])) return;
        writes.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(ci)}${hi + 2 + k}`, values: [[v]] }); filled++;
      });
    }
    // 1판 복구(restore-stock-tabs-from-revision)가 아래에 붙인 복제 줄 — 옛 줄 수보다 뒤에 있고 차번이 없으며,
    // 오른쪽 검증칸이 «옛 줄 수만큼 위의 줄»과 똑같은 줄(웰릭스 실측: 25행 = 2행의 오른쪽 복사).
    const dupes: number[] = [];
    for (let k = oldBody.length; k < curBody.length; k++) {
      const r = curBody[k]; if (S(r[plateAt]) || !r.some(Boolean)) continue;
      const src = curBody[k - oldBody.length] || [];
      let comparable = 0, diff = 0;
      for (const n of VERIFY_COLS) { const ci = at.get(norm(n)); if (ci === undefined) continue; const a = S(r[ci]), b = S(src[ci]); if (!a && !b) continue; comparable++; if (!same(a, b)) diff++; }
      if (comparable && !diff) dupes.push(hi + 1 + k);
    }
    const line = `${t.name.padEnd(10)} 「${title}」 옛 ${oldBody.length}줄(rev ${usedRev}) · 지금 ${curBody.filter((r) => r.some(Boolean)).length}줄(차번 있는 줄 ${curPlates}) · 맞춘 줄 ${ok} · 채울 칸 ${filled}${alreadyPlate ? ` · 이미 차번 ${alreadyPlate}` : ''}${bad ? ` · ⚠ 불일치 ${bad}` : ''}${unverifiable ? ` · 못 견줌 ${unverifiable}` : ''}${dupes.length ? ` · 복제 줄 ${dupes.length}(${dupes[0] + 1}~${dupes[dupes.length - 1] + 1}행)` : ''}`;
    console.log(`  ${APPLY ? '✓' : '→'} ${line}`);
    for (const b of badRows.slice(0, 5)) console.log(`       ${b}`);
    report.push(line);
    totalFilled += filled; totalBad += bad;
    if (!APPLY) continue;
    for (let i = 0; i < writes.length; i += 800) {
      await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes.slice(i, i + 800) }) });
    }
    if (PRUNE && dupes.length) {
      // 뒤에서부터 지운다(앞을 지우면 번호가 밀린다). 연속 구간이면 한 번에.
      const sorted = [...dupes].sort((a, b) => b - a);
      const reqs: Rec[] = [];
      let end = sorted[0] + 1, start = sorted[0];
      for (let i = 1; i <= sorted.length; i++) {
        if (i < sorted.length && sorted[i] === start - 1) { start = sorted[i]; continue; }
        reqs.push({ deleteDimension: { range: { sheetId: p.sheetId, dimension: 'ROWS', startIndex: start, endIndex: end } } });
        if (i < sorted.length) { end = sorted[i] + 1; start = sorted[i]; }
      }
      await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
      console.log(`       복제 줄 ${dupes.length}개 지움`);
    }
    await sleep(1200);
  }
}
writeFileSync('tmp/restore-stock-rows-by-index-report.txt', report.join('\n'));
console.log(`\n  ${APPLY ? '반영 끝' : '※ dry-run. 반영은 --apply'} — 채울 칸 ${totalFilled}${totalBad ? ` · ⚠ 불일치 줄 ${totalBad}(안 씀)` : ''} · 보고 tmp/restore-stock-rows-by-index-report.txt`);
