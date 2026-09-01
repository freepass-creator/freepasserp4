/**
 * **「있는 걸 그대로 갖고 오나」를 잰다** — 정제칸 ▶ 판매시트 ▶ ERP ▶ 화면 네 지점의 «글자»를 대조한다. 읽기 전용.
 *
 * ★왜(사장님 2026-08-23 「니가 빼면 안 되고 있는 걸 그대로 갖고 오는 거잖아 · 그렇게 로직을 짜야 해」
 *   · 「커서가 잘 작업하면 그거 그대로 가져오는 거로만 지금은 잘돼 있니?」)
 *   채움률 검사(`audit:axes`)는 «값이 있나»만 본다. **값이 있는데 도중에 바뀌는 것**은 못 잡는다.
 *   실제로 2026-08-23 오전에 옮기는 길에서 개발코드를 깎아 정제칸과 화면이 갈렸다.
 *   이 검사는 **글자가 같은지**를 본다 — 다르면 어느 구간에서 바뀌었는지 짚어 준다.
 *
 *   npx tsx scripts/audit-passthrough.mts
 *   npx tsx scripts/audit-passthrough.mts --gate   # 어긋나면 exit 1
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { isOfferableProduct } from '../lib/domain/product';
import { vehicleNameOf } from '../lib/domain/vehicle-name';

const GATE = process.argv.includes('--gate');
const S = (v: unknown) => String(v ?? '').trim();
const plateKey = (v: unknown) => S(v).replace(/\s+/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const sheetJwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
// ⚠ 위임(subject)과 RTDB 스코프를 한 클라이언트에 섞으면 401 unauthorized_client — 반드시 나눈다.
const dbJwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const api = async (u: string): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await sheetJwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 140)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

/** 대조할 축 — 정제칸 이름 / 판매시트 열 / ERP 필드. 글자가 그대로여야 하는 것만 담는다. */
const AXES: { label: string; refined: string; sales: string; erp: string }[] = [
  { label: '세부모델', refined: '세부모델', sales: '세부모델', erp: 'sub_model' },
  { label: '세부트림', refined: '세부트림', sales: '세부트림', erp: 'trim_name' },
  { label: '모델', refined: '모델', sales: '모델', erp: 'model' },
  { label: '차종구분', refined: '차종분류', sales: '차종구분', erp: 'vehicle_class' },
  { label: '옵션', refined: '선택옵션', sales: '옵션', erp: 'options' },
];

// ── ① 정제칸
type Cell = Record<string, string>;
const refined = new Map<string, { sup: string; v: Cell }>();
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
for (const f of (found.files || [])) {
  const meta = await api(`${SH}/${S(f.id)}?fields=sheets.properties(title,hidden)`);
  for (const sh of (meta.sheets || [])) {
    const title = S(sh.properties.title);
    if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
    const v = await api(`${SH}/${S(f.id)}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:CZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => (r || []).map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const head = rows[hi];
    const ip = head.indexOf('차량번호');
    for (const r of rows.slice(hi + 1)) {
      const plate = plateKey(r[ip]);
      if (!plate) continue;
      const cell: Cell = {};
      for (const a of AXES) { const i = head.indexOf(a.refined); cell[a.label] = i >= 0 ? S(r[i]) : ''; }
      refined.set(plate, { sup: supplierSheetLabel(S(f.name)), v: cell });
    }
    break;
  }
  await sleep(100);
}

// ── ② 판매시트
const sales = new Map<string, Cell>();
const meta = await api(`${SH}/${SALES_SHEET_ID}?fields=sheets.properties(title,hidden)`);
const titles = (meta.sheets || []).filter((s: any) => !s.properties.hidden).map((s: any) => S(s.properties.title));
for (const t of pickPublishedSalesTabs(titles)) {
  const v = await api(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent(`'${t.title.replace(/'/g, "''")}'!A1:CZ700`)}`) as { values?: string[][] };
  const rows = ((v.values || []) as string[][]).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  const head = rows[hi] || [];
  const ip = head.indexOf('차량번호');
  for (const r of rows.slice(hi + 1)) {
    const plate = plateKey(r[ip]);
    if (!plate) continue;
    const cell: Cell = {};
    for (const a of AXES) { const i = head.indexOf(a.sales); cell[a.label] = i >= 0 ? S(r[i]) : ''; }
    sales.set(plate, cell);
  }
}

// ── ③ ERP (판매가능만 — 출고불가는 발행에서 빠져 옛 값이 굳는 게 정상이다)
const tok = (await dbJwt.getAccessToken()).token;
const all = await (await fetch(`https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app/v4/products.json?access_token=${tok}`)).json() as Record<string, any>;
const erp = new Map<string, any>();
for (const [, p] of Object.entries(all)) {
  if (!isOfferableProduct(p as any)) continue;
  const plate = plateKey((p as any).car_number);
  if (plate) erp.set(plate, p);
}

