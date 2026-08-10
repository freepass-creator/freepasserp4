/**
 * **대여료가 빈 차의 가격을 공급사 시트에서 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 비어 있나(2026-08-10)
 *   아이카 시트는 «종합시트»다 — 탭이 에스에이·손오공·웰릭스·우리캐피탈·빌린카 …로 갈려 있다.
 *   그런데 동기화는 파트너에 적힌 **탭 하나만** 읽는다. 다른 탭에 있는 차는 상태만 들어오고
 *   가격이 안 들어와, 「출고가능인데 대여료가 없어서 목록에 못 서는」 차가 된다(20대 실측).
 *
 * ★모든 탭을 훑어 **차번으로** 찾는다. 가격은 유입 코드(`importSheetTable`)가 읽은 것을 그대로 쓴다 —
 *   여기서 파서를 새로 쓰지 않는다. 두 벌이 되면 어느 값이 맞는지 아무도 모른다.
 *
 * ⚠ **빈 것만 채운다.** 이미 가격이 있는 차는 건드리지 않는다 — 어느 탭이 최신인지 우리는 모른다.
 * ⚠ 같은 차번이 여러 탭에 있으면 **기간이 가장 많은 쪽**을 쓴다. 덜 적힌 표로 덮으면 기간이 사라진다.
 *
 *   npx tsx scripts/fill-missing-prices.mts
 *   npx tsx scripts/fill-missing-prices.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { autoMapHeaders, importSheetTable } from '../lib/domain/sheet-import';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
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

/** 대여료가 비어 «목록에 못 서는» 차 — 상태는 팔 수 있다고 돼 있는데 가격이 없다. */
const need = new Map<string, EntityRecord[]>();
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const rec = { ...p, _key: k, product_code: p.product_code || k } as EntityRecord;
  if (isHiddenFromCatalog(rec as Rec)) continue;
  if (priceList(rec).length) continue;
  const pl = norm(p.car_number);
  if (!pl) continue;
  need.set(pl, [...(need.get(pl) || []), rec]);
}
console.log(`■ 대여료가 빈 차 ${need.size}대 — 공급사 시트에서 찾는다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

/** 차번 → 찾은 가격(기간이 가장 많은 것) + 어디서 왔는지. */
const found = new Map<string, { price: Rec; from: string; months: number }>();
const seenSheet = new Set<string>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const id = S(p.sheet_url).match(/\/d\/([\w-]+)/)?.[1];
  if (!id || seenSheet.has(id)) continue;
  seenSheet.add(id);
  const code = S(p.partner_code) || S(p._key);
  const name = S(p.partner_name || p.name || p.company_name) || code;
  try {
    /**
     * ★운영 유입과 **같은 길로 읽는다**(2026-08-10에 고침).
     *   숨긴 행·숨긴 탭을 빼고 공급사 어댑터로 헤더를 찾는다. `sheet_tab` 은 gid 여러 개일 수 있다.
     */
    const grid = await grabGrid(id);
    const adapter = resolveAdapter(p as EntityRecord);
    const pinned = new Set(S(p.sheet_tab).split(',').map(S).filter(Boolean));
    for (const sh of (grid.sheets || []) as Rec[]) {
      const gid = String(sh.properties?.sheetId ?? '');
      if (pinned.size ? !pinned.has(gid) : sh.properties?.hidden === true) continue;
      const tab = S(sh.properties?.title);
      let table: string[][];
      try { table = (visibleRowsFromGridResponse(grid, gid) as Rec).rows as string[][]; } catch { continue; }
      if (table.length < 2) continue;
      let imported: EntityRecord[] = [];
      try {
        const prepared = adapter.prepareTable(table, { headerRow: Number(p.sheet_header_row) || undefined });
        const prof = autoMapHeaders(prepared[0] || []);
        if (prof.car_number === undefined) continue;
        const out = importSheetTable(prepared, {
          profile: prof, providerCode: code, providerName: name, entries,
          depositRule: p.deposit_rule,
        } as Parameters<typeof importSheetTable>[1]);
        imported = (out as Rec).products || [];
      } catch { continue; }
      for (const src of imported) {
        const pl = norm((src as Rec).car_number);
        if (!pl || !need.has(pl)) continue;
        const price = ((src as Rec).price || {}) as Rec;
        const months = Object.values(price).filter((e: Rec) => Number(e?.rent) > 0).length;
        if (!months) continue;
        const prev = found.get(pl);
        // 기간이 더 많은 표가 이긴다 — 덜 적힌 쪽으로 덮으면 기간이 사라진다.
        if (!prev || months > prev.months) found.set(pl, { price, from: `${name} / ${tab}`, months });
      }
    }
  } catch (e) { console.log(`  △ ${name} 시트 못 읽음 — ${String((e as Error).message).slice(0, 60)}`); }
}

const rows: string[][] = [];
console.log(`  찾음 ${found.size}대 / 못 찾음 ${need.size - found.size}대\n`);
for (const [pl, f] of found) {
  const list = Object.entries(f.price).filter(([, e]) => Number((e as Rec)?.rent) > 0)
    .map(([m, e]) => `${m}개월 ${Number((e as Rec).rent).toLocaleString('ko-KR')}`);
  console.log(`   ${pl.padEnd(11)} ${f.from.slice(0, 26).padEnd(28)} ${list.slice(0, 4).join(' · ')}`);
  for (const rec of need.get(pl) || []) rows.push([pl, S((rec as Rec)._key), f.from, list.join(' / ')]);
}
const missing = [...need.keys()].filter((pl) => !found.has(pl));
if (missing.length) {
  console.log(`\n  시트에서도 못 찾은 차 ${missing.length}대 — 공급사에 가격을 받아야 한다`);
  for (const pl of missing.slice(0, 20)) {
    const r = (need.get(pl) || [])[0] as Rec;
    console.log(`   ${pl.padEnd(11)} ${S(r.provider_company_code).padEnd(9)} ${S(r.maker)} ${S(r.sub_model) || S(r.model)}`);
  }
}

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/price-fill.csv', `﻿${[
  ['차량번호', 'RTDB키', '찾은 곳', '대여료'].join(','),
  ...rows.map((r) => r.map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/price-fill.csv (${rows.length}행)`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

let done = 0; let failed = 0;
for (const [pl, f] of found) {
  for (const rec of need.get(pl) || []) {
    const key = S((rec as Rec)._key);
    // price 만 쓴다 — 상태·차종은 여기서 고칠 근거가 없다.
    const res = await fetch(`${DB}/v4/products/${encodeURIComponent(key)}/price.json?access_token=${dbT}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.price),
    });
    if (res.ok) {
      await fetch(`${DB}/v4/products/${encodeURIComponent(key)}.json?access_token=${dbT}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: new Date().toISOString() }),
      });
      done++;
    } else { failed++; console.log(`  △ ${pl} ${key} — ${res.status} ${(await res.text()).slice(0, 120)}`); }
  }
}
console.log(`\n  반영 ${done}건 · 실패 ${failed}건`);
console.log('  다음: 영업자 시트 두 탭을 다시 찍는다.\n');
