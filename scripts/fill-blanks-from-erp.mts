/**
 * **우리 시트의 빈 칸을 ERP 값으로 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-12 — 「전체 시트 기존거에서 못불러온거 빠진거 다 확인해서 채워넣으세요」)
 *   시트를 다시 찍거나 열을 갈아끼우는 동안 값이 빠진 자리가 생긴다.
 *   실측: 손오공을 렌트/구독 탭으로 다시 찍으면서 **제조사·사진링크가 통째로 비었다** —
 *   공급사 원본 시트에 그 열이 없어서다. ERP 는 그 값을 이미 갖고 있었다(사진 25/31).
 *
 * ★출처는 **둘**이다 — ERP 를 먼저 보고, 없으면 **공급사 원본 시트**를 본다.
 *   ERP 는 «팔 수 있는 값»만 접어 두므로 원본에만 있는 것이 있다.
 *   특히 **사진은 열이 아니라 「차량번호」 셀에 걸린 링크**로 오는 곳이 많다
 *   (아이카는 상세페이지, 오플·리더스는 드라이브 폴더). 열만 보면 영영 못 찾는다.
 *
 * ★**빈 칸만** 쓴다. 값이 있으면 절대 안 덮는다 — 공급사가 고친 값이 날아가면 되돌릴 수 없다.
 * ★차량번호로 맞춘다. 시트 이름으로 공급사를 짐작하지 않는다 —
 *   「경진」이 「경진카」에 걸려 남의 차 3대가 들어간 적이 있다(2026-08-11).
 * ★요금 열은 **이름이 정확히 맞을 때만** 채운다. 구독 탭의 「12개월 인수형」·「12개월 반납형」은
 *   ERP 가 한 벌로 접어 두므로 어느 쪽인지 알 수 없다 — 모르는 건 안 쓴다.
 *
 *   npx tsx scripts/fill-blanks-from-erp.mts
 *   npx tsx scripts/fill-blanks-from-erp.mts --apply
 *   npx tsx scripts/fill-blanks-from-erp.mts --apply --only=손오공
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, priceList } from '../lib/domain/product';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { photoUrlFromCell } from '../lib/domain/sheet-visible-grid';
import { isVehicleTab, periodColumnName, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

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
const A = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
const numOf = (v: unknown) => { const n = Number(S(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) && n > 0 ? n : ''; };

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };

/**
 * 공급사 **원본 시트**에서 차번별로 값을 긁어 둔다. 열 이름은 원본 그대로 쓰고,
 * 사진은 「차량번호」 셀의 링크에서 뽑는다.
 * ⚠ 우리 시트가 정본인 공급사는 원본이 곧 우리 시트다 — 그때는 아무것도 안 나온다(문제 없다).
 */
const ORIGIN = new Map<string, Map<string, string>>();
const seenSheet = new Set<string>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p) || NOT_SHEET_BACKED.has(S(p.partner_code))) continue;
  const id = (S(p.sheet_url).match(/\/d\/([\w-]+)/) || [])[1];
  if (!id || seenSheet.has(id)) continue;
  seenSheet.add(id);
  let grid: Rec;
  try { grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`); }
  catch { continue; }
  const read = readSupplierSheet(grid as never, p as EntityRecord);
  for (const t of read.tabs) {
    const hdr = (t.table[0] || []).map(S);
    const pi = hdr.findIndex((h) => /차량번호|차번/.test(h));
    if (pi < 0) continue;
    for (const r of t.table.slice(1)) {
      const pl = norm(r[pi]);
      if (!pl) continue;
      const m = ORIGIN.get(pl) || new Map<string, string>();
      hdr.forEach((h, i) => { const v = S(r[i]); if (h && v && !m.has(h)) m.set(h, v); });
      ORIGIN.set(pl, m);
    }
  }
  // 사진은 「차량번호」 셀의 링크·스마트칩에 있다. 표가 아니라 격자에서 따로 뽑는다.
  for (const sh of ((grid.sheets || []) as Rec[])) {
    for (const row of ((sh.data?.[0]?.rowData || []) as Rec[])) {
      const cells = (row?.values || []) as Rec[];
      for (const c of cells) {
        const pl = norm(c?.formattedValue);
        if (!/^\d{2,3}[가-힣]\d{4}$/.test(pl)) continue;
        const url = photoUrlFromCell(c as never);
        if (!url) continue;
        const m = ORIGIN.get(pl) || new Map<string, string>();
        if (!m.has('사진링크')) m.set('사진링크', url);
        ORIGIN.set(pl, m);
      }
    }
  }
}
const byPlate = new Map<string, Rec>();
for (const p of Object.values<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const pl = norm(p.car_number);
  if (pl) byPlate.set(pl, p);
}

/** 차명(세부모델+트림) — 한 칸에 이어 쓴다. `prefill-supplier-sheets` 와 같은 규칙이어야 한다. */
const carName = (p: Rec): string => {
  const parts = [S(p.sub_model) || S(p.model), S(p.variant), S(p.trim_name)].filter(Boolean);
  const out: string[] = [];
  for (const part of parts) if (!out.some((x) => x.includes(part))) out.push(part);
  return out.join(' ').trim();
};
const yearOf = (p: Rec): number | '' => {
  if (numOf(p.year)) return Number(p.year);
  const m = S(p.first_registration_date).match(/^(\d{4})/) || S(p.first_registration_date).match(/^(\d{2})[-./]/);
  if (!m) return '';
  const n = Number(m[1]);
  return n >= 1000 ? n : 2000 + n;
};

/** 열 이름 → 그 차의 ERP 값. 모르는 열은 여기 없다 — 없으면 안 쓴다. */
const valueFor = (name: string, p: Rec): string | number => {
  switch (name) {
    case '상태': return S(p.vehicle_status);
    case '분류': return S(canonProductType(p.product_type)) || S(p.product_type);
    case '제조사': return S(p.maker);
    case '차명(세부모델+트림)': return carName(p);
    case '옵션': return S(p.options);
    case '외부색상': return S(p.ext_color);
    case '내부색상': return S(p.int_color);
    case '연식': return yearOf(p);
    case '연료': return S(p.fuel_type);
    case '주행거리': return numOf(p.mileage);
    case '배기량': return numOf(p.engine_cc);
    case '차량가격': return numOf(p.vehicle_price);
    case '정책코드': return S(p.policy_code);
    case '최초등록일': return S(p.first_registration_date);
    case '사진링크': return S(p.photo_link);
    case '입고일자': return S(p.arrival_date);
    default: break;
  }
  // 기간 요금 — 열 이름이 ERP 키와 **정확히** 같을 때만.
  const list = priceList(p as EntityRecord);
  for (const e of list) if (periodColumnName(String(e.m)) === name) return e.rent;
  if (name === '단기보증') { const e = list.find((x) => x.m <= 12 && x.deposit); return e ? e.deposit : ''; }
  if (name === '장기보증') { const e = list.find((x) => x.m >= 24 && x.deposit); return e ? e.deposit : ''; }
  return '';
};

const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const files = ((await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`)).files || []) as Rec[];
console.log(`■ 우리 시트 빈 칸을 ERP 값으로 채운다 ${APPLY ? '(반영)' : '(dry-run)'} — 값이 있는 칸은 안 덮는다\n`);

