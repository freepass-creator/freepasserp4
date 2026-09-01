/**
 * **공급사 「회사정보」 탭의 입금계좌를 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-25) — 사장님 「전 렌터카 계좌가 사라졌음 · 상품리스트에 반영해줘야하는데」.
 *   실측하니 판매시트 「전용계좌」가 **18곳 전부 빈칸**이고 회사정보 탭도 **20곳 전부 예시 문구뿐**이다.
 *   계좌는 원래 옛 공급사 시트 재고탭의 «열»이었다. 2026-08-14 에 그걸 정책 탭으로 옮겼는데,
 *   2026-08-19 사장님 「정책에 계좌는 빼자 · 통장사본 받아서 업로드」로 정책에서 폐지했다
 *   (`POLICY_RETIRED_FIELDS`). 옮겨 갈 자리는 회사정보라고 적어 두고 **배선을 안 했다** —
 *   그래서 값이 통째로 사라졌다. 여기가 그 자리를 채우는 도구다.
 *
 * ★값의 출처는 `tmp/old-account-note.json`(판매시트 옛 발행분에서 뽑은 것)이고,
 *   짐작이 섞이지 않게 **아래 표에 손으로 옮겨 적었다.** 대수는 그 계좌로 나가던 차 수다.
 * ⚠ **이미 값이 있는 칸은 안 덮는다.** 공급사가 직접 고쳤을 수 있다.
 * ⚠ 계좌가 여럿인 곳(KH·빌린카)은 **주계좌만 넣고 나머지는 목록으로 남긴다.**
 *   짝을 짐작해 붙이면 영업자가 엉뚱한 계좌로 입금을 안내한다 — 돈이 잘못 가는 사고다.
 *
 *   npx tsx scripts/fill-company-account.mts
 *   npx tsx scripts/fill-company-account.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Acct = { 공급사: string; 은행: string; 계좌번호: string; 예금주: string; 대수: number };
/** ★주계좌 — 회사정보 탭에 들어간다. 출처: 옛 판매시트 발행분(tmp/old-account-note.json). */
const MAIN: Acct[] = [
  { 공급사: '제이앤제이렌트카', 은행: '신한', 계좌번호: '100-024-629331', 예금주: '(주)제이앤제이렌트카', 대수: 7 },
  { 공급사: 'KH', 은행: '기업은행', 계좌번호: '486-061377-04-043', 예금주: 'KH렌트카', 대수: 11 },
  { 공급사: '에스에이', 은행: '우리', 계좌번호: '1005-402-748053', 예금주: '(주)에스에이렌터카', 대수: 30 },
  { 공급사: '경진카', 은행: '농협', 계좌번호: '301-0307-0388-11', 예금주: '경진카(주)', 대수: 3 },
  { 공급사: '렌트존', 은행: '우리', 계좌번호: '1005-001-948600', 예금주: '(주)렌트존', 대수: 6 },
  { 공급사: '리더스', 은행: '국민은행', 계좌번호: '337101-04-215464', 예금주: '리더스렌트카', 대수: 6 },
  { 공급사: '빌린카', 은행: '국민', 계좌번호: '975901-00-074193', 예금주: '(주)빌린카', 대수: 21 },
  { 공급사: '센트로', 은행: '신한', 계좌번호: '140-011-380331', 예금주: '(주)센트로렌트카', 대수: 2 },
  { 공급사: '손오공', 은행: '신한', 계좌번호: '100-032-471576', 예금주: '(주)손오공렌터카', 대수: 9 },
  { 공급사: '스타', 은행: '기업은행', 계좌번호: '141-066418-04-025', 예금주: '(주) 스타스카이', 대수: 16 },
  { 공급사: '우리캐피탈', 은행: '국민', 계좌번호: '274101-04-182593', 예금주: '우리캐피탈렌터카(주)', 대수: 19 },
  { 공급사: '웰릭스', 은행: '신한', 계좌번호: '140-013-750928', 예금주: '웰릭스모빌리티(주)', 대수: 1 },
  { 공급사: '이안카', 은행: '우리은행', 계좌번호: '1005-703-740308', 예금주: '(주)이안카', 대수: 77 },
  { 공급사: '퍼시픽', 은행: '신한은행', 계좌번호: '140-015-656880', 예금주: '퍼시픽모빌리티㈜', 대수: 1 },
];

