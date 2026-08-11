/**
 * **한 공급사의 재고 정본을 우리 시트로 넘긴다.** 기본 dry-run, 실제 반영은 `--apply`.
 *
 * 공급사가 「프리패스 재고 · <업체>」 시트를 확인·수정한 **뒤에** 부른다.
 * 이걸 부르는 순간부터 ERP 는 그 시트를 읽고, 공급사가 옛 시트를 고쳐도 반영되지 않는다.
 *
 * ★한 곳씩만 넘긴다(`--only=RP013` 필수). 한꺼번에 넘기면 어디서 틀어졌는지 못 짚는다.
 *
 * ★넘기기 전에 스스로 막는 것
 *   · 우리 시트에 **한 줄도 없으면** 안 넘긴다 — 재고가 통째로 사라진다.
 *   · 지금 ERP 재고보다 **줄어드는 폭이 크면** 안 넘긴다(기본 20% 초과 시 중단, `--force` 로 강제).
 *   · 차량번호가 겹치지 않는 차가 많으면 알려 준다 — 다른 회사 시트를 가리켰을 수 있다.
 *
 * ★두 곳을 함께 고친다. 하나만 고치면 다음 동기화에 되돌아간다.
 *   · 허브 「공급사시트정리」의 그 줄 주소 — `overlayHubSheetUrls` 가 이걸 정본으로 덮어쓴다.
 *   · RTDB 파트너의 `sheet_url` (v3·v4 둘 다). 탭 지정(`sheet_tab`·`sheet_gid`)은 지운다 —
 *     파일이 바뀌었으므로 옛 파일에만 유효한 gid 는 버려야 한다.
 *
 *   npx tsx scripts/switch-supplier-sheet.mts --only=RP013
 *   npx tsx scripts/switch-supplier-sheet.mts --only=RP013 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, findPlateAndStatusColumns, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { isListableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const CODE = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const HUB = '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY';   // 코드가 읽는 「공급사시트정리」
const MAX_DROP = 0.2;

if (!CODE) { console.log('■ 어느 공급사인지 지정해야 한다 — --only=RP013\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/** 그 공급사 파트너 레코드 — v3·v4 둘 다 고쳐야 한다. */
const targets: { table: string; key: string; row: Rec }[] = [];
for (const [table, src] of [['partners', t3], ['v4/partners', t4]] as [string, Rec][]) {
  for (const [k, v] of Object.entries<Rec>(src)) {
    if (v && typeof v === 'object' && !dead(v) && (S(v.partner_code) === CODE || k === CODE)) targets.push({ table, key: k, row: v });
  }
}
if (!targets.length) { console.log(`■ ${CODE} 파트너를 못 찾았다\n`); process.exit(1); }
const name = S(targets[0].row.partner_name || targets[0].row.name || targets[0].row.company_name) || CODE;
const liveUrl = S(targets.map((t) => S(t.row.sheet_url)).find(Boolean));

// 우리 시트 찾기
const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'`);
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)`);
const short = name.replace(/\s|\(주\)|주식회사|㈜|렌터카|렌트카/g, '');
const mineFile = ((found.files || []) as Rec[]).find((f) => {
  const label = S(f.name).replace('프리패스 재고 · ', '').replace(/\s/g, '');
  return label === short || short.includes(label) || label.includes(short);
});
if (!mineFile) { console.log(`■ ${name} 의 우리 시트를 못 찾았다 — 먼저 build-supplier-sheet-set 로 만들어라\n`); process.exit(1); }
const mineId = S(mineFile.id);

console.log(`■ ${name}(${CODE}) 재고 정본을 우리 시트로 넘긴다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  지금 읽는 곳  ${liveUrl.slice(0, 78) || '(없음)'}`);
console.log(`  넘길 곳      https://docs.google.com/spreadsheets/d/${mineId}/edit  「${S(mineFile.name)}」\n`);
if (liveUrl.includes(mineId)) { console.log('  이미 우리 시트를 읽고 있다 — 할 일 없음\n'); process.exit(0); }

