/**
 * **발행한 시트가 원자와 «정말 같은가» — 칸 단위 대조.** 읽기 전용 · 어긋나면 종료코드 1.
 *
 * > 사장님 2026-09-08 「너무 빠르게만 필요없고 **적당한 속도에 완벽하게 박혀야 함**」
 *
 * 발행이 «끝났다」는 것과 «제대로 박혔다」는 것은 다르다. 발행기는 스스로 「반영 완료」라 찍지만,
 * 그건 구글이 200 을 줬다는 뜻이지 **그 칸에 그 값이 들어갔다는 뜻이 아니다.**
 * 오늘만 해도 시트에 「장기보증=0」이 서 있었고, 「(공급사 없음) 84대」 탭이 남아 있었고,
 * 오플 보증금이 0/84 였다 — 셋 다 발행은 «성공»했다.
 *
 * ```
 * 원자 products  ──▶  상품리스트 F01(4탭)  ──▶  하허호 F86(회사별 탭)
 *      ①대조                    ②대조
 * ```
 * ① 원자 ↔ F01 — 차 한 대의 «정체·상태·요금»이 시트 칸에 그대로 있나
 * ② F01 ↔ F86 — 같은 Firestore 원자에서 만든 두 출력이 차량번호·값까지 같은가
 *
 * ★**빠진 차 · 남는 차 · 값이 다른 칸**을 갈래로 나눠 센다. 숫자만 맞대면 «어느 차»인지 모른다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/audit-sheet-vs-atom.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_PUBLISHED_TAB_PREFIXES } from '../lib/domain/sales-published-tabs';
import { isDepositColumn, isMoneyColumn } from '../lib/domain/sales-sheet-format';
import { inventoryCountSnapshot, isOpenInventoryAtom, isUnavailableInventoryAtom } from '../lib/domain/inventory-contract';
import nextEnv from '@next/env';
import { readSalesPublishSnapshot, salesPublishMark } from '../lib/server/sales-publish-snapshot';
import { companyAlias } from '../lib/domain/identity';
import { channelCompanyOf } from '../lib/domain/channel-company';
import { compareSalesRows, loadSalesRowContext, makeCell, tabOf } from '../lib/domain/sales-atom-row';
import { channelColumnName, salesPublishedColumns } from '../lib/domain/sales-published-tab-columns';
import { HAHUHO_PRODUCT_SHEET_ID, SALES_SHEET_ID } from '../lib/domain/legacy-sheets';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const K = (v: unknown) => S(v).replace(/\s/g, '');
const arg = (name: string) => (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3);
/** 발행기는 RAW 문자열로 쓰므로 앞뒤 공백 외에는 한 글자도 정규화하지 않고 견준다. */
const EQ = (a: unknown, b: unknown) => S(a) === S(b);
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const api = async (u: string): Promise<any> => {
  for (let attempt = 1; ; attempt++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && attempt <= 5) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      continue;
    }
    throw new Error(`${r.status} ${t.slice(0, 160)}`);
  }
};
const F01 = SALES_SHEET_ID;
const F86 = HAHUHO_PRODUCT_SHEET_ID;

