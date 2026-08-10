/**
 * **공급사 시트가 정본이다** — 시트는 팔 수 있다는데 ERP 가 막고 있는 차의 상태를 시트로 되돌린다.
 * 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 필요한가(2026-08-10)
 *   시트 동기화는 `공급사코드_차번` 키에 쓰는데 그 키가 삭제돼 있으면 되살아나지 못한다.
 *   살아남은 `EXT_` 레코드는 옛 상태를 든 채 남아, 시트를 고쳐도 영원히 안 바뀐다.
 *   손오공 161하1687 이 그랬다 — 시트 「출고가능」, ERP 「출고불가」, 영업자 시트에서 실종.
 *   `audit-sheet-erp-gap` 이 세어 보니 108대였다.
 *
 * ★건드리는 것은 `vehicle_status` **하나뿐**이다.
 *   차종·대여료·옵션은 손대지 않는다 — 여기서 고칠 근거가 없고, 덮으면 되돌릴 수 없다.
 *
 * ⚠ 이건 **응급 처치**다. 부활 경로를 고치지 않으면 같은 일이 또 쌓인다.
 *
 * ★**닫는 쪽도 시트를 따른다**(사장님 2026-08-10 — 「시트가 계약중·보류면 빼야지」).
 *   전에는 여는 쪽으로만 움직였다 — 팔 수 있는 차를 실수로 내리지 않으려던 것인데,
 *   그러면 시트에서 팔린 차가 ERP 에 계속 열려 있어 **없는 차를 판다.** 그게 더 나쁘다.
 *   시트가 「출고불가」(계약중·보류·출고완료 …)라고 하면 ERP 도 닫는다.
 *
 * ⚠ 닫는 것은 시트에 **그 차가 실제로 적혀 있을 때만**이다.
 *   시트에서 사라진 차는 여기서 손대지 않는다 — 그건 `purge-aggregate-leftovers` 몫이다.
 *   (시트를 못 읽은 공급사의 차가 통째로 닫히면 안 된다.)
 *
 *   npx tsx scripts/fix-sheet-status-gap.mts
 *   npx tsx scripts/fix-sheet-status-gap.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isHiddenFromCatalog, isListableProduct, priceList } from '../lib/domain/product';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

/** 격자 전체를 한 번에 받는다 — 탭마다 따로 부르면 분당 읽기 한도에 걸린다. */
const GRID_FIELDS = 'sheets(properties(sheetId,title,hidden),data(rowMetadata(hiddenByFilter,hiddenByUser),rowData(values(formattedValue))))';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const grabGrid = async (id: string, tries = 4): Promise<SheetsGridResponse> => {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(GRID_FIELDS)}`;
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${shT}` } });
    const j = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return j as SheetsGridResponse;
    if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(10000 * (i + 1)); continue; }
    throw new Error(j?.error?.message || `HTTP ${res.status}`);
  }
};

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: any) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const partners: Record<string, any> = {};
for (const src of [t3, t4] as any[]) for (const [k, v] of Object.entries<any>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const sheets = new Map<string, { name: string; url: string; partner: Rec }>();
for (const p of Object.values<any>(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code) || S(p._key);
  // 아이언은 홈페이지가 정본이라 시트로 판단하지 않는다.
  if (c === 'RP006') continue;
  if (S(p.sheet_url) && !sheets.has(c)) sheets.set(c, { name: S(p.partner_name || p.name || p.company_name) || c, url: S(p.sheet_url), partner: p });
}

const all = Object.entries<any>(prods).filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));
// 차번 집합만 필요하다 — 중복제거는 같은 차의 «줄 수»만 줄이므로 여기 결과를 바꾸지 않는다.
const onSheet = new Set(all.filter(isListableProduct).map((p: any) => norm(p.car_number)));
/** 같은 차번이 여러 레코드면 **살아있는 것 전부**를 고친다 — 하나만 고치면 다른 게 계속 가린다. */
const byPlate = new Map<string, EntityRecord[]>();
for (const p of all) {
  const pl = norm((p as any).car_number);
  if (pl) byPlate.set(pl, [...(byPlate.get(pl) || []), p]);
}

