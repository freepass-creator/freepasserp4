/**
 * **「프리패스 차량DB」 — 공급사 데이터를 우리 데이터로 통합하는 한 장.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-15 — 「시스템 연동보다는 일단 공급사거를 우리 데이터화 해놓는거지 뭐,
 *   판매시트 말고」 · 「우리 데이터베이스 시트를 하나 만들어서 거기에 통합하자고」)
 *
 *   공급사 20곳의 차가 문서 20장에 흩어져 있으면 그건 공급사 데이터다.
 *   **한 장에 차번 하나당 한 줄**로 모여야 우리 데이터다 — 차종코드·정제값·정책까지 붙은 채로.
 *   판매시트는 이걸 «보여주는 표»일 뿐이고, 자산은 이 DB 다.
 *
 * ★구조 — 탭 둘.
 *     「차량」  차번 하나 = 한 줄. 전 공급사 통합. 열쇠는 차량번호(전역 유일 — 대원칙 검사 0건 확인).
 *     「정책」  공급사·정책코드별 한 줄(제공시트 「정책」을 모은 것).
 *
 * ★갱신 규칙 — `columnOwner` 가 SSOT 다.
 *     live  숫자가 달라졌을 때만 갱신(상태·대여료·보증금·주행거리)
 *     once  빈 칸만 채움(차명 원문·색·연식…)
 *     ours  **원천(제공시트)을 따른다** — 지금 차종코드·정제값을 «고치는 곳»은 제공시트다
 *           (stamp·fill 도구가 거기에 쓴다). 따라가되 바뀐 칸은 소리 내어 센다.
 *           ⚠ 이 DB 를 직접 고치지 마라 — 다음 갱신에 원천대로 돌아간다. 고칠 곳은 제공시트다.
 *           (언젠가 쓰는 곳을 DB 로 옮기면 이 규칙도 뒤집는다 — 설계 문서 ⑥단계)
 *     사라진 차  줄은 남기고 상태만 출고불가 — 데이터베이스는 잊지 않는다
 *
 *   npx tsx scripts/build-vehicle-db.mts
 *   npx tsx scripts/build-vehicle-db.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { companyAlias } from '../lib/domain/identity';
import { AI_TAIL_COLUMNS, TEMPLATE_COLUMNS, columnOwner, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { policySheetHeader } from '../lib/domain/policy-sheet-layout';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const isPlate = (v: string) => /^\d{2,3}[가-힣]\d{4}$/.test(v) || /^[가-힣]{2}\d{1,2}[가-힣]\d{4}$/.test(v);
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const DOC_NAME = arg('name', '프리패스 재고');
const TITLE = arg('title', '프리패스 차량DB');
const CAR_TAB = '차량';
const POLICY_TAB = '정책';

/** 열 — 열쇠(차량번호)와 공급사가 맨 앞. 규격은 제공시트(TEMPLATE_COLUMNS)가 SSOT 다. */
const TEMPLATE = TEMPLATE_COLUMNS.map((c) => c.name).filter((c) => c !== '차량번호');
const OUR_COLUMNS = AI_TAIL_COLUMNS.map((c) => c.name);
const COLUMNS = ['차량번호', '공급사', ...TEMPLATE, ...OUR_COLUMNS];
const SPLIT_AT = 2 + TEMPLATE.length;
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
const sameValue = (a: string, b: string) => {
  if (a === b) return true;
  const da = a.replace(/[,\s원₩]/g, ''), db = b.replace(/[,\s원₩]/g, '');
  return /^\d+$/.test(da) && /^\d+$/.test(db) && Number(da) === Number(db);
};

/** ── ① 제공시트에서 차·정책을 모은다. */
const files = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);

type Row = Record<string, string>;
const cars = new Map<string, Row>();          // 차번 → 줄 (전역 유일 — 대원칙)
const policies: Row[] = [];
const crossDup: string[] = [];
let withCode = 0;