/** 탭마다 GET 하지 않고 한 시트를 한 번에 읽어 분당 quota 초과를 막는다. */
const readTabs = async (sheetId: string, titles: string[]): Promise<Map<string, string[][]>> => {
  const ranges = titles.map((title) => `ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:CZ3000`)}`).join('&');
  const result = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
  const out = new Map<string, string[][]>();
  titles.forEach((title, index) => {
    const values = result.valueRanges?.[index]?.values || [];
    out.set(title, values.map((row: any[]) => (row || []).map(S)));
  });
  return out;
};

// ── 원자 ────────────────────────────────────────────────────
const atoms = new Map<string, any>();
const atomList: any[] = [];
const snapshotPath = arg('snapshot');
if (!snapshotPath) throw new Error('F01·F86 감사에는 --snapshot=<이번 회차 고정 스냅샷>이 반드시 필요하다.');
const publishSnapshot = readSalesPublishSnapshot(snapshotPath);
const expectedMark = salesPublishMark(publishSnapshot);
const staleTimestampTabs: string[] = [];
for (const v of publishSnapshot.products as any[]) { atomList.push(v); atoms.set(K(v.car_number) || S(v._key), v); }
/**
 * ★**시트에 실려야 할 차 = 등록 원자 - 출고불가.** 저장된 `listable`은 정본이 아니라
 *   이 상태 계약과 같은지 확인하는 파생값이다. 가격·계약중·검수 대기로 대수를 줄이지 않는다.
 */
const inventory = inventoryCountSnapshot(atomList);
const 실릴차 = atomList.filter(isOpenInventoryAtom);
const rowCtx = await loadSalesRowContext({ policies: publishSnapshot.policies, partners: publishSnapshot.partners, companyAlias });
const expectedCell = makeCell(rowCtx);
const modelSold = new Map<string, number>();
try {
  const popularity = JSON.parse(readFileSync('public/data/model-popularity.json', 'utf8')) as { 순위?: Record<string, number> };
  for (const [model, count] of Object.entries(popularity.순위 || {})) modelSold.set(S(model), Number(count) || 0);
} catch { /* 발행기도 파일이 없으면 인기 축 없이 정렬한다. */ }
const modelCount = new Map<string, number>();
for (const atom of 실릴차) { const model = S(atom.model); if (model) modelCount.set(model, (modelCount.get(model) || 0) + 1); }
const compareRows = compareSalesRows(modelSold, modelCount);
console.log(`\n등록 원자 ${inventory.registered} · 출고불가 ${inventory.unavailable} · 시트에 실려야 할 현재 재고 ${inventory.open}`);
console.log(`발행 스냅샷 ${publishSnapshot.snapshotId} · ${publishSnapshot.capturedAt}`);
console.log(`파생값 드리프트 listable ${inventory.listableDrift} · status_kind ${inventory.statusKindDrift} · 원천 식별자 누락 ${inventory.sourceIdentityViolations} · 삭제표식 ${inventory.deletedMarkerViolations}`);

// ── ① 원자 ↔ F01 ────────────────────────────────────────────
type Row = { tab: string; car: string; cells: Record<string, string> };
const f01: Row[] = [];
const f01MissingColumns: string[] = [];
const f01TabShapeViolations: string[] = [];
const f01OrderViolations: string[] = [];
const f01BlankPlateRows: string[] = [];
const f01Order = new Map<string, string[]>();
{
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${F01}?fields=sheets.properties.title`);
  const titles: string[] = (meta.sheets || []).map((s: any) => S(s.properties?.title));
  const selected = SALES_PUBLISHED_TAB_PREFIXES.flatMap((prefix) => {
    const matches = titles.filter((x) => x === prefix || x.startsWith(prefix + ' '));
    if (matches.length !== 1) f01TabShapeViolations.push(`${prefix} ${matches.length}장`);
    return matches.map((title) => ({ prefix, title }));
  });
  if (expectedMark) for (const { prefix, title } of selected) {
    const count = 실릴차.filter((v) => tabOf(v) === prefix).length;
    const expectedTitle = `${prefix} ${expectedMark} · ${count}대`;
    if (title !== expectedTitle) staleTimestampTabs.push(`F01:${title} (기대: ${expectedTitle})`);
  }
  const grids = await readTabs(F01, selected.map((x) => x.title));
  for (const { prefix, title } of selected) {
    const grid = grids.get(title) || [];
    const hdr = grid[0] || []; const ci = hdr.indexOf('차량번호');
    const expectedHeader = salesPublishedColumns(prefix);
    if (JSON.stringify(hdr) !== JSON.stringify(expectedHeader)) {
      const missing = expectedHeader.filter((column) => !hdr.includes(column));
      const extra = hdr.filter((column) => !expectedHeader.includes(column));
      f01MissingColumns.push(`${prefix}: 열 계약 불일치${missing.length ? ` · 누락 ${missing.join(', ')}` : ''}${extra.length ? ` · 추가 ${extra.join(', ')}` : ''}`);
    }
    for (const r of grid.slice(1)) {
      const car = K(r[ci]);
      if (!car) { if (r.some((value) => S(value))) f01BlankPlateRows.push(`${prefix}: ${r.filter((value) => S(value)).slice(0, 3).join(' | ')}`); continue; }
      f01Order.set(prefix, [...(f01Order.get(prefix) || []), car]);
      const cells: Record<string, string> = {};
      hdr.forEach((h, i) => { if (S(h)) cells[S(h)] = S(r[i]); });
      f01.push({ tab: prefix, car, cells });
    }
  }
}
for (const prefix of SALES_PUBLISHED_TAB_PREFIXES) {
  const expected = 실릴차.filter((atom) => tabOf(atom) === prefix).sort(compareRows).map((atom) => K(atom.car_number));
  const actual = f01Order.get(prefix) || [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) f01OrderViolations.push(`${prefix}: 실제 ${actual.length}줄 ↔ 기대 ${expected.length}줄`);
}
const f01Cars = new Set(f01.map((r) => r.car));
const f01Counts = new Map<string, number>();
for (const row of f01) f01Counts.set(row.car, (f01Counts.get(row.car) || 0) + 1);
const f01Duplicates = [...f01Counts].filter(([, count]) => count > 1);
const 빠진차 = 실릴차.filter((v) => !f01Cars.has(K(v.car_number)));
const 남는차 = f01.filter((r) => { const a = atoms.get(r.car); return !a || isUnavailableInventoryAtom(a); });
const 어긋난칸 = new Map<string, { n: number; 표본: string[] }>();
const 핵심투영어긋남 = new Map<string, { n: number; 표본: string[] }>();
for (const r of f01) {
  const a = atoms.get(r.car); if (!a) continue;
  // 발행 함수와 독립된 직접 계약. makeCell 자체가 잘못 매핑돼도 원자 핵심축·원문 손실을 잡는다.
  const raw = (a['원문'] && typeof a['원문'] === 'object' ? a['원문'] : {}) as Record<string, unknown>;
  const rawOption = S(raw['옵션']);
  const core: Record<string, string> = {
    '모델': S(a.model),
    '세부모델': S(a.sub_model),
    '세부트림': S(a.trim_name),
    '차명(원문)': S(raw['차명']),
    '옵션(원문)': /[가-힣A-Za-z0-9]/.test(rawOption) ? rawOption : '',
  };
  for (const [column, expected] of Object.entries(core)) {
    const actual = S(r.cells[column]);
    if (actual === expected) continue;
    const entry = 핵심투영어긋남.get(column) || { n: 0, 표본: [] };
    entry.n++; if (entry.표본.length < 3) entry.표본.push(`${r.car} 시트「${actual || '—'}」↔ 원자 직접값「${expected || '—'}」`);
    핵심투영어긋남.set(column, entry);
  }
  const comparisons: Array<[string, string]> = Object.keys(r.cells).map((col) => [col, expectedCell(col, a)]);
  for (const [col, 원자] of comparisons) {
    const 시트 = r.cells[col];
    if (!원자 && !S(시트)) continue;
    if (EQ(시트, 원자)) continue;
    const e = 어긋난칸.get(col) || { n: 0, 표본: [] };
    e.n++; if (e.표본.length < 3) e.표본.push(`${r.car} 시트「${시트 || '—'}」↔ 원자「${원자 || '—'}」`);
    어긋난칸.set(col, e);
  }
}
/** ★요금 — 「값이 있어야 할 칸이 비었나」만 본다. 칸 이름이 회사마다 달라 1:1 로는 못 맞댄다. */
let 요금빈줄 = 0;
for (const r of f01) {
  const a = atoms.get(r.car); if (!a) continue;
  const 원자요금 = a.price && typeof a.price === 'object' && Object.keys(a.price).length;
  if (!원자요금) continue;
  const 시트요금 = Object.entries(r.cells).some(([h, v]) => /개월|월렌트/.test(h) && !isDepositColumn(h) && S(v) && S(v) !== '-');
  if (!시트요금) 요금빈줄++;
}