let cells = 0; const stillBlank = new Map<string, number>(); const noErp: string[] = [];
for (const f of files) {
  const label = supplierSheetLabel(f.name);
  if (ONLY && !label.includes(ONLY)) continue;
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}?fields=sheets.properties.title`);
  const tabs = ((meta.sheets || []) as Rec[]).map((sh) => S(sh.properties?.title)).filter(isVehicleTab);
  for (const tab of tabs) {
    const vals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`${tab}!A1:BZ600`)}`);
    const rows = ((vals.values || []) as string[][]);
    const hdr = (rows[0] || []).map(S);
    const iPlate = hdr.indexOf('차량번호');
    if (iPlate < 0) continue;
    const writes: { range: string; values: (string | number)[][] }[] = [];
    const filled = new Map<string, number>();
    let matched = 0;
    for (let r = 1; r < rows.length; r++) {
      const plate = norm(rows[r][iPlate]);
      if (!plate) continue;
      const p = byPlate.get(plate) || {};
      if (!byPlate.has(plate)) {
        // ERP 에 없어도 원본 시트에 값이 있으면 채운다 — «없는 차»가 아니라 «아직 안 올린 차»다.
        if (!ORIGIN.has(plate)) { noErp.push(`${label}/${tab} ${plate}`); continue; }
      }
      matched++;
      hdr.forEach((name, c) => {
        if (S(rows[r][c])) return;                 // ★값이 있으면 손대지 않는다
        // ERP 를 먼저 보고, 없으면 공급사 원본 시트의 같은 이름 칸을 본다.
        const v = valueFor(name, p) || S(ORIGIN.get(plate)?.get(name));
        if (v === '' || v == null) { stillBlank.set(name, (stillBlank.get(name) || 0) + 1); return; }
        writes.push({ range: `${tab}!${A(c)}${r + 1}`, values: [[v]] });
        filled.set(name, (filled.get(name) || 0) + 1);
      });
    }
    if (!writes.length) { console.log(`  ${`${label}/${tab}`.padEnd(20)}채울 것 없음 (ERP 대조 ${matched}대)`); continue; }
    cells += writes.length;
    const what = [...filled].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
    console.log(`  ${`${label}/${tab}`.padEnd(20)}${String(writes.length).padStart(4)}칸 — ${what}`);
    if (!APPLY) continue;
    // 칸이 붙어 있지 않으므로 칸마다 따로 쓴다. 한 번에 보내되 200개씩 끊는다.
    for (let i = 0; i < writes.length; i += 200) {
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values:batchUpdate`, {
        method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes.slice(i, i + 200) }),
      });
    }
  }
}
console.log(`\n  채울 칸 ${cells}개`);
if (stillBlank.size) {
  console.log('\n  ERP 에도 없어 못 채우는 칸 — 공급사가 적어야 한다');
  for (const [k, v] of [...stillBlank].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`     ${k.padEnd(12)}${v}칸`);
}
if (noErp.length) {
  console.log(`\n  △ ERP 에 없는 차 ${noErp.length}대 — ${noErp.slice(0, 6).join(' · ')}`);
}
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
