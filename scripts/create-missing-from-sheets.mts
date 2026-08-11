/**
 * **공급사 시트에 있는데 ERP 에 없는 차를 만들어 넣는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★공급사 시트가 정본이다(사장님 2026-08-10 — 「공급사 시트대로 맞추는 거야」).
 *   시트에 있으면 재고다. 차종이 덜 적혀 있어도 그건 나중에 채울 일이지,
 *   «안 올릴 이유»가 아니다.
 *
 * ★유입 코드(`importSheetTable`)가 만든 레코드를 그대로 쓴다 — 여기서 필드를 지어내지 않는다.
 *   읽는 길도 운영과 같다: 숨긴 행·숨긴 탭 제외 · 공급사 어댑터로 헤더 찾기 · gid 여러 개 지원.
 *
 * ⚠ **만들기만 한다.** 이미 있는 차는 건드리지 않는다 —
 *   상태·가격 교정은 `fix-sheet-status-gap` · `fill-missing-prices` 가 따로 한다.
 * ⚠ 시트를 못 읽은 공급사가 있으면 그 공급사만 건너뛴다(전체를 멈추지는 않는다).
 *   무엇을 못 읽었는지 반드시 찍는다 — 조용히 넘어가면 「다 됐다」로 보인다.
 * ⚠ 홈페이지 연동(아이언)은 시트가 정본이 아니라 제외한다.
 *
 *   npx tsx scripts/create-missing-from-sheets.mts
 *   npx tsx scripts/create-missing-from-sheets.mts --apply
 *   npx tsx scripts/create-missing-from-sheets.mts --apply --only=RP031
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { autoMapHeaders, importSheetTable } from '../lib/domain/sheet-import';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONLY = arg('only').split(',').map(S).filter(Boolean);
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

const grabGrid = async (id: string, tries = 4): Promise<SheetsGridResponse> => {
  // 필드 마스크도 규격 것을 쓴다 — 사본을 두면 `hidden` 같은 게 빠져도 아무도 모른다.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`;
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

/**
 * ★**살아있는 차번**만 「이미 있다」로 본다.
 *   내려둔(`_deleted`) 레코드가 있어도 시트에 다시 있으면 그건 «되살아난 차»다 —
 *   새 키로 만들어 올린다. 그러지 않으면 공급사가 다시 올려도 영영 안 보인다.
 *
 * ★단 **사람이 「안 판다」고 판단해 내린 차는 되살리지 않는다**(2026-08-11).
 *   내림에는 두 종류가 있고, 둘을 섞으면 안 된다 — `deleted_source` 로 가른다.
 *     `sheet-absence` : 시트에서 사라져서 내렸다 → 다시 올라오면 **되살린다**.
 *     `judgement`     : 사람이 보고 판단해 내렸다 → 시트에 남아 있어도 **안 만든다**.
 *   오플 프로모션 탭 하단 EV6 13대가 후자다(사장님 확인: 「그냥 맨 밑에 둔 건데 판매 아닌 것 같다」).
 *   그 차들은 시트에 계속 적혀 있으므로, 막지 않으면 아침 동기화마다 되살아난다.
 *   다시 팔기로 하면 그 레코드의 `deleted_source` 를 지운다.
 */
const livePlates = new Set<string>();
const closedByHand = new Map<string, string>();
for (const p of Object.values<Rec>(prods)) {
  if (!p || typeof p !== 'object') continue;
  const pl = norm(p.car_number);
  if (!pl) continue;
  if (!dead(p)) { livePlates.add(pl); continue; }
  if (S(p.deleted_source) === 'judgement') closedByHand.set(pl, S(p.deleted_reason) || '사람이 내림');
}
const usedKeys = new Set(Object.keys(prods as Rec));

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

type New = { key: string; plate: string; code: string; name: string; tab: string; rec: Rec };
const creates: New[] = [];
/** 시트엔 있지만 사람이 내려서 안 만든 차 — 조용히 넘기면 왜 안 보이는지 아무도 모른다. */
const held: string[][] = [];
const failed: string[][] = [];
const seen = new Set<string>();

