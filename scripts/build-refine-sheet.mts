/**
 * **정제시트 한 장을 만들고 «증분으로» 유지한다 — 공급사가 탭이다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-15 — 「정제시트 하나 만들자. 공급사를 탭렬로 두는거야」 ·
 *   「거기에 정제된 시트로 공급사별 다 통일해놓고 그거를 판매시트가 댕겨가는거지」)
 *
 * ★**이 시트가 정제의 정본이 될 자리다.** 흐름은 이렇게 갈린다 —
 *     공급사 제공시트  공급사가 만진다. 상태·대여료가 여기서 온다(live)
 *     정제시트(여기)   우리가 만진다. 차번 → 차종코드와 차종 값이 여기서 온다(ours)
 *   만지는 사람이 갈리면 서로 덮을 일이 없다. 그게 이 구조의 값어치다.
 *
 * ★★**통째로 덮지 않는다 — 증분이다**(설계 ④단계 · 「통째 덮기 금지」).
 *   처음 만든 뒤로 이 시트에는 사람 손이 닿는다. 통째로 다시 쓰면 그 손이 날아간다.
 *     · live 칸(상태·대여료·보증금·주행거리)  숫자가 달라졌을 때만 갱신
 *     · once 칸(차명 원문·색·연식…)          빈 칸만 채움 — 정리해 둔 값을 원문으로 안 되돌린다
 *     · ours 칸(차종코드·정제칸·정책코드)      빈 칸만 채움. **어긋나면 안 덮고 센다** —
 *       어느 쪽이 정본인지는 사람이 정할 일이지 도구가 정할 일이 아니다
 *     · 원본에서 사라진 차                    줄은 남기고 상태만 출고불가
 *
 * ★**정책도 모은다**(설계 ③단계). 탭 「정책」 하나에 «공급사 · 정책코드 · 정책명 · 항목들»을
 *   행으로 모은다 — 그래야 판매시트 발행기가 **진짜로 문서 하나만** 읽는다.
 *   ⚠ 정책 탭은 통째로 다시 쓴다. 채우는 곳이 제공시트 「정책」이라 여기는 «모아 보는 자리»다.
 *     여기 정책 탭을 손으로 고치지 마라 — 다음 갱신에 덮인다. 고칠 곳은 제공시트다.
 *
 * ★한 탭의 규격 = 제공시트 규격(TEMPLATE_COLUMNS) + 「공급사」 + 정제칸 12.
 *   규격을 여기서 새로 정의하지 않는다 — 따로 적으면 제공시트와 갈리고,
 *   갈리는 순간 «어느 쪽이 규격인지» 아무도 모른다.
 *
 *   npx tsx scripts/build-refine-sheet.mts
 *   npx tsx scripts/build-refine-sheet.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { companyAlias } from '../lib/domain/identity';
import { AI_TAIL_COLUMNS, TEMPLATE_COLUMNS, columnOwner, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { policySheetHeader } from '../lib/domain/policy-sheet-layout';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const isPlate = (v: string) => /^\d{2,3}[가-힣]\d{4}$/.test(v);
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const DOC_NAME = arg('name', '프리패스 재고');
const TITLE = arg('title', '프리패스 차량정제');
const SHEET_ID = arg('sheet', '1nLwfgBSCpN_GnFUw_2SbG5LdyB9-l6d9ObkMP3IGa5I');
const POLICY_TAB = '정책';

const TEMPLATE = TEMPLATE_COLUMNS.map((c) => c.name);
/** 왼쪽 — 공급사가 만지는 값(live)과 처음 한 번 옮겨 온 원문(once). */
const RAW_COLUMNS = ['공급사', ...TEMPLATE];
/** 오른쪽 — 우리가 정하는 값. 맨 앞 「차종코드」가 정본이고 나머지는 거기서 나온다. */
const OUR_COLUMNS = AI_TAIL_COLUMNS.map((c) => c.name);
const COLUMNS = [...RAW_COLUMNS, ...OUR_COLUMNS];
const SPLIT_AT = RAW_COLUMNS.length;
/** 정책 탭 머리 — 규격은 policy-sheet-layout 이 SSOT 다. */
const POLICY_HEADER = ['공급사', ...policySheetHeader()];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
/** 「93,000」과 「93000」은 같은 값 — 표기만 되돌리면 그 칸이 매번 갱신 대상으로 떠서 진짜 변화가 묻힌다. */
const sameValue = (a: string, b: string) => {
  if (a === b) return true;
  const da = a.replace(/[,\s원₩]/g, ''), db = b.replace(/[,\s원₩]/g, '');
  return /^\d+$/.test(da) && /^\d+$/.test(db) && Number(da) === Number(db);
};

