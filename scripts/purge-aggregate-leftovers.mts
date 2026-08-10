/**
 * **옛 종합시트에서 들어온 잔재를 내린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-10)
 *   RTDB 의 아이카(RP004) 가 우리 **옛 종합시트**(「프리패스 공급사 상품리스트」 · 탭 24개)를
 *   가리키고 있던 동안, 그 표에 있던 남의 공급사 차들이 통째로 유입됐다.
 *   공급사 정본 시트로 바로잡은 지금, 그 차들은 **어느 공급사 시트에도 없다**.
 *   공급사가 이미 뺀 차인데 ERP 에만 「출고가능」으로 남아 재고 숫자를 흐린다.
 *
 * ★판정 — 「지금 정본 시트 어디에도 차번이 없는 차」.
 *   시트를 못 읽은 공급사가 하나라도 있으면 **아무것도 내리지 않는다**.
 *   못 읽은 시트의 차가 「없는 차」로 잡혀 멀쩡한 재고가 날아간다.
 *
 * ⚠ 홈페이지 연동(아이언 RP006)은 시트가 정본이 아니므로 건드리지 않는다.
 * ⚠ 지우지 않고 `_deleted` 로 내린다. 되돌릴 수 있어야 하고, 무엇을 왜 내렸는지 남아야 한다.
 *   되돌리려면 `--restore=<백업파일>`.
 *
 *   npx tsx scripts/purge-aggregate-leftovers.mts
 *   npx tsx scripts/purge-aggregate-leftovers.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const RESTORE = arg('restore');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 시트가 정본이 아닌 공급사 — 시트에 없다고 내리면 안 된다. */
