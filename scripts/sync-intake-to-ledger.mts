/**
 * **접수 시트(팀장) → 정산원장.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-24 「정산은 차량번호를 최초 쓴 날짜가 접수일로 해줘」.
 *
 * ★**접수일은 «그 차번을 처음 본 날»이고, 한 번 박히면 다시는 안 바뀐다.**
 *   · 접수 시트 「접수일」이 비어 있을 때만 오늘을 적는다. 값이 있으면 **손대지 않는다**.
 *   · 원장으로 옮길 때도 **접수 시트의 그 값을 그대로** 옮긴다 — 옮긴 날을 적지 않는다.
 *   · 이미 원장에 있는 차는 접수일을 다시 쓰지 않는다.
 *   ⇒ 정산월·수수료가 접수일에서 나오므로, 이 날짜가 흔들리면 **돈이 흔들린다**.
 *   ⚠ 「처음 본 날」은 이 도구가 도는 주기만큼만 정확하다. 하루 한 번은 돌아야 «쓴 날»과 같아진다.
 *
 * ★날짜는 **날짜로** 넣는다(`USER_ENTERED`). 글자로 넣으면 정렬·계산이 안 되고,
 *   서식이 없으면 46171 같은 일련번호로 보인다(2026-08-24 원장 실측) — 열 서식도 같이 세운다.
 *
 * ★팀장 칸(차량번호·영업채널·영업담당자·완료여부)은 **읽기만** 한다. 기계는 뒤 넉 칸만 쓴다.
 *
 *   npx tsx scripts/sync-intake-to-ledger.mts
 *   npx tsx scripts/sync-intake-to-ledger.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  INTAKE_SHEET_NAME, INTAKE_TAB, INTAKE_COLUMNS,
  SETTLEMENT_LEDGER_ID as LEDGER_ID, SETTLEMENT_CURRENT_TAB as LEDGER_TAB,
  SETTLEMENT_CONTRACT_STATE as STATE,
} from '../lib/domain/settlement-ledger';
import { SHEET_NAME_MATCH, supplierSheetLabel, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => S(v).replace(/\s/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const a1 = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

const now = new Date();
const YMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const YM = YMD.slice(0, 7);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 200)}`);
  }
};

// ── ① 접수 시트
const q0 = `name = '${INTAKE_SHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const f0 = (await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q0)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).files || [];
if (!f0.length) throw new Error(`「${INTAKE_SHEET_NAME}」를 못 찾았다 — create-contract-intake-sheet.mts 먼저`);
const INTAKE_ID = S(f0[0].id);

const iGot = await api(`${SH}/${INTAKE_ID}/values/${encodeURIComponent(`${a1(INTAKE_TAB)}!A1:H300`)}`) as { values?: string[][] };
const iRows = ((iGot?.values || []) as string[][]).map((r) => (r || []).map(S));
const iHead = iRows[0] || [];
const at = (n: string) => iHead.indexOf(n);
const [cPlate, cChannel, cOwner, cDone, cModel, cSupplier, cRecv, cDoneMark, cCheck] = INTAKE_COLUMNS.map(at);
if (cPlate < 0 || cRecv < 0) throw new Error('접수 탭에서 「차량번호」·「접수일」 칸을 못 찾았다');

type Item = { row: number; plate: string; channel: string; owner: string; done: string; recv: string; firstSeen: boolean };
const items: Item[] = [];
for (let r = 1; r < iRows.length; r++) {
  const plate = key(iRows[r][cPlate]);
  if (!plate) continue;
  const recv = S(iRows[r][cRecv]);
  items.push({
    row: r, plate, channel: S(iRows[r][cChannel]), owner: S(iRows[r][cOwner]),
    done: S(iRows[r][cDone]), recv: recv || YMD, firstSeen: !recv,
  });
}
console.log(`■ 접수 시트 ${items.length}대 — 처음 본 차 ${items.filter((x) => x.firstSeen).length} · 접수일이 이미 있는 차 ${items.filter((x) => !x.firstSeen).length}\n`);
if (!items.length) { console.log('  올라온 차가 없다.'); process.exit(0); }

// ── ② 공급사 시트에서 모델명·공급사를 찾는다(정본은 거기다)
const spec = new Map<string, { model: string; supplier: string }>();
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const files = (await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || [];
const want = new Set(items.map((x) => x.plate));
for (const f of files) {
  const label = supplierSheetLabel(S(f.name));
  if (/구버전|폐기/.test(label)) continue;
  const meta = await api(`${SH}/${S(f.id)}?fields=sheets.properties(title,hidden)`);
  for (const s of (meta?.sheets || [])) {
    const tab = S(s.properties.title);
    if (s.properties.hidden || isOurNonInventoryTab(tab) || !/재고/.test(tab)) continue;
    const g = await api(`${SH}/${S(f.id)}/values/${encodeURIComponent(`${a1(tab)}!A1:CZ700`)}`);
    const rs = ((g?.values || []) as string[][]).map((r) => (r || []).map(S));
    const hi = rs.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const h = rs[hi];
    const ip = h.indexOf('차량번호');
    // 「모델명」이 없으면 「모델」·「차명」 순으로 물러선다 — 시트마다 이름이 조금씩 다르다.
    const im = ['모델명', '모델', '차명'].map((n) => h.indexOf(n)).find((x) => x >= 0) ?? -1;
    for (let r = hi + 1; r < rs.length; r++) {
      const p = key(rs[r][ip]);
      if (!p || !want.has(p) || spec.has(p)) continue;
      spec.set(p, { model: im >= 0 ? S(rs[r][im]) : '', supplier: label });
    }
  }
}
console.log(`  공급사 시트에서 찾은 차 ${spec.size}/${want.size}${spec.size < want.size ? ` — 못 찾은 차 ${[...want].filter((p) => !spec.has(p)).join(' · ')}` : ''}`);

// ── ③ 원장 「당월실적」
const lGot = await api(`${SH}/${LEDGER_ID}/values/${encodeURIComponent(`${a1(LEDGER_TAB)}!A1:AL2000`)}`) as { values?: string[][] };
const lRows = ((lGot?.values || []) as string[][]).map((r) => (r || []).map(S));
const lHead = lRows[0] || [];
const L = (n: string) => lHead.indexOf(n);
const lPlate = L('차량번호');
if (lPlate < 0) throw new Error('원장에서 「차량번호」 칸을 못 찾았다');
const already = new Map<string, number>();
for (let r = 1; r < lRows.length; r++) { const p = key(lRows[r][lPlate]); if (p) already.set(p, r); }
const firstBlank = (() => { for (let r = 1; r < 2000; r++) if (!key((lRows[r] || [])[lPlate])) return r; return lRows.length; })();

const toAdd = items.filter((x) => !already.has(x.plate));
const inLedger = items.filter((x) => already.has(x.plate));
console.log(`  원장 「${LEDGER_TAB}」 — 새로 넣을 차 ${toAdd.length} · 이미 있는 차 ${inLedger.length}\n`);
for (const x of items) {
  const s = spec.get(x.plate);
  const mark = x.firstSeen ? '★처음' : '  기존';
  console.log(`   ${mark} ${x.plate.padEnd(10)} 접수일 ${x.recv}  ${(s?.model || '(모델 모름)').slice(0, 18).padEnd(20)} ${s?.supplier || ''}${already.has(x.plate) ? '  · 원장에 이미 있음(접수일 안 건드림)' : ''}`);
}

if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다. 반영은 --apply\n'); process.exit(0); }

// ── ④ 접수 시트 뒤 넉 칸 — 접수일은 **비었을 때만** 적는다
const iData: { range: string; values: string[][] }[] = [];
for (const x of items) {
  const s = spec.get(x.plate);
  if (x.firstSeen) iData.push({ range: `${a1(INTAKE_TAB)}!${colA1(cRecv)}${x.row + 1}`, values: [[x.recv]] });
  if (s?.model && !S(iRows[x.row][cModel])) iData.push({ range: `${a1(INTAKE_TAB)}!${colA1(cModel)}${x.row + 1}`, values: [[s.model]] });
  if (s?.supplier && !S(iRows[x.row][cSupplier])) iData.push({ range: `${a1(INTAKE_TAB)}!${colA1(cSupplier)}${x.row + 1}`, values: [[s.supplier]] });
  // ★「반영」 표시는 여기서 안 찍는다 — 원장에 실제로 들어간 **뒤**에 찍는다(⑦).
}
if (iData.length) await api(`${SH}/${INTAKE_ID}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: iData }) });

// ── ⑤ 원장에 새 줄 — 접수일은 **접수 시트 값 그대로**(옮긴 날이 아니다)
if (toAdd.length) {
  const data: { range: string; values: string[][] }[] = [];
  toAdd.forEach((x, k) => {
    const row = firstBlank + k + 1;
    const s = spec.get(x.plate);
    const put = (name: string, v: string) => { const c = L(name); if (c >= 0 && v) data.push({ range: `${a1(LEDGER_TAB)}!${colA1(c)}${row}`, values: [[v]] }); };
    put('정산월', YM);
    put('상태', STATE);
    put('접수일', x.recv);          // ★그 차번을 처음 본 날. 오늘이 아니다.
    put('차량번호', x.plate);
    put('모델명', s?.model || '');
    put('공급사', s?.supplier || '');
    put('영업채널', x.channel);
    put('영업담당자', x.owner);
  });
  await api(`${SH}/${LEDGER_ID}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
}

/**
 * ── ⑦ 「반영」 표시 — **원장에 들어간 뒤에** 찍는다.
 *   먼저 찍으면 원장 쓰기가 깨졌을 때 시트만 «반영됨»이라 말한다. 팀장은 그걸 믿고 넘어간다.
 */