type Fix = { plate: string; code: string; name: string; sheetSt: string; want: string; key: string; from: string; prices: number };
const fixes: Fix[] = []; const noPrice: Fix[] = []; const absent: string[][] = [];
/** 시트가 닫으라고 한 차 — 계약중·보류·출고완료 등. */
const close: Fix[] = [];
/** 어느 시트를 몇 줄이나 읽었나 — 「0건」이 «깨끗해서»인지 «못 읽어서»인지 가른다. */
const read: { code: string; name: string; rows: number; err: string }[] = [];

for (const [code, meta] of sheets) {
  const id = meta.url.match(/\/d\/([\w-]+)/)?.[1];
  if (!id) continue;
  const rows: { plate: string; st: string }[] = [];
  try {
    /**
     * ★운영 유입과 **같은 길로 읽는다**(2026-08-10에 고침).
     *   숨긴 행·숨긴 탭을 빼고, 공급사 어댑터로 헤더 행을 찾는다.
     *   raw values 를 1행=헤더로 읽던 때는 오플이 통째로 안 읽히고 옛 탭이 재고로 세어져,
     *   「유입 안 된 차 1,499대」 같은 숫자가 나왔다. 그 판단으로 쓰기를 하면 안 된다.
     */
    const grid = await grabGrid(id);
    const adapter = resolveAdapter(meta.partner as EntityRecord);
    /** `sheet_tab` 은 gid 여러 개를 쉼표로 담을 수 있다(빌린카). */
    const pinned = new Set(S(meta.partner.sheet_tab).split(',').map(S).filter(Boolean));
    for (const sh of (grid.sheets || []) as Rec[]) {
      const gid = String(sh.properties?.sheetId ?? '');
      if (pinned.size ? !pinned.has(gid) : sh.properties?.hidden === true) continue;
      let table: string[][];
      try { table = (visibleRowsFromGridResponse(grid, gid) as Rec).rows as string[][]; } catch { continue; }
      let prepared: string[][];
      try { prepared = adapter.prepareTable(table, { headerRow: Number(meta.partner.sheet_header_row) || undefined }); } catch { continue; }
      const hdr = (prepared[0] || []).map(S);
      const si = hdr.findIndex((h) => /배차상태|^상태|판매상태|재고상태|출고상태|출고현황/.test(h));
      const pi = hdr.findIndex((h) => /차량번호|차번/.test(h));
      if (si < 0 || pi < 0) continue;
      for (const r of prepared.slice(1)) { const pl = norm(r[pi]); if (pl && pl.length >= 6) rows.push({ plate: pl, st: S(r[si]) }); }
    }
  } catch (e) {
    // ★조용히 넘어가면 안 된다 — 전부 실패해도 「어긋남 0건」으로 보여 거짓 초록불이 된다.
    read.push({ code, name: meta.name, rows: -1, err: String((e as Error).message).slice(0, 60) });
    continue;
  }
  read.push({ code, name: meta.name, rows: rows.length, err: '' });

  for (const r of rows) {
    const want = canonSheetVehicleStatus(r.st);
    const recs = byPlate.get(r.plate);
    if (!recs?.length) {
      // 시트엔 있는데 ERP 에 없다 — 상태 문제가 아니라 유입 문제다.
      if (want !== '출고불가') absent.push([r.plate, code, meta.name, r.st]);
      continue;
    }
    for (const rec of recs) {
      const from = S((rec as any).vehicle_status);
      const blocked = isHiddenFromCatalog(rec as any);
      // 시트가 닫으라 하면 닫고, 열라 하면 연다. 이미 그 상태면 건드리지 않는다.
      if (want === '출고불가' ? blocked : !blocked) continue;
      const f: Fix = {
        plate: r.plate, code, name: meta.name, sheetSt: r.st, want,
        key: S((rec as any)._key), from, prices: priceList(rec).length,
      };
      if (want === '출고불가') close.push(f);
      else (f.prices > 0 ? fixes : noPrice).push(f);
    }
  }
}