for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  if (NOT_SHEET_BACKED.has(code)) continue;
  if (ONLY.length && !ONLY.includes(code)) continue;
  const id = S(p.sheet_url).match(/\/d\/([\w-]+)/)?.[1];
  if (!id || seen.has(id)) continue;
  seen.add(id);
  const name = S(p.partner_name || p.name || p.company_name) || code;
  try {
    const grid = await grabGrid(id);
    // ★시트는 반드시 규격(`readSupplierSheet`)을 통해 읽는다.
    //   2026-08-11: 이 스크립트만 직접 읽는 바람에 오토플러스의
    //   `firstPlateBlockAfterHeader` 컷이 안 걸려, 헤더 아래 과거 이력의
    //   EV6 프로모션 13대를 «새 차»로 만들려 했다(시트에 실제 서 있는 건 2대).
    const { tabs, failures } = readSupplierSheet(grid as never, p as EntityRecord);
    for (const f of failures) failed.push([code, name, `${f.title} — ${f.reason.slice(0, 40)}`]);
    for (const t of tabs) {
      const tab = t.title;
      const table = t.table;
      if (table.length < 2) continue;
      let imported: EntityRecord[] = [];
      try {
        const prof = autoMapHeaders(table[0] || []);
        if (prof.car_number === undefined) continue;
        const out = importSheetTable(table, {
          profile: prof, providerCode: code, providerName: name, entries, depositRule: p.deposit_rule,
          photoByPlate: t.photoByPlate,
        } as Parameters<typeof importSheetTable>[1]);
        imported = (out as Rec).products || [];
      } catch (e) { failed.push([code, name, `${tab} — ${String((e as Error).message).slice(0, 40)}`]); continue; }

      for (const src of imported) {
        const rec = src as Rec;
        const pl = norm(rec.car_number);
        // 차번이 없는 행은 만들지 않는다 — 나중에 같은 차인지 가릴 방법이 없다.
        if (!pl || livePlates.has(pl)) continue;
        // ★사람이 이유를 적어 내린 차는 시트에 남아 있어도 되살리지 않는다.
        if (closedByHand.has(pl)) { held.push([pl, `${name} / ${tab}`, closedByHand.get(pl)!]); continue; }
        // 유입이 이미 출고불가로 판정한 차는 만들 이유가 없다.
        if (S(rec.vehicle_status) === '출고불가') continue;
        let key = S(rec._key) || S(rec.product_code) || `${code}_${pl}`;
        // 옛 키가 내려간 채 남아 있으면 덮지 않고 새 키를 쓴다.
        if (usedKeys.has(key)) key = `${key}__${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        livePlates.add(pl);
        creates.push({ key, plate: pl, code, name, tab, rec });
      }
    }
  } catch (e) { failed.push([code, name, String((e as Error).message).slice(0, 50)]); }
}

console.log(`■ 시트에 있는데 ERP 에 없는 차를 만든다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  만들 차 ${creates.length}대\n`);
const byProv = new Map<string, New[]>();
for (const c of creates) byProv.set(`${c.name} / ${c.tab}`, [...(byProv.get(`${c.name} / ${c.tab}`) || []), c]);
for (const [k, cs] of [...byProv].sort((a, b) => b[1].length - a[1].length)) {
  const withPrice = cs.filter((c) => priceList(c.rec as EntityRecord).length > 0).length;
  const noModel = cs.filter((c) => !S(c.rec.model) && !S(c.rec.sub_model)).length;
  console.log(`  ${k} — ${cs.length}대 (대여료 있는 차 ${withPrice} · 차종 없는 차 ${noModel})`);
  for (const c of cs.slice(0, 5)) {
    console.log(`     ${c.plate.padEnd(11)} 「${S(c.rec.vehicle_status)}」 ${S(c.rec.maker)} ${S(c.rec.sub_model) || S(c.rec.model) || '(차종없음)'} · 대여료 ${priceList(c.rec as EntityRecord).length}건`);
  }
  if (cs.length > 5) console.log(`     … 외 ${cs.length - 5}대`);
}
const listable = creates.filter((c) => !isHiddenFromCatalog(c.rec) && priceList(c.rec as EntityRecord).length > 0).length;
console.log(`\n  그중 바로 목록에 설 차 ${listable}대`);
if (held.length) {
  console.log(`\n  ■ 시트엔 있지만 «사람이 내린 차»라 안 만든 것 ${held.length}대`);
  for (const h of held) console.log(`     ${h[0].padEnd(11)}${h[1].slice(0, 30).padEnd(32)}${h[2].slice(0, 40)}`);
  console.log('     다시 팔려면 그 레코드의 deleted_source 를 지운다.');
}
if (failed.length) {
  console.log(`\n  ✗ 못 읽은 시트·탭 ${failed.length}건 — 이만큼은 «모름»이다`);
  for (const f of failed) console.log(`     ${f[1].slice(0, 16).padEnd(18)}${f[0].padEnd(10)}${f[2]}`);
}

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/create-from-sheets.csv', `﻿${[
  ['차량번호', '공급사', '탭', 'RTDB키', '상태', '차종', '대여료건수'].join(','),
  ...creates.map((c) => [c.plate, c.name, c.tab, c.key, S(c.rec.vehicle_status),
    `${S(c.rec.maker)} ${S(c.rec.sub_model) || S(c.rec.model)}`.trim(), String(priceList(c.rec as EntityRecord).length)].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/create-from-sheets.csv (${creates.length}행)`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
let done = 0; let bad = 0;
for (const c of creates) {
  const body = { ...c.rec, _key: undefined, product_code: c.key, createdAt: at, updatedAt: at };
  delete (body as Rec)._key;
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(c.key)}.json?access_token=${dbT}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (res.ok) done++;
  else { bad++; console.log(`  △ ${c.plate} — ${res.status} ${(await res.text()).slice(0, 120)}`); }
}
console.log(`\n  만듦 ${done}대 · 실패 ${bad}대`);
console.log('  다음: 영업자 시트 두 탭을 다시 찍는다.\n');