const marks: { range: string; values: string[][] }[] = [];
for (const x of items) {
  if (S(iRows[x.row][cDoneMark]) === '○') continue;
  marks.push({ range: `${a1(INTAKE_TAB)}!${colA1(cDoneMark)}${x.row + 1}`, values: [['○']] });
}
if (marks.length) await api(`${SH}/${INTAKE_ID}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: marks }) });

/**
 * ── ⑧ 「확인」 — 기계가 짚어 주는 칸(사장님 2026-08-25).
 *   ★**비어 있으면 괜찮다는 뜻.** 글이 있으면 그 줄만 보면 된다.
 *   ★짐작해서 고치지 않는다 — 말만 해 준다. 고치는 건 사람이다.
 *   ★한 줄에 여러 개면 「 · 」로 잇는다. 제일 급한 것부터.
 */
if (cCheck >= 0) {
  const seenPlate = new Map<string, number>();
  const checks: { range: string; values: string[][] }[] = [];
  for (const x of items) {
    const said: string[] = [];
    const s2 = spec.get(x.plate);
    // ① 우리 재고에 없는 차번 — 오타이거나 남의 차다. 제일 급하다.
    if (!s2) said.push('우리 재고에 없는 차번입니다 — 오타인지 봐 주세요');
    // ② 같은 차가 위에 또 있다 — 정산이 두 번 잡힌다.
    const before = seenPlate.get(x.plate);
    if (before) said.push(`같은 차가 ${before}행에 또 있습니다`);
    seenPlate.set(x.plate, x.row + 1);
    // ③ 완료라고 했는데 누가 팔았는지가 없다 — 정산에서 수수료를 못 준다.
    if (x.done && !x.channel) said.push('영업채널이 비었습니다');
    if (x.done && !x.owner) said.push('영업담당자가 비었습니다');
    // ④ 원장에 이미 있는 차 — 지난 계약인지 확인이 필요하다.
    if (already.has(x.plate)) said.push('정산원장에 이미 있는 차입니다 — 지난 계약인지 봐 주세요');
    const now = said.join(" · ");
    if (S(iRows[x.row][cCheck]) === now) continue;
    checks.push({ range: `${a1(INTAKE_TAB)}!${colA1(cCheck)}${x.row + 1}`, values: [[now]] });
  }
  if (checks.length) await api(`${SH}/${INTAKE_ID}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: checks }) });
  const flagged = checks.filter((c) => S(c.values[0][0])).length;
  console.log(`   확인 칸 — 짚은 줄 ${flagged} · 지운 줄 ${checks.length - flagged}`);
}