for (const f of ((files.files || []) as Rec[])) {
  const id = S(f.id);
  const who = companyAlias(S(f.name).replace(DOC_NAME, '').trim()) || S(f.name).replace(DOC_NAME, '').trim();
  let meta: Rec;
  try { meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets.properties(title)')}`); } catch { continue; }
  const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter(Boolean);
  if (!titles.length) continue;
  let got: Rec;
  try { got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${titles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&')}&majorDimension=ROWS`); } catch { continue; }

  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = titles[ti];
    const grid = ((vr.values || []) as string[][]);
    if (title === POLICY_TAB) {
      const hdr = (grid[0] || []).map(S);
      if (hdr[0] !== '정책코드') return;
      for (const r of grid.slice(1)) {
        if (!r || !r.some((c) => S(c))) continue;
        const o: Row = { 공급사: who };
        hdr.forEach((c, i) => { if (c && POLICY_HEADER.includes(c)) o[c] = S(r[i]); });
        policies.push(o);
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
      if (!isPlate(p)) continue;
      /** ⚠ 대원칙 — 전역에서도 유일해야 한다. 겹치면 싣지 말고 소리 내라. */
      if (cars.has(p)) { crossDup.push(`${p} — ${cars.get(p)!['공급사']} ↔ ${who}`); continue; }
      const o: Row = { 차량번호: p, 공급사: who };
      for (const c of COLUMNS) {
        if (c === '차량번호' || c === '공급사') continue;
        const i = at.get(c);
        o[c] = i === undefined ? '' : S(r[i]);
      }
      cars.set(p, o);
      if (o['차종코드']) withCode++;
    }
  });
}

const sorted = [...cars.values()].sort((a, b) => a['공급사'].localeCompare(b['공급사'], 'ko') || a['차량번호'].localeCompare(b['차량번호'], 'ko'));
console.log(`\n■ 차량DB 통합 ${APPLY ? '(반영)' : '(dry-run — 아직 안 쓴다)'}\n`);
console.log(`  차 ${cars.size}대(전 공급사 통합) · 차종코드 ${withCode}대(${Math.round(100 * withCode / Math.max(1, cars.size))}%) · 정책 ${policies.length}줄`);
if (crossDup.length) { console.log(`\n  ⛔ 공급사끼리 같은 차번 ${crossDup.length}건 — 이중판매 위험, 먼저 정리해야 한다`); for (const d of crossDup) console.log(`     ${d}`); }

/** ── ② 문서 찾기/만들기. 같은 이름이 있으면 그걸 쓴다 — 두 장이면 어느 게 정본인지 모른다. */
let docId = arg('sheet');
if (!docId) {
  const hit = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name = '${TITLE}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id)&pageSize=5&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  docId = S(((hit.files || []) as Rec[])[0]?.id);
}
if (!docId && APPLY) {
  const made = await api('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', body: JSON.stringify({ properties: { title: TITLE, locale: 'ko_KR' },
      sheets: [
        { properties: { title: CAR_TAB, index: 0, gridProperties: { rowCount: cars.size + 200, columnCount: COLUMNS.length + 2, frozenRowCount: 1, frozenColumnCount: 2 } } },
        { properties: { title: POLICY_TAB, index: 1, gridProperties: { rowCount: policies.length + 60, columnCount: POLICY_HEADER.length + 2, frozenRowCount: 1, frozenColumnCount: 2 } } },
      ] }),
  });
  docId = S(made.spreadsheetId);
  console.log(`  새로 만들었다 — 「${TITLE}」`);
}

/** ── ③ 증분 — 열쇠(차번)로 맞춘다. 줄 위치는 안 믿는다. */
let fresh = 0, live = 0, once = 0, ours = 0, gone = 0;
const oursChanged: string[] = [];
const data: { range: string; values: string[][] }[] = [];

if (docId) {
  const cur = await api(`https://sheets.googleapis.com/v4/spreadsheets/${docId}/values/${encodeURIComponent(a1Tab(CAR_TAB))}`).catch(() => ({} as Rec)) as { values?: string[][] };
  const grid = ((cur.values || []) as string[][]);
  if (!grid.length) {
    fresh = sorted.length;
    data.push({ range: `${a1Tab(CAR_TAB)}!A1`, values: [COLUMNS, ...sorted.map((r) => COLUMNS.map((c) => r[c] ?? ''))] });
  } else {
    const hdr = (grid[0] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((x, i) => { if (x && !at.has(x)) at.set(x, i); });
    const missing = COLUMNS.filter((c) => !at.has(c));
    if (missing.length) {
      const from = hdr.length;
      missing.forEach((c, k) => at.set(c, from + k));
      data.push({ range: `${a1Tab(CAR_TAB)}!${colA1(from)}1`, values: [missing] });
    }
    const pi = at.get('차량번호')!;
    const rowOf = new Map<string, number>();
    grid.slice(1).forEach((r, n) => { const p = plate(r[pi]); if (isPlate(p) && !rowOf.has(p)) rowOf.set(p, n + 2); });
    let last = grid.length;
    for (const r of sorted) {
      const rowN = rowOf.get(r['차량번호']);
      if (!rowN) { last += 1; fresh++; data.push({ range: `${a1Tab(CAR_TAB)}!A${last}`, values: [COLUMNS.map((c) => r[c] ?? '')] }); continue; }
      const curRow = grid[rowN - 1] || [];
      for (const c of COLUMNS) {
        if (c === '차량번호') continue;
        const ci = at.get(c)!;
        const now = S(curRow[ci]);
        const next = S(r[c]);
        if (!next) continue;                           // 원천이 비었다고 지우지 않는다
        const owner = c === '공급사' ? 'once' : columnOwner(c);
        if (owner === 'live') {
          if (!sameValue(now, next)) { live++; data.push({ range: `${a1Tab(CAR_TAB)}!${colA1(ci)}${rowN}`, values: [[next]] }); }
        } else if (!now) {
          if (owner === 'ours') ours++; else once++;
          data.push({ range: `${a1Tab(CAR_TAB)}!${colA1(ci)}${rowN}`, values: [[next]] });
        } else if (owner === 'ours' && !sameValue(now, next)) {
          /** ours 는 원천(제공시트)을 따른다 — 고치는 곳이 저기다. 바뀐 칸은 소리 내어 센다. */
          ours++;
          if (oursChanged.length < 10) oursChanged.push(`${r['차량번호']} ${c} 「${now.slice(0, 24)}」 → 「${next.slice(0, 24)}」`);
          data.push({ range: `${a1Tab(CAR_TAB)}!${colA1(ci)}${rowN}`, values: [[next]] });
        }
      }
    }
    const si = at.get('상태');
    const srcSet = new Set(sorted.map((r) => r['차량번호']));
    for (const [p, rowN] of rowOf) {
      if (srcSet.has(p)) continue;
      gone++;
      if (si !== undefined && S((grid[rowN - 1] || [])[si]) !== '출고불가') data.push({ range: `${a1Tab(CAR_TAB)}!${colA1(si)}${rowN}`, values: [['출고불가']] });
    }
  }
  /** 정책 — 모아 보는 자리라 통째 갱신. 채우는 곳은 제공시트 「정책」이다. */
  data.push({ range: `${a1Tab(POLICY_TAB)}!A1`, values: [POLICY_HEADER, ...policies
    .sort((a, b) => S(a['공급사']).localeCompare(S(b['공급사']), 'ko') || S(a['정책코드']).localeCompare(S(b['정책코드'])))
    .map((p) => POLICY_HEADER.map((c) => p[c] ?? ''))] });
}

const byWho = new Map<string, { n: number; code: number }>();
for (const r of sorted) { const w = byWho.get(r['공급사']) || { n: 0, code: 0 }; w.n++; if (r['차종코드']) w.code++; byWho.set(r['공급사'], w); }
console.log(`\n  ${pad('공급사', 12)}${pad('대수', 7)}차종코드`);
for (const [w, x] of [...byWho].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${pad(w, 12)}${pad(`${x.n}대`, 7)}${x.code}대 (${Math.round(100 * x.code / x.n)}%)`);
console.log(`  ${'─'.repeat(36)}`);
console.log(`  새 줄 ${fresh} · live 갱신 ${live}칸 · once 채움 ${once}칸 · ours 반영 ${ours}칸 · 사라진 차 ${gone}`);
if (oursChanged.length) { console.log(`\n  ▲ ours 칸이 원천을 따라 바뀐 자리(일부)`); for (const c of oursChanged) console.log(`     ${c}`); }
if (!APPLY) { console.log('\n  미리보기였다. 실제로 쓰려면 --apply\n'); process.exit(0); }
if (!docId) { console.log('\n  ⛔ 문서가 없다 — --apply 로 다시 돌리면 만든다\n'); process.exit(1); }

for (let i = 0; i < data.length; i += 100) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${docId}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 100) }),
  });
}
/** 서식 — 머리행·ours 경계·필터. 값과 달리 다시 발라도 안전하다. */
const meta2 = await api(`https://sheets.googleapis.com/v4/spreadsheets/${docId}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`);
const gid = new Map<string, number>();
for (const s of ((meta2.sheets || []) as Rec[])) gid.set(S(s.properties?.title), Number(s.properties?.sheetId));
const fmt: Rec[] = [];
const carGid = gid.get(CAR_TAB);
if (carGid !== undefined) {
  fmt.push({ repeatCell: { range: { sheetId: carGid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } });
  fmt.push({ repeatCell: { range: { sheetId: carGid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: SPLIT_AT, endColumnIndex: COLUMNS.length }, cell: { userEnteredFormat: { backgroundColor: { red: 0.87, green: 0.95, blue: 0.89 } } }, fields: 'userEnteredFormat.backgroundColor' } });
  fmt.push({ updateBorders: { range: { sheetId: carGid, startRowIndex: 0, endRowIndex: cars.size + 200, startColumnIndex: SPLIT_AT, endColumnIndex: SPLIT_AT + 1 }, left: { style: 'SOLID_MEDIUM', color: { red: 0.4, green: 0.6, blue: 0.45 } } } });
  fmt.push({ setBasicFilter: { filter: { range: { sheetId: carGid, startRowIndex: 0, endRowIndex: cars.size + 1, startColumnIndex: 0, endColumnIndex: COLUMNS.length } } } });
}
const polGid = gid.get(POLICY_TAB);
if (polGid !== undefined) fmt.push({ repeatCell: { range: { sheetId: polGid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.87, green: 0.92, blue: 0.99 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } });
for (let i = 0; i < fmt.length; i += 40) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${docId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt.slice(i, i + 40) }) });
}
console.log(`\n  반영 완료 — https://docs.google.com/spreadsheets/d/${docId}/edit\n`);