/** ★주계좌 말고 더 있는 것 — 어느 정책·어느 지점에 붙는지는 그 집만 안다. 사람이 정한다. */
const EXTRA: { 공급사: string; 값: string; 대수: number; 무엇: string }[] = [
  { 공급사: 'KH', 값: '기업은행 486-052465-01-014 KH홀딩스', 대수: 0, 무엇: '보증금계좌 — 대여료 계좌와 다르다' },
  { 공급사: '빌린카', 값: '하나 634-910022-15404 (주) 빌린카(영업소)', 대수: 13, 무엇: '영업소' },
  { 공급사: '빌린카', 값: '신한 100-034-538803 (주)손오공렌트카(대전지점)', 대수: 12, 무엇: '대전지점 — 예금주가 손오공이다' },
  { 공급사: '경진', 값: '농협 301-0149-2013-71 경진렌트카(주)', 대수: 1, 무엇: '경진렌트카(주) — 경진카(주)와 다른 법인' },
];

/** ★옛 시트에도 계좌가 없던 곳. 받아야 한다. */
const MISSING = ['아이카', '아이언', '에코렌트카', '스위치플랜', '연카', '오토플러스'];

/**
 * ★**법인이 여럿인 곳 — 정책 줄에는 안 쓴다.**
 *   빌린카는 (주)빌린카 21대 · 영업소 13대 · 손오공렌트카(대전지점) 12대로 계좌가 셋이고,
 *   경진카 문서에는 경진카(주)와 경진렌트카(주) 두 법인이 들어 있다.
 *   어느 계좌가 어느 정책인지는 그 집만 안다 — 짐작해 붙이면 **영업자가 엉뚱한 계좌로 안내한다.**
 *   회사정보에는 주계좌를 적어 두되, 정책 줄은 사람이 정할 때까지 비워 둔다.
 */
const MULTI_ENTITY = ['빌린카', '경진카'];

/**
 * ★**문패 명부** — 발행기(`publish-origin-tab`)는 정책을 «문패 시트»에서 먼저 읽는다.
 *   우리 「○○ 프리패스 재고」 책은 문패가 아닐 때만 대타로 쓰인다.
 *   실측 2026-08-25 — 렌트존은 문패가 공급사 자기 시트라, 우리 책에만 계좌를 써 놓고
 *   발행했더니 판매시트가 그대로 빈칸이었다. **문패가 다르면 거기에도 쓴다.**
 */
const REGISTRY = '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY';

/** 정책 탭의 계좌 칸 이름과, 그 앞에 설 열. `policy-sheet-layout.ts` 와 같아야 한다. */
const POLICY_ACCOUNT = '전용계좌';
const POLICY_AFTER = '특이사항';
/** 한 줄로 이어 적는다 — 옛 판매시트가 보여 주던 그 모양이다(「신한 100-024-629331 (주)…」). */
const oneLine = (a: Acct) => [a.은행, a.계좌번호, a.예금주].map(S).filter(Boolean).join(' ');

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '').replace(/렌터카|렌트카|모빌리티|주식회사|\(주\)|㈜/g, '');
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(5_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 160)}`);
  }
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as any[])
  .map((f) => ({ id: S(f.id), name: S(f.name), label: supplierSheetLabel(S(f.name)) }))
  .filter((b) => !/구버전|폐기/.test(b.name));

/** 문패 명부 — 공급사명 → 시트 id. 이름으로 견준다. */
const signboard = new Map<string, string>();
{
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${REGISTRY}?fields=sheets.properties(title)`);
  const t = ((meta.sheets || []) as any[]).map((x) => S(x.properties.title))[0];
  const got = await call(`https://sheets.googleapis.com/v4/spreadsheets/${REGISTRY}/values/${encodeURIComponent(`${a1(t)}!A1:C80`)}`);
  for (const r of ((got.values || []) as any[][]).slice(1)) {
    const nm = S((r || [])[0]);
    const id = /\/d\/([\w-]+)/.exec(S((r || [])[2]))?.[1] || '';
    if (nm && id) signboard.set(norm(nm), id);
  }
}

type Put = { label: string; id: string; tab: string; row: number; field: string; from: string; to: string };
const puts: Put[] = [];
const skipped: string[] = [];
const noBook: string[] = [];
/** 정책 탭에 쓸 것 — 열을 만들어야 하면 `newCol` 이 참이다. */
type PolPut = { label: string; id: string; tab: string; gid: number; col: number; newCol: boolean; rows: number[]; value: string };
const pols: PolPut[] = [];
const polSkip: string[] = [];