console.log(`\n■ ① 원자 ↔ 상품리스트 F01 — 시트 ${f01.length}줄`);
console.log(`  실려야 하는데 «빠진 차» ${빠진차.length}`);
if (빠진차.length) console.log(`     ${빠진차.slice(0, 6).map((v) => `${S(v.car_number)}(${S(v.provider_name) || S(v.provider_company_code)}·${S(v.vehicle_status)})`).join(' · ')}`);
console.log(`  내려야 하는데 «서 있는 차» ${남는차.length}`);
if (남는차.length) console.log(`     ${남는차.slice(0, 6).map((r) => r.car).join(' · ')}`);
console.log(`  값이 다른 칸 ${[...어긋난칸.values()].reduce((s, e) => s + e.n, 0)}`);
for (const [col, e] of [...어긋난칸].sort((a, b) => b[1].n - a[1].n)) console.log(`     ${col} ${e.n} — ${e.표본.join(' · ')}`);
console.log(`  원자엔 요금이 있는데 시트 대여료가 통째로 빈 줄 ${요금빈줄}`);

// ── ② F01 ↔ F86 ─────────────────────────────────────────────
type F86Row = { company: string; cells: Record<string, string> };
const f86 = new Map<string, F86Row>();
const f86Counts = new Map<string, number>();
const f86TabShapeViolations: string[] = [];
const f86HeaderViolations: string[] = [];
const f86OrderViolations: string[] = [];
const f86BlankPlateRows: string[] = [];
const f86WrongCompany: string[] = [];
const f86Order = new Map<string, string[]>();
let f86줄 = 0;
{
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${F86}?fields=sheets.properties.title`);
  const titles: string[] = (meta.sheets || []).map((s: any) => S(s.properties?.title)).filter((t: string) => !/공지|안내|이 시트/.test(t));
  const expectedCompanies = new Map<string, number>();
  for (const row of f01) {
    const company = channelCompanyOf(row.cells['공급사'], rowCtx.nameByProvider);
    expectedCompanies.set(company, (expectedCompanies.get(company) || 0) + 1);
  }
  const expectedTitles = new Map([...expectedCompanies].map(([company, count]) => [`${company} ${expectedMark} · ${count}대`, company]));
  const channelColumns: string[] = [];
  for (const prefix of SALES_PUBLISHED_TAB_PREFIXES) for (const raw of salesPublishedColumns(prefix)) {
    const column = channelColumnName(raw);
    if (column && !channelColumns.includes(column)) channelColumns.push(column);
  }
  const expectedHeaders = new Map<string, string[]>();
  for (const company of expectedCompanies.keys()) {
    const companyRows = f01.filter((row) => channelCompanyOf(row.cells['공급사'], rowCtx.nameByProvider) === company);
    expectedHeaders.set(company, channelColumns.filter((column) => {
      const optionalFee = isMoneyColumn(column) && !/가격/.test(column);
      if (!optionalFee) return true;
      return companyRows.some((row) => Object.entries(row.cells).some(([raw, value]) => channelColumnName(raw) === column && S(value) && S(value) !== '-'));
    }));
  }
  if (expectedMark) {
    for (const title of titles) if (!expectedTitles.has(title)) f86TabShapeViolations.push(`예상 밖 탭: ${title}`);
    for (const title of expectedTitles.keys()) if (!titles.includes(title)) f86TabShapeViolations.push(`빠진 탭: ${title}`);
  }
  const grids = await readTabs(F86, titles);
  for (const t of titles) {
    const company = expectedTitles.get(t) || '';
    const grid = grids.get(t) || [];
    const hdr = grid[0] || []; const ci = hdr.indexOf('차량번호');
    const expectedHeader = expectedHeaders.get(company);
    if (expectedHeader && JSON.stringify(hdr) !== JSON.stringify(expectedHeader)) {
      f86HeaderViolations.push(`${company}: 실제 ${hdr.length}열 ↔ 기대 ${expectedHeader.length}열`);
    }
    if (ci < 0) continue;
    for (const r of grid.slice(1)) {
      const car = K(r[ci]);
      if (!car) { if (r.some((value) => S(value))) f86BlankPlateRows.push(`${company || t}: ${r.filter((value) => S(value)).slice(0, 3).join(' | ')}`); continue; }
      f86Order.set(company, [...(f86Order.get(company) || []), car]);
      f86줄++;
      f86Counts.set(car, (f86Counts.get(car) || 0) + 1);
      const cells: Record<string, string> = {};
      hdr.forEach((h, i) => { if (S(h)) cells[S(h)] = S(r[i]); });
      f86.set(car, { company, cells });
    }
  }
  for (const company of expectedCompanies.keys()) {
    const expected = 실릴차
      .filter((atom) => channelCompanyOf(expectedCell('공급사', atom), rowCtx.nameByProvider) === company)
      .sort(compareRows)
      .map((atom) => K(atom.car_number));
    const actual = f86Order.get(company) || [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) f86OrderViolations.push(`${company}: 실제 ${actual.length}줄 ↔ 기대 ${expected.length}줄`);
  }
}
const f86Duplicates = [...f86Counts].filter(([, count]) => count > 1);
const F86빠짐 = f01.filter((r) => !f86.has(r.car));
/** 두 출력은 같은 원자를 쓰므로 F01 에 없는 차가 F86 에 서면 묵은 탭이거나 헛것이다. */
const F86헛것 = [...f86.keys()].filter((c) => !f01Cars.has(c));
const F86값차이 = new Map<string, { n: number; 표본: string[] }>();
for (const r of f01) {
  const found = f86.get(r.car); if (!found) continue;
  const expectedCompany = channelCompanyOf(r.cells['공급사'], rowCtx.nameByProvider);
  if (expectedCompany && found.company !== expectedCompany) f86WrongCompany.push(`${r.car} ${found.company || '알 수 없는 탭'} ↔ ${expectedCompany}`);
  const b = found.cells;
  for (const [rawCol, v] of Object.entries(r.cells)) {
    const col = channelColumnName(rawCol);
    if (!(col in b)) {
      // F86은 회사 전체가 안 쓰는 빈 요금 열만 생략할 수 있다. 값이 있거나 비요금 열이면 누락이다.
      if (!isMoneyColumn(col) || S(v)) {
        const e = F86값차이.get(`누락:${col}`) || { n: 0, 표본: [] };
        e.n++; if (e.표본.length < 3) e.표본.push(`${r.car} F01「${v || '—'}」↔ F86 열 없음`);
        F86값차이.set(`누락:${col}`, e);
      }
      continue;
    }
    if (EQ(v, b[col])) continue;
    const e = F86값차이.get(col) || { n: 0, 표본: [] };
    e.n++; if (e.표본.length < 3) e.표본.push(`${r.car} F01「${v || '—'}」↔ F86「${b[col] || '—'}」`);
    F86값차이.set(col, e);
  }
}
console.log(`\n■ ② 상품리스트 F01 ↔ 하허호 F86 — F86 ${f86줄}줄`);
console.log(`  F01 에 있는데 F86 에 «없는 차» ${F86빠짐.length}${F86빠짐.length ? ` — ${F86빠짐.slice(0, 6).map((r) => r.car).join(' · ')}` : ''}`);
console.log(`  F01 에 없는데 F86 에 «서 있는 차» ${F86헛것.length}${F86헛것.length ? ` — ${F86헛것.slice(0, 6).join(' · ')}` : ''}`);
console.log(`  값이 다른 칸 ${[...F86값차이.values()].reduce((s, e) => s + e.n, 0)}`);
for (const [col, e] of [...F86값차이].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) console.log(`     ${col} ${e.n} — ${e.표본.join(' · ')}`);

// ── 결과 ────────────────────────────────────────────────────
/**
 * ★**막는 것과 알리는 것을 가른다.**
 *   빠진 차·헛것·값 어긋남은 «틀린 표»라 막는다. 요금 빈 줄은 원천 몫이라 알린다.
 */
const 막음: string[] = [];
if (inventory.listableDrift) 막음.push(`저장된 listable 이 상태 정본과 다른 원자 ${inventory.listableDrift}대`);
if (inventory.statusKindDrift) 막음.push(`저장된 status_kind 가 상태 정본과 다른 원자 ${inventory.statusKindDrift}대`);
if (inventory.sourceIdentityViolations) 막음.push(`공급사 또는 원천 식별자가 없는 원자 ${inventory.sourceIdentityViolations}대`);
if (inventory.deletedMarkerViolations) 막음.push(`삭제표식 원자 ${inventory.deletedMarkerViolations}대 — 판매차는 출고불가로 남겨야 한다`);
if (inventory.blankPlateViolations || inventory.invalidPlateViolations || inventory.duplicatePlateViolations) 막음.push(`차량번호 계약 위반 — 빈 값 ${inventory.blankPlateViolations} · 형식 오류 ${inventory.invalidPlateViolations} · 중복 ${inventory.duplicatePlateViolations}`);
if (staleTimestampTabs.length) 막음.push(`발행 스냅샷 시각과 다른 탭 ${staleTimestampTabs.length}개 — ${staleTimestampTabs.slice(0, 4).join(' · ')}`);
if (f01MissingColumns.length) 막음.push(`F01 필수 열 누락 ${f01MissingColumns.length}개 탭 — ${f01MissingColumns.slice(0, 2).join(' · ')}`);
if (f01TabShapeViolations.length) 막음.push(`F01 상품 탭 수 어긋남 — ${f01TabShapeViolations.join(' · ')}`);
if (f01OrderViolations.length) 막음.push(`F01 행 순서 어긋남 ${f01OrderViolations.length}개 탭 — ${f01OrderViolations.join(' · ')}`);
if (f01BlankPlateRows.length) 막음.push(`F01 값은 있는데 차량번호가 빈 행 ${f01BlankPlateRows.length}개 — ${f01BlankPlateRows.slice(0, 3).join(' · ')}`);
if (빠진차.length) 막음.push(`시트에 «빠진 차» ${빠진차.length}대 — 팔 수 있는데 어디에도 안 선다`);
if (남는차.length) 막음.push(`시트에 «남은 차» ${남는차.length}대 — 출고불가인데 서 있다(판 차를 또 판다)`);
if (f01Duplicates.length) 막음.push(`F01 중복 차량번호 ${f01Duplicates.length}개 — ${f01Duplicates.slice(0, 4).map(([car, count]) => `${car}(${count}줄)`).join(' · ')}`);
if (f86Duplicates.length) 막음.push(`F86 중복 차량번호 ${f86Duplicates.length}개 — ${f86Duplicates.slice(0, 4).map(([car, count]) => `${car}(${count}줄)`).join(' · ')}`);
if (f86TabShapeViolations.length) 막음.push(`F86 회사 탭 이름·구성 어긋남 ${f86TabShapeViolations.length}건 — ${f86TabShapeViolations.slice(0, 4).join(' · ')}`);
if (f86HeaderViolations.length) 막음.push(`F86 머리글 순서·구성 어긋남 ${f86HeaderViolations.length}건 — ${f86HeaderViolations.slice(0, 4).join(' · ')}`);
if (f86OrderViolations.length) 막음.push(`F86 행 순서 어긋남 ${f86OrderViolations.length}개 탭 — ${f86OrderViolations.slice(0, 4).join(' · ')}`);
if (f86BlankPlateRows.length) 막음.push(`F86 값은 있는데 차량번호가 빈 행 ${f86BlankPlateRows.length}개 — ${f86BlankPlateRows.slice(0, 3).join(' · ')}`);
if (f86WrongCompany.length) 막음.push(`F86 잘못된 회사 탭에 놓인 차 ${f86WrongCompany.length}대 — ${f86WrongCompany.slice(0, 4).join(' · ')}`);
if (F86헛것.length) 막음.push(`F86 에 헛것 ${F86헛것.length}대 — 묵은 탭이 남았을 수 있다`);
if (F86빠짐.length) 막음.push(`F86 에 «안 옮겨진 차» ${F86빠짐.length}대`);
const 칸어긋남 = [...어긋난칸.values()].reduce((s, e) => s + e.n, 0) + [...F86값차이.values()].reduce((s, e) => s + e.n, 0);
if (칸어긋남) 막음.push(`값이 다른 칸 ${칸어긋남}개 — 시트와 원자가 다른 말을 한다`);
const 핵심칸어긋남 = [...핵심투영어긋남.values()].reduce((sum, entry) => sum + entry.n, 0);
if (핵심칸어긋남) 막음.push(`독립 핵심축·원문 대조 실패 ${핵심칸어긋남}칸 — ${[...핵심투영어긋남].slice(0, 4).map(([column, entry]) => `${column} ${entry.n}`).join(' · ')}`);

console.log('');
if (요금빈줄) console.log(`  ▲ 원자엔 요금이 있는데 시트가 빈 줄 ${요금빈줄}`);
for (const x of 막음) console.log(`  ⛔ ${x}`);
if (막음.length) { console.log(`\n⛔ 시트가 원자대로 «안 박혔다» — ${막음.length}갈래.\n`); process.exit(1); }
console.log(`\n✓ 시트가 원자대로 박혔다${요금빈줄 ? ` — 알림 1건` : ''}\n`);
process.exit(0);