// ── ⑥ 날짜 칸은 날짜로 보이게 — 46171 로 보이면 아무도 못 읽는다
const lMeta = await api(`${SH}/${LEDGER_ID}?fields=sheets.properties(title,sheetId)`);
const reqs: Record<string, unknown>[] = [];
for (const s of (lMeta?.sheets || [])) {
  const title = S(s.properties.title);
  if (title !== LEDGER_TAB && title !== '기존실적') continue;
  const hv = await api(`${SH}/${LEDGER_ID}/values/${encodeURIComponent(`${a1(title)}!A1:AL1`)}`);
  const hh = ((hv?.values || [[]])[0] || []).map(S);
  for (const name of ['접수일', '인도일']) {
    const c = hh.indexOf(name);
    if (c < 0) continue;
    reqs.push({ repeatCell: {
      range: { sheetId: Number(s.properties.sheetId), startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' }, horizontalAlignment: 'CENTER' } },
      fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
    } });
  }
}
if (reqs.length) await api(`${SH}/${LEDGER_ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });

console.log(`\n■ 끝 — 접수 시트 ${iData.length}칸 · 원장 새 줄 ${toAdd.length} · 날짜 서식 ${reqs.length}열`);
console.log('   접수일은 처음 본 날로 한 번만 박힌다. 이미 있던 값은 안 건드렸다.\n');