console.log(`\n■ 회사정보 입금계좌 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
for (const a of MAIN) {
  // ★이름으로 찾는다. 「(주)·렌터카」 같은 꼬리는 떼고 견준다.
  const b = books.find((x) => norm(x.label) === norm(a.공급사)) || books.find((x) => norm(x.label).includes(norm(a.공급사)));
  if (!b) { noBook.push(a.공급사); continue; }
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(title)`);
  const tab = ((meta.sheets || []) as any[]).map((s) => S(s.properties.title)).find((t) => /회사정보/.test(t));
  if (!tab) { noBook.push(`${a.공급사} — 회사정보 탭 없음`); continue; }
  const got = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${a1(tab)}!A1:C80`)}?valueRenderOption=FORMATTED_VALUE`);
  const rows = ((got.values || []) as any[][]).map((r) => (r || []).map(S));
  const line: string[] = [];
  for (const field of ['은행', '계좌번호', '예금주'] as const) {
    // ★항목은 이름으로 찾는다. 줄이 하나 늘면 자리는 바로 어긋난다.
    const at = rows.findIndex((r) => S(r[0]) === field);
    if (at < 0) { line.push(`${field} 칸 없음`); continue; }
    const from = S(rows[at][1]);
    const to = a[field];
    if (from === to) continue;
    if (from) { skipped.push(`${b.label} ${field} — 이미 「${from}」 이 있다`); continue; } // ⚠ 안 덮는다
    puts.push({ label: b.label, id: b.id, tab, row: at, field, from, to });
    line.push(`${field}=${to}`);
  }
  console.log(`   ${b.label.padEnd(14)} ${a.대수 ? `${String(a.대수).padStart(3)}대  ` : '      '}${line.join(' · ') || '(바꿀 것 없음)'}`);

  // ── 정책 탭에도 같은 값을 이어 적는다 — 판매시트 「전용계좌」가 여기를 읽는다 ──
  if (MULTI_ENTITY.some((m) => norm(b.label).includes(norm(m)))) {
    polSkip.push(`${b.label} — 법인이 여럿이라 정책 줄은 사람이 정한다`);
    continue;
  }
  // ★문패 시트가 우리 책과 다르면 **둘 다** 쓴다. 발행기는 문패를 먼저 본다.
  const sign = signboard.get(norm(a.공급사)) || signboard.get(norm(b.label)) || '';
  const targets = [...new Set([b.id, ...(sign && sign !== b.id ? [sign] : [])])];
  const value = oneLine(a);
  for (const id of targets) {
    const where = id === b.id ? '우리 책' : '문패';
    const pmeta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`);
    const pol = ((pmeta.sheets || []) as any[]).map((x) => x.properties).find((x: any) => /정책/.test(S(x.title)));
    if (!pol) { polSkip.push(`${b.label}(${where}) — 정책 탭 없음`); continue; }
    const ptab = S(pol.title);
    const pgot = await call(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${a1(ptab)}!A1:CZ80`)}?valueRenderOption=FORMATTED_VALUE`);
    const prows = ((pgot.values || []) as any[][]).map((r) => (r || []).map(S));
    const phead = prows[0] || [];
    const iName = phead.indexOf('정책명');
    // ★있는 자리를 쓰고, 없으면 「특이사항」 뒤에 새로 만든다. 짐작해 가운데 끼우지 않는다.
    let col = phead.indexOf(POLICY_ACCOUNT);
    const newCol = col < 0;
    if (newCol) { const after = phead.indexOf(POLICY_AFTER); col = after >= 0 ? after + 1 : phead.length; }
    const rowsToFill: number[] = [];
    for (let r = 1; r < prows.length; r++) {
      if (iName >= 0 && !S(prows[r][iName])) continue;           // 빈 줄
      if (!newCol && S(prows[r][col])) continue;                  // ⚠ 있는 값은 안 덮는다
      rowsToFill.push(r);
    }
    if (!rowsToFill.length) { polSkip.push(`${b.label}(${where}) — 채울 정책 줄이 없다`); continue; }
    pols.push({ label: `${b.label}(${where})`, id, tab: ptab, gid: Number(pol.sheetId), col, newCol, rows: rowsToFill, value });
  }
}

console.log(`\n   채울 칸 ${puts.length}${skipped.length ? ` · 이미 있어 건너뜀 ${skipped.length}` : ''}`);
if (noBook.length) console.log(`   ⛔ 시트를 못 찾음 — ${noBook.join(' · ')}`);
for (const s of skipped) console.log(`      · ${s}`);

const newCols = pols.filter((p) => p.newCol).length;
console.log(`   정책 줄 — ${pols.length}곳 ${pols.reduce((a, p) => a + p.rows.length, 0)}줄${newCols ? ` (열을 새로 만들 곳 ${newCols})` : ''}`);
for (const t of polSkip) console.log(`      · ${t}`);

console.log(`\n  ── 사람이 정해야 할 계좌 ${EXTRA.length}건 — 주계좌 말고 더 있다`);
for (const e of EXTRA) console.log(`     ${e.공급사.padEnd(8)} ${e.값.padEnd(46)} ${e.대수 ? `${e.대수}대 ` : ''}${e.무엇}`);
console.log(`\n  ── 옛 시트에도 계좌가 없는 곳 ${MISSING.length} — 공급사에 받아야 한다`);
console.log(`     ${MISSING.join(' · ')}`);

writeFileSync('tmp/company-account.json', JSON.stringify({ puts: puts.length, skipped, noBook, extra: EXTRA, missing: MISSING }, null, 2));
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }
if (!puts.length && !pols.length) { console.log('\n※ 채울 것이 없다.\n'); process.exit(0); }

for (const p of puts) {
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${p.id}/values/${encodeURIComponent(`${a1(p.tab)}!B${p.row + 1}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[p.to]] }),
  });
}
console.log(`   ✓ 회사정보 ${puts.length}칸`);