/** ── ① 제공시트에서 차와 정책을 모은다 — 탭을 한 번에 읽어 쿼터를 아낀다. */
const files = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);

type Row = Record<string, string>;
const byWho = new Map<string, Row[]>();
const policies: Row[] = [];
const noPolicy: string[] = [];
let cars = 0, withCode = 0;

for (const f of ((files.files || []) as Rec[])) {
  const id = S(f.id);
  const who = companyAlias(S(f.name).replace(DOC_NAME, '').trim()) || S(f.name).replace(DOC_NAME, '').trim();
  let meta: Rec;
  try { meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets.properties(title)')}`); } catch { continue; }
  const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter(Boolean);
  if (!titles.length) continue;
  let got: Rec;
  try { got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${titles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&')}&majorDimension=ROWS`); } catch { continue; }

  const seen = new Set<string>();
  const rows: Row[] = [];
  let gotPolicy = false;
  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = titles[ti];
    const grid = ((vr.values || []) as string[][]);
    /** 정책 탭 — 가로 규격(1행 = 정책코드|정책명|…). 이름으로 잇는다 — 순서를 믿지 않는다. */
    if (title === POLICY_TAB) {
      const hdr = (grid[0] || []).map(S);
      if (hdr[0] !== '정책코드') return;
      for (const r of grid.slice(1)) {
        if (!r || !r.some((c) => S(c))) continue;
        const o: Row = { 공급사: who };
        hdr.forEach((c, i) => { if (c && POLICY_HEADER.includes(c)) o[c] = S(r[i]); });
        policies.push(o);
        gotPolicy = true;
      }
      return;
    }
    if (isOurNonInventoryTab(title)) return;
    const h = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (h < 0) return;
    const hdr = (grid[h] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((x, i) => { if (x && !at.has(x)) at.set(x, i); });
    if (!at.has('차량번호')) return;
    for (const r of grid.slice(h + 1)) {
      const p = plate(r[at.get('차량번호')!]);
      if (!isPlate(p) || seen.has(p)) continue;      // ⚠ 대원칙 — 같은 차번은 있을 수 없다
      seen.add(p);
      const o: Row = { 차량번호: p, 공급사: who };
      for (const c of COLUMNS) {
        if (c === '차량번호' || c === '공급사') continue;
        const i = at.get(c);
        o[c] = i === undefined ? '' : S(r[i]);
      }
      rows.push(o);
      cars++;
      if (o['차종코드']) withCode++;
    }
  });
  if (!gotPolicy) noPolicy.push(who);
  if (rows.length) byWho.set(who, rows.sort((a, b) => a['차량번호'].localeCompare(b['차량번호'], 'ko')));
}

const whos = [...byWho.keys()].sort((a, b) => (byWho.get(b)!.length - byWho.get(a)!.length) || a.localeCompare(b, 'ko'));
console.log(`\n■ 정제시트 증분 갱신 ${APPLY ? '(반영)' : '(dry-run — 아직 안 쓴다)'}\n`);
console.log(`  제공시트에서 차 ${cars}대 · 차종코드 ${withCode}대 (${Math.round(100 * withCode / Math.max(1, cars))}%) · 정책 ${policies.length}줄(${new Set(policies.map((p) => p['공급사'])).size}곳)`);
if (noPolicy.length) console.log(`  ▲ 정책 탭을 못 읽은 곳 ${noPolicy.length} — ${noPolicy.join(' · ')}`);

/** ── ② 정제시트 현재 상태를 읽는다. */
const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=${encodeURIComponent('sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))')}`);
const have = new Map<string, { gid: number; rows: number; cols: number }>();
for (const s of ((meta.sheets || []) as Rec[])) {
  have.set(S(s.properties?.title), { gid: Number(s.properties?.sheetId), rows: Number(s.properties?.gridProperties?.rowCount) || 0, cols: Number(s.properties?.gridProperties?.columnCount) || 0 });
}

/** 없는 탭부터 만든다 — 값을 쓰기 전에 자리가 있어야 한다. */
{
  const reqs: Rec[] = [];
  whos.forEach((w, i) => {
    if (!have.has(w)) reqs.push({ addSheet: { properties: { title: w, index: i, gridProperties: { rowCount: byWho.get(w)!.length + 40, columnCount: COLUMNS.length + 2, frozenRowCount: 1, frozenColumnCount: 1 } } } });
  });
  if (!have.has(POLICY_TAB)) reqs.push({ addSheet: { properties: { title: POLICY_TAB, index: whos.length, gridProperties: { rowCount: policies.length + 40, columnCount: POLICY_HEADER.length + 2, frozenRowCount: 1, frozenColumnCount: 1 } } } });
  if (reqs.length && APPLY) {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
    const m2 = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`);
    for (const s of ((m2.sheets || []) as Rec[])) if (!have.has(S(s.properties?.title))) have.set(S(s.properties?.title), { gid: Number(s.properties?.sheetId), rows: 0, cols: 0 });
  } else if (reqs.length) {
    console.log(`  새로 만들 탭 ${reqs.length}장`);
  }
}