// 우리 시트를 규격대로 읽어 «넘긴 뒤 몇 대가 되는가»를 미리 센다.
const grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${mineId}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
const read = readSupplierSheet(grid as never, targets[0].row as EntityRecord);
const sheetPlates = new Set<string>();
for (const t of read.tabs) {
  const hdr = (t.table[0] || []).map(S);
  const { plate } = findPlateAndStatusColumns(hdr);
  if (plate < 0) continue;
  for (const r of t.table.slice(1)) { const pl = norm(r[plate]); if (pl) sheetPlates.add(pl); }
}
const erpPlates = new Set<string>();
for (const p of Object.values<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  if ((S(p.provider_company_code) || S(p.partner_code)) !== CODE) continue;
  const pl = norm(p.car_number);
  if (pl) erpPlates.add(pl);
}
const onlyErp = [...erpPlates].filter((x) => !sheetPlates.has(x));
const onlySheet = [...sheetPlates].filter((x) => !erpPlates.has(x));
console.log(`  우리 시트 ${sheetPlates.size}대 · 지금 ERP ${erpPlates.size}대`);
console.log(`  시트에 없는 ERP 차 ${onlyErp.length}대${onlyErp.length ? ` — ${onlyErp.slice(0, 8).join(' · ')}${onlyErp.length > 8 ? ' …' : ''}` : ''}`);
console.log(`  ERP 에 없는 시트 차 ${onlySheet.length}대${onlySheet.length ? ` — ${onlySheet.slice(0, 8).join(' · ')}${onlySheet.length > 8 ? ' …' : ''}` : ''}`);
if (read.failures.length) for (const f of read.failures) console.log(`  △ 못 읽은 탭 「${f.title}」 — ${f.reason.slice(0, 50)}`);

const drop = erpPlates.size ? onlyErp.length / erpPlates.size : 0;
if (!sheetPlates.size) { console.log('\n  ✗ 우리 시트가 비어 있다 — 넘기면 재고가 통째로 사라진다. 먼저 채워라.\n'); process.exit(1); }
if (drop > MAX_DROP && !FORCE) {
  console.log(`\n  ✗ 지금 재고의 ${Math.round(drop * 100)}% 가 시트에 없다(기준 ${MAX_DROP * 100}%). 넘기지 않는다.`);
  console.log('    시트를 채우거나, 정말 줄이는 것이면 --force 를 준다.\n');
  process.exit(1);
}

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

// ① 허브 주소 — 이게 정본이다. 안 고치면 다음 동기화에 되돌아간다.
const newUrl = `https://docs.google.com/spreadsheets/d/${mineId}/edit`;
const hubMeta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}?fields=sheets(properties(title))`);
const hubTab = S(((hubMeta.sheets || []) as Rec[])[0]?.properties?.title);
const hubVals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}/values/${encodeURIComponent(hubTab)}`);
const hubRows = ((hubVals.values || []) as string[][]);
const hubHdr = (hubRows[0] || []).map(S);
const cCode = hubHdr.findIndex((h) => /코드/.test(h));
const cUrl = hubHdr.findIndex((h) => /시트|주소|url/i.test(h));
const at = hubRows.findIndex((r, i) => i > 0 && S(r[cCode]) === CODE);
if (at < 0) { console.log(`  ✗ 허브에 ${CODE} 줄이 없다 — 먼저 허브에 그 공급사를 넣어라\n`); process.exit(1); }
const a1 = `${hubTab}!${String.fromCharCode(65 + cUrl)}${at + 1}`;
await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`, {
  method: 'PUT', body: JSON.stringify({ values: [[newUrl]] }),
});
console.log(`  허브 ${a1} 갱신`);

// ② 파트너 레코드 — v3·v4 둘 다. 탭 지정은 버린다(파일이 바뀌었다).
const at2 = new Date().toISOString();
for (const t of targets) {
  const res = await fetch(`${DB}/${t.table}/${encodeURIComponent(t.key)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sheet_url: newUrl, sheet_tab: '', sheet_gid: '',
      sheet_note: `우리 제공 시트로 전환(${at2.slice(0, 10)}) — 옛 주소 ${liveUrl.slice(0, 90)}`,
      updatedAt: at2,
    }),
  });
  console.log(res.ok ? `  ${t.table}/${t.key} 갱신` : `  △ ${t.table}/${t.key} 실패 ${res.status}`);
}
console.log(`\n  ${name} 은(는) 이제 우리 시트를 읽는다. 다음: 동기화 후 대수를 확인한다.\n`);