const colA1 = (i: number) => { let t = '', k = i + 1; while (k > 0) { const r = (k - 1) % 26; t = String.fromCharCode(65 + r) + t; k = Math.floor((k - 1) / 26); } return t; };
let polCells = 0;
for (const p of pols) {
  if (p.newCol) {
    // ★열을 끼우고 머리글을 적는다. 값 열 사이에 끼우는 것이라 기존 값은 그대로 밀린다.
    await call(`https://sheets.googleapis.com/v4/spreadsheets/${p.id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [
        { insertDimension: { range: { sheetId: p.gid, dimension: 'COLUMNS', startIndex: p.col, endIndex: p.col + 1 }, inheritFromBefore: true } },
      ] }),
    });
    await call(`https://sheets.googleapis.com/v4/spreadsheets/${p.id}/values/${encodeURIComponent(`${a1(p.tab)}!${colA1(p.col)}1`)}?valueInputOption=RAW`, {
      method: 'PUT', body: JSON.stringify({ values: [[POLICY_ACCOUNT]] }),
    });
  }
  const first = Math.min(...p.rows), last = Math.max(...p.rows);
  const block: string[][] = [];
  for (let r = first; r <= last; r++) block.push([p.rows.includes(r) ? p.value : '']);
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${p.id}/values/${encodeURIComponent(`${a1(p.tab)}!${colA1(p.col)}${first + 1}:${colA1(p.col)}${last + 1}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: block }),
  });
  polCells += p.rows.length;
}
console.log(`   ✓ 정책 ${polCells}칸 (${pols.length}곳)`);

const LOG = 'docs/수정이력-공급사시트.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const h0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '# 수정이력 — 공급사 시트\n\n> 기계가 공급사 시트를 고칠 때마다 여기에 쌓는다. 새 것이 위.\n';
const byBook = [...new Set(puts.map((p) => p.label))];
const entry = `\n## ${when} · 회사정보 입금계좌 ${puts.length}칸 (${byBook.length}곳)\n\n도구 \`scripts/fill-company-account.mts --apply\`\n근거 — 옛 판매시트 발행분에서 뽑아 둔 \`tmp/old-account-note.json\`. 정책에서 계좌를 폐지(2026-08-19)하며 회사정보로 옮기라고만 적고 배선을 안 해 값이 통째로 사라졌다.\n채운 곳 — ${byBook.join(' · ')}\n사람이 정해야 할 계좌 ${EXTRA.length}건(KH 보증금계좌 · 빌린카 영업소/대전지점 · 경진렌트카) · 계좌가 아예 없는 곳 ${MISSING.length}곳(${MISSING.join('·')}).\n`;
const marker = '> 기계가 공급사 시트를';
const cut = h0.indexOf(marker);
const insertAt = cut >= 0 ? h0.indexOf('\n', cut) + 1 : h0.length;
writeFileSync(LOG, h0.slice(0, insertAt) + entry + h0.slice(insertAt));
console.log(`   ✓ ${LOG} 에 남겼다\n`);