const NOT_SHEET_BACKED = new Set(['RP006']);   // 아이언 = ironrentcar.com 수집

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
const put = async (path: string, body: unknown, method: 'PATCH' | 'PUT' = 'PATCH') => {
  const res = await fetch(`${DB}/${path}.json?access_token=${dbT}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
};

// ── 되돌리기 ──────────────────────────────────────────────────────────
if (RESTORE) {
  const snap = JSON.parse(readFileSync(RESTORE, 'utf8')) as Record<string, Rec>;
  console.log(`■ 되돌리기 — ${RESTORE} · ${Object.keys(snap).length}건`);
  if (!APPLY) { console.log('※ dry-run. 실제 되돌리기는 --apply 와 함께\n'); process.exit(0); }
  for (const [k, v] of Object.entries(snap)) await put(`v4/products/${encodeURIComponent(k)}`, v, 'PUT');
  console.log(`  되돌림 ${Object.keys(snap).length}건\n`);
  process.exit(0);
}

const GRID_FIELDS = 'sheets(properties(sheetId,title,hidden),data(rowMetadata(hiddenByFilter,hiddenByUser),rowData(values(formattedValue))))';
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
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };

/** 정본 시트에 실제로 적혀 있는 차번 — 여기 없으면 «지금 그 공급사가 안 갖고 있는 차»다. */
const onSheets = new Set<string>();
const failed: string[][] = [];
const seen = new Set<string>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  if (NOT_SHEET_BACKED.has(code)) continue;
  const id = S(p.sheet_url).match(/\/d\/([\w-]+)/)?.[1];
  if (!id || seen.has(id)) continue;
  seen.add(id);
  const name = S(p.partner_name || p.name || p.company_name) || code;
  try {
    const grid = await grabGrid(id);
    const pinned = new Set(S(p.sheet_tab).split(',').map(S).filter(Boolean));
    let tabs = 0;
    for (const sh of (grid.sheets || []) as Rec[]) {
      const gid = String(sh.properties?.sheetId ?? '');
      if (pinned.size ? !pinned.has(gid) : sh.properties?.hidden === true) continue;
      let rows: string[][];
      try { rows = (visibleRowsFromGridResponse(grid, gid) as Rec).rows as string[][]; } catch { continue; }
      tabs++;
      // 차번은 어느 열에 있든 잡는다 — 여기서는 «있나 없나»만 보면 된다.
      for (const r of rows) for (const c of r) { const v = norm(c); if (/^\d{2,3}[가-힣]\d{4}$/.test(v)) onSheets.add(v); }
    }
    if (!tabs) failed.push([code, name, '읽을 탭이 없음']);
  } catch (e) { failed.push([code, name, String((e as Error).message).slice(0, 50)]); }
}

console.log(`■ 옛 종합시트 잔재 정리 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  정본 시트에서 읽은 차번 ${onSheets.size}개\n`);
if (failed.length) {
  console.log(`  ✗ 못 읽은 시트 ${failed.length}곳 — **아무것도 내리지 않는다**`);
  for (const f of failed) console.log(`     ${f[1].slice(0, 16).padEnd(18)}${f[0].padEnd(10)}${f[2]}`);
  console.log(`\n  못 읽은 시트의 차가 「없는 차」로 잡히면 멀쩡한 재고가 날아간다. 먼저 그 시트를 고쳐라.\n`);
  process.exit(1);
}

type Gone = { key: string; plate: string; code: string; status: string; prices: number; listed: boolean };
const gone: Gone[] = [];
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const code = S(p.provider_company_code) || S(p.partner_code);
  if (NOT_SHEET_BACKED.has(code)) continue;
  const pl = norm(p.car_number);
  // 차번이 없는 차는 시트와 대조할 방법이 없다 — 여기서 판단하지 않는다.
  if (!pl || onSheets.has(pl)) continue;
  const rec = { ...p, _key: k, product_code: p.product_code || k } as EntityRecord;
  gone.push({
    key: k, plate: pl, code, status: S(p.vehicle_status),
    prices: priceList(rec).length,
    listed: !isHiddenFromCatalog(rec as Rec) && priceList(rec).length > 0,
  });
}

const byProv = new Map<string, Gone[]>();
for (const g of gone) byProv.set(g.code || '(코드없음)', [...(byProv.get(g.code || '(코드없음)') || []), g]);
console.log(`  정본 시트에 없는 차 ${gone.length}대 · 그중 지금 목록에 서 있는 차 ${gone.filter((g) => g.listed).length}대\n`);
for (const [code, gs] of [...byProv].sort((a, b) => b[1].length - a[1].length)) {
  const nm = S(Object.values(partners).find((p) => S(p.partner_code) === code)?.partner_name) || code;
  console.log(`  ${nm.slice(0, 14).padEnd(16)}${code.padEnd(10)}${String(gs.length).padStart(4)}대 (목록에 선 것 ${gs.filter((g) => g.listed).length})`);
  for (const g of gs.slice(0, 6)) console.log(`     ${g.plate.padEnd(11)} 「${g.status}」 대여료 ${g.prices}건${g.listed ? ' · 목록에 섬' : ''}`);
  if (gs.length > 6) console.log(`     … 외 ${gs.length - 6}대`);
}

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/aggregate-leftovers.csv', `﻿${[
  ['차량번호', '공급사코드', 'RTDB키', 'ERP 상태', '대여료건수', '목록에 섬'].join(','),
  ...gone.map((g) => [g.plate, g.code, g.key, g.status, String(g.prices), g.listed ? 'O' : ''].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/aggregate-leftovers.csv (${gone.length}행)`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/leftover-backup-${stamp}.json`;
const snap: Record<string, Rec> = {};
for (const g of gone) snap[g.key] = (prods as Rec)[g.key];
writeFileSync(backup, JSON.stringify(snap, null, 1), 'utf8');
console.log(`\n  되돌리기용 백업: ${backup} (${gone.length}건)`);

const at = new Date().toISOString();
let done = 0;
for (const g of gone) {
  await put(`v4/products/${encodeURIComponent(g.key)}`, {
    _deleted: true, deletedAt: at, updatedAt: at,
    deleted_reason: '공급사 정본 시트에 없는 차 — 옛 종합시트 잔재 정리(2026-08-10)',
  });
  done++;
}
console.log(`  내림 ${done}대`);
console.log(`  되돌리려면: npx tsx scripts/purge-aggregate-leftovers.mts --restore=${backup} --apply`);
console.log('  다음: 영업자 시트 두 탭을 다시 찍는다.\n');