console.log(`■ 시트 기준으로 상태를 되돌린다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  고치면 목록에 서는 차   ${fixes.length}건`);
console.log(`  고쳐도 안 서는 차       ${noPrice.length}건  (대여료가 없다 — 공급사에 가격을 받아야 한다)`);
console.log(`  시트가 닫으라는 차       ${close.length}건  (계약중·보류·출고완료 — ERP 도 닫는다)`);
console.log(`  ERP 에 아예 없는 차     ${absent.length}대  (상태 문제가 아니라 유입 문제 — 여기선 못 고친다)\n`);
for (const f of close.slice(0, 14)) {
  console.log(`   닫음 ${f.plate.padEnd(11)} ${f.name.slice(0, 10).padEnd(12)} 「${f.from}」→「출고불가」  시트「${f.sheetSt}」`);
}
if (close.length > 14) console.log(`   … 외 ${close.length - 14}건`);
if (close.length) console.log('');

console.log(`  ── 시트를 읽은 결과 ──`);
for (const r of read) {
  console.log(`   ${r.name.slice(0, 15).padEnd(16)}${r.code.padEnd(10)}${r.rows < 0 ? `✗ 못 읽음 ${r.err}` : `${String(r.rows).padStart(5)}줄${r.rows === 0 ? '  ← 헤더가 달라 상태·차번 열을 못 찾았다' : ''}`}`);
}
console.log('');

const byProv = new Map<string, number>();
for (const f of fixes) byProv.set(f.name, (byProv.get(f.name) || 0) + 1);
for (const [n, c] of [...byProv.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(c).padStart(4)}건  ${n}`);
console.log('');
for (const f of fixes.slice(0, 12)) {
  console.log(`   ${f.plate.padEnd(11)} ${f.key.slice(0, 20).padEnd(22)} 「${f.from}」→「${f.want}」  시트「${f.sheetSt}」 · 대여료 ${f.prices}건`);
}
if (fixes.length > 12) console.log(`   … 외 ${fixes.length - 12}건`);

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/status-gap-fix.csv', `﻿${[
  ['차량번호', '공급사', 'RTDB키', '고치기전', '고친후', '시트원문', '대여료건수', '결과'].join(','),
  ...fixes.map((f) => [f.plate, f.name, f.key, f.from, f.want, f.sheetSt, String(f.prices), '목록에 섬'].map(esc).join(',')),
  ...noPrice.map((f) => [f.plate, f.name, f.key, f.from, f.want, f.sheetSt, '0', '대여료 없음 — 여전히 안 섬'].map(esc).join(',')),
  ...close.map((f) => [f.plate, f.name, f.key, f.from, f.want, f.sheetSt, String(f.prices), '시트가 닫음 — 목록에서 빠짐'].map(esc).join(',')),
  ...absent.map((a) => [a[0], a[2], '', '', '', a[3], '', 'ERP 에 없음 — 유입 필요'].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/status-gap-fix.csv`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

let done = 0; let failed = 0;
for (const f of [...fixes, ...noPrice, ...close]) {
  // ★`vehicle_status` 하나만 쓴다. PATCH 라 나머지 필드는 그대로 남는다.
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(f.key)}.json?access_token=${dbT}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_status: f.want, updatedAt: new Date().toISOString() }),
  });
  if (res.ok) done++;
  else { failed++; console.log(`  △ ${f.plate} ${f.key} — ${res.status} ${(await res.text()).slice(0, 120)}`); }
}
console.log(`\n  반영 ${done}건 · 실패 ${failed}건`);
console.log('  다음: npx tsx scripts/publish-sales-sheet.mts --apply 로 영업자 시트를 다시 찍는다.\n');