/** ── ③ 탭마다 증분으로 맞춘다. */
type Tally = { who: string; fresh: number; live: number; once: number; ours: number; clash: number; gone: number };
const tallies: Tally[] = [];
const clashes: string[] = [];
const allData: { range: string; values: string[][] }[] = [];

for (const who of whos) {
  const src = byWho.get(who)!;
  const known = have.get(who);
  const t: Tally = { who, fresh: 0, live: 0, once: 0, ours: 0, clash: 0, gone: 0 };
  if (!known || !known.rows) {
    /** 새 탭 — 처음 한 번은 통째로 쓴다. 아직 사람 손이 안 닿은 자리다. */
    t.fresh = src.length;
    allData.push({ range: `${a1Tab(who)}!A1`, values: [COLUMNS, ...src.map((r) => COLUMNS.map((c) => r[c] ?? ''))] });
    tallies.push(t);
    continue;
  }
  const cur = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(a1Tab(who))}`) as { values?: string[][] };
  const grid = ((cur.values || []) as string[][]);
  const hdr = (grid[0] || []).map(S);
  const at = new Map<string, number>();
  hdr.forEach((x, i) => { if (x && !at.has(x)) at.set(x, i); });
  /** 규격이 늘었으면 머리에 칸을 덧단다 — 있는 열은 절대 안 옮긴다(빌린카 40칸 사고의 교훈). */
  const missingCols = COLUMNS.filter((c) => !at.has(c));
  if (missingCols.length) {
    const from = hdr.length;
    missingCols.forEach((c, k) => at.set(c, from + k));
    allData.push({ range: `${a1Tab(who)}!${colA1(from)}1`, values: [missingCols] });
  }
  const pi = at.get('차량번호')!;
  const rowOf = new Map<string, number>();     // 차번 → 시트 행번호(1기준)
  grid.slice(1).forEach((r, n) => { const p = plate(r[pi]); if (isPlate(p) && !rowOf.has(p)) rowOf.set(p, n + 2); });

  let lastRow = grid.length;                    // 새 차를 붙일 자리
  const srcPlates = new Set(src.map((r) => r['차량번호']));
  for (const r of src) {
    const p = r['차량번호'];
    const rowN = rowOf.get(p);
    if (!rowN) {
      lastRow += 1;
      t.fresh++;
      allData.push({ range: `${a1Tab(who)}!A${lastRow}`, values: [COLUMNS.map((c) => (at.has(c) && at.get(c)! < COLUMNS.length ? r[c] ?? '' : r[c] ?? ''))] });
      continue;
    }
    const curRow = grid[rowN - 1] || [];
    for (const c of COLUMNS) {
      if (c === '차량번호') continue;
      const ci = at.get(c)!;
      const now = S(curRow[ci]);
      const next = S(r[c]);
      if (!next) continue;                                  // 원본이 비었다고 우리 값을 지우지 않는다
      const owner = c === '공급사' ? 'once' : columnOwner(c);
      if (owner === 'live') {
        if (!sameValue(now, next)) { t.live++; allData.push({ range: `${a1Tab(who)}!${colA1(ci)}${rowN}`, values: [[next]] }); }
      } else if (!now) {
        if (owner === 'ours') t.ours++; else t.once++;
        allData.push({ range: `${a1Tab(who)}!${colA1(ci)}${rowN}`, values: [[next]] });
      } else if (owner === 'ours' && !sameValue(now, next)) {
        /** ⚠ 어긋난 ours 칸은 안 덮는다 — 어느 쪽이 정본인지는 사람이 정한다. 세어만 둔다. */
        t.clash++;
        if (clashes.length < 12) clashes.push(`${who} ${p} ${c} 정제시트「${now}」 ↔ 제공시트「${next}」`);
      }
    }
  }
  /** 원본에서 사라진 차 — 줄은 남기고 상태만 내린다(살 수 있는 것처럼 두면 안 된다). */
  const si = at.get('상태');
  for (const [p, rowN] of rowOf) {
    if (srcPlates.has(p)) continue;
    t.gone++;
    if (si !== undefined && S((grid[rowN - 1] || [])[si]) !== '출고불가') {
      allData.push({ range: `${a1Tab(who)}!${colA1(si)}${rowN}`, values: [['출고불가']] });
    }
  }
  tallies.push(t);
}

/** 정책 탭 — 모아 보는 자리라 통째로 다시 쓴다(채우는 곳은 제공시트다). */
{
  const values = [POLICY_HEADER, ...policies
    .sort((a, b) => S(a['공급사']).localeCompare(S(b['공급사']), 'ko') || S(a['정책코드']).localeCompare(S(b['정책코드'])))
    .map((p) => POLICY_HEADER.map((c) => p[c] ?? ''))];
  allData.push({ range: `${a1Tab(POLICY_TAB)}!A1`, values });
}

console.log(`\n  ${pad('탭', 12)}${pad('새 차', 7)}${pad('live', 6)}${pad('once', 6)}${pad('ours', 6)}${pad('어긋남', 8)}사라짐`);
for (const t of tallies) {
  console.log(`  ${pad(t.who, 12)}${pad(String(t.fresh), 7)}${pad(String(t.live), 6)}${pad(String(t.once), 6)}${pad(String(t.ours), 6)}${pad(String(t.clash), 8)}${t.gone}`);
}
const sum = (f: (t: Tally) => number) => tallies.reduce((a, t) => a + f(t), 0);
console.log(`  ${'─'.repeat(50)}`);
console.log(`  새 차 ${sum((t) => t.fresh)} · live 갱신 ${sum((t) => t.live)}칸 · 빈 칸 채움 ${sum((t) => t.once) + sum((t) => t.ours)}칸 · ours 어긋남 ${sum((t) => t.clash)}칸 · 사라진 차 ${sum((t) => t.gone)}`);
console.log(`  정책 탭 ${policies.length}줄 (통째 갱신 — 채우는 곳은 제공시트다)`);
if (clashes.length) {
  console.log(`\n  ▲ ours 칸이 어긋난 자리 — 안 덮었다. 어느 쪽이 정본인지 정한 뒤 한쪽을 고쳐라`);
  for (const c of clashes) console.log(`     ${c}`);
}
if (!APPLY) { console.log('\n  미리보기였다. 실제로 쓰려면 --apply\n'); process.exit(0); }

for (let i = 0; i < allData.length; i += 100) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: allData.slice(i, i + 100) }),
  });
}

/** 서식 — 머리행·경계선·필터. 값과 달리 몇 번 다시 발라도 안전하다. */
const meta2 = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`);
const gid = new Map<string, number>();
for (const s of ((meta2.sheets || []) as Rec[])) gid.set(S(s.properties?.title), Number(s.properties?.sheetId));
const fmt: Rec[] = [];
for (const w of whos) {
  const id = gid.get(w);
  if (id === undefined) continue;
  const n = (byWho.get(w)!.length) + 40;
  fmt.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } });
  fmt.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: SPLIT_AT, endColumnIndex: COLUMNS.length }, cell: { userEnteredFormat: { backgroundColor: { red: 0.87, green: 0.95, blue: 0.89 } } }, fields: 'userEnteredFormat.backgroundColor' } });
  fmt.push({ updateBorders: { range: { sheetId: id, startRowIndex: 0, endRowIndex: n, startColumnIndex: SPLIT_AT, endColumnIndex: SPLIT_AT + 1 }, left: { style: 'SOLID_MEDIUM', color: { red: 0.4, green: 0.6, blue: 0.45 } } } });
}
{
  const id = gid.get(POLICY_TAB);
  if (id !== undefined) fmt.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.87, green: 0.92, blue: 0.99 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } });
}
for (let i = 0; i < fmt.length; i += 40) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt.slice(i, i + 40) }) });
}

console.log(`\n  반영 완료 — https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