// ── 대조
type Break = { plate: string; sup: string; axis: string; leg: string; from: string; to: string };
const breaks: Break[] = [];
let checkedSheet = 0; let checkedErp = 0;
for (const [plate, { sup, v }] of refined) {
  const sl = sales.get(plate);
  if (sl) {
    checkedSheet++;
    for (const a of AXES) {
      // 정제칸이 빈 칸이면 판매시트가 공급사 원문으로 채우는 게 정상 — «바뀐 것»이 아니다.
      if (!v[a.label]) continue;
      if (sl[a.label] && sl[a.label] !== v[a.label]) breaks.push({ plate, sup, axis: a.label, leg: '정제칸▶판매시트', from: v[a.label], to: sl[a.label] });
    }
  }
  const e = erp.get(plate);
  if (e && sl) {
    checkedErp++;
    for (const a of AXES) {
      if (!sl[a.label]) continue;
      const got = S(e[a.erp]);
      if (got && got !== sl[a.label]) breaks.push({ plate, sup, axis: a.label, leg: '판매시트▶ERP', from: sl[a.label], to: got });
    }
  }
}

// ── ④ 화면 차명 = 세부모델 + 세부트림 인가
/**
 * 두 성격을 가른다.
 *  · **보완** — ERP 축이 비어 옛 결정(`_review_identity`)이 채운 것. 이름이 없는 것보다 낫다 → 정상.
 *  · **가공** — ERP 에 값이 있는데 화면이 글자를 바꾼 것 → 이게 사고다.
 */
let nameBreaks = 0; let filled = 0; const nameSample: string[] = [];
for (const [plate, p] of erp) {
  const sub = S(p.sub_model); const trim = S(p.trim_name);
  if (!sub) continue;
  const want = [sub, trim].filter(Boolean).join(' ');
  const got = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', omitMaker: true });
  const flat = (v: string) => v.replace(/\s+/g, ' ').trim();
  if (flat(got) === flat(want)) continue;
  // ERP 값이 화면 이름 «안에» 그대로 들어 있으면 빠진 축을 덧붙인 것 — 깎지 않았다.
  if (flat(got).includes(flat(want))) { filled++; continue; }
  nameBreaks++;
  if (nameSample.length < 8) nameSample.push(`  ${plate}  ERP「${want}」 ▶ 화면「${got}」`);
}

console.log('■ 있는 걸 그대로 갖고 오나 — 글자 대조\n');
console.log(`  정제칸 ${refined.size}대 · 판매시트 ${sales.size}대 · ERP 판매가능 ${erp.size}대`);
console.log(`  대조한 차: 정제칸▶판매시트 ${checkedSheet}대 · 판매시트▶ERP ${checkedErp}대\n`);

const byLeg = new Map<string, Break[]>();
for (const b of breaks) { const a = byLeg.get(b.leg) || []; a.push(b); byLeg.set(b.leg, a); }
for (const leg of ['정제칸▶판매시트', '판매시트▶ERP']) {
  const list = byLeg.get(leg) || [];
  if (!list.length) { console.log(`  ✓ ${leg.padEnd(16)} 글자가 그대로다`); continue; }
  console.log(`  ⛔ ${leg} — ${list.length}건 바뀜`);
  for (const b of list.slice(0, 8)) console.log(`     ${b.sup} ${b.plate} [${b.axis}] 「${b.from}」 ▶ 「${b.to}」`);
  if (list.length > 8) console.log(`     … 외 ${list.length - 8}건`);
}
if (filled) console.log(`  · ERP▶화면 보완        ${filled}건 — ERP 축이 비어 옛 결정이 덧붙었다(깎지는 않았다)`);
if (!nameBreaks) console.log('  ✓ ERP▶화면 차명       세부모델 + 세부트림 그대로');
else {
  console.log(`  ⛔ ERP▶화면 차명 — ${nameBreaks}건이 «세부모델 + 세부트림»과 다르다`);
  nameSample.forEach((l) => console.log(l));
}

const bad = breaks.length + nameBreaks;
if (bad) {
  console.log(`\n  ⛔ 모두 ${bad}건 — **옮기는 길에서 글자가 바뀌고 있다.**`);
  console.log('     고칠 곳은 시트가 아니라 옮기는 코드다(발행기·유입·표시). 반대로 값 자체가 틀렸으면 시트를 고친다.');
  if (GATE) process.exit(1);
} else {
  console.log('\n  ✓ 네 지점 글자가 전부 같다 — 있는 걸 그대로 나른다');
}
