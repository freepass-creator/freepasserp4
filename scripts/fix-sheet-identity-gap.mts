/**
 * **차종·트림을 공급사 시트에서 다시 잡는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 필요한가(2026-08-10)
 *   시트 키(`공급사코드_차번`) 레코드가 죽고 `EXT_` 레코드가 살아남은 차가 있다.
 *   그 EXT_ 는 옛 유입이라 차종이 덜 잡혀 있다 — 손오공 161하1687 은 시트에 「아반떼 N」인데
 *   ERP 는 그냥 「아반떼」였다. 아반떼 N 은 아반떼가 아니다. 그대로 나가면 손님에게 다른 차를 판다.
 *
 * ★고치는 방법 — **유입 코드를 그대로 다시 돌린다**(`importSheetTable`).
 *   여기서 매칭 규칙을 새로 쓰지 않는다. 규칙이 두 벌이 되면 어느 쪽이 맞는지 아무도 모른다.
 *
 * ★건드리는 것은 **차를 특정하는 칸만**이다.
 *   maker · model · sub_model · trim_name · variant · year
 *   상태·대여료·보증금·정책은 손대지 않는다 — 여기서 고칠 근거가 없다.
 *
 * ⚠ **빈 값으로는 덮지 않는다.** 시트가 비었다고 ERP 를 지우면 정보가 사라진다.
 * ⚠ 값이 «다를 때»만 쓴다. 같은 값을 다시 쓰면 updatedAt 만 흔들려 무엇이 바뀌었는지 못 본다.
 *
 *   npx tsx scripts/fix-sheet-identity-gap.mts
 *   npx tsx scripts/fix-sheet-identity-gap.mts --apply
 *   npx tsx scripts/fix-sheet-identity-gap.mts --only=RP012
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { autoMapHeaders, importSheetTable } from '../lib/domain/sheet-import';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONLY = arg('only').split(',').map(S).filter(Boolean);
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 차를 특정하는 칸만. 이 목록을 늘리기 전에 «시트가 그 칸의 정본인가»를 먼저 물어라. */
const IDENTITY = ['maker', 'model', 'sub_model', 'trim_name', 'variant', 'year'] as const;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
const getJson = async (url: string, tries = 4): Promise<any> => {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${shT}` } });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return j;
    if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(8000 * (i + 1)); continue; }
    throw new Error(j?.error?.message || `HTTP ${res.status}`);
  }
};

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const sheets = new Map<string, { name: string; url: string; profile?: unknown; profileHeaders?: unknown; depositRule?: unknown }>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code) || S(p._key);
  if (S(p.sheet_url) && !sheets.has(c)) {
    sheets.set(c, {
      name: S(p.partner_name || p.name || p.company_name) || c, url: S(p.sheet_url),
      profile: p.sheet_mapping, profileHeaders: p.sheet_mapping_headers, depositRule: p.deposit_rule,
    });
  }
}

/** 살아있는 레코드 — 차번으로 모은다. 같은 차에 레코드가 여럿이면 전부 고친다. */
const live = new Map<string, EntityRecord[]>();
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const pl = norm(p.car_number);
  if (!pl) continue;
  live.set(pl, [...(live.get(pl) || []), { ...p, _key: k, product_code: p.product_code || k } as EntityRecord]);
}

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

type Diff = { plate: string; code: string; name: string; key: string; field: string; from: string; to: string };
const diffs: Diff[] = [];
const unread: string[][] = [];

for (const [code, meta] of sheets) {
  if (ONLY.length && !ONLY.includes(code)) continue;
  const id = meta.url.match(/\/d\/([\w-]+)/)?.[1];
  if (!id) continue;
  try {
    const m = await getJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`);
    for (const tab of (m.sheets || []).map((s: Rec) => s.properties.title)) {
      const v = await getJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(tab)}!A1:BZ2000`);
      const table: string[][] = v.values || [];
      if (table.length < 2) continue;
      let imported: EntityRecord[];
      try {
        const prof = autoMapHeaders(table[0] || []);
        if (prof.car_number === undefined) continue;
        const out = importSheetTable(table, {
          profile: prof, providerCode: code, providerName: meta.name, entries,
          depositRule: meta.depositRule,
        } as Parameters<typeof importSheetTable>[1]);
        imported = (out as Rec).products || [];
      } catch { continue; }

      for (const src of imported) {
        const pl = norm((src as Rec).car_number);
        const recs = pl ? live.get(pl) : null;
        if (!recs?.length) continue;
        for (const rec of recs) {
          for (const f of IDENTITY) {
            const to = S((src as Rec)[f]);
            const from = S((rec as Rec)[f]);
            // 빈 값으로는 덮지 않는다 · 같으면 두지 않는다
            if (!to || to === from) continue;
            diffs.push({ plate: pl, code, name: meta.name, key: S((rec as Rec)._key), field: f, from, to });
          }
        }
      }
    }
  } catch (e) { unread.push([code, meta.name, String((e as Error).message).slice(0, 55)]); }
}

/** 레코드별로 묶는다 — 한 차에 여러 칸이 바뀌면 한 번에 쓴다. */
const byKey = new Map<string, Diff[]>();
for (const d of diffs) byKey.set(d.key, [...(byKey.get(d.key) || []), d]);

console.log(`■ 차종·트림을 시트에서 다시 잡는다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  고칠 차 ${byKey.size}대 · 고칠 칸 ${diffs.length}개\n`);
const byField = new Map<string, number>();
for (const d of diffs) byField.set(d.field, (byField.get(d.field) || 0) + 1);
for (const [f, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${f}`);
const byProv = new Map<string, number>();
for (const [, ds] of byKey) byProv.set(ds[0].name, (byProv.get(ds[0].name) || 0) + 1);
console.log('');
for (const [n, c] of [...byProv.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(c).padStart(4)}대  ${n}`);

console.log('');
for (const [key, ds] of [...byKey].slice(0, 14)) {
  console.log(`   ${ds[0].plate.padEnd(11)} ${key.slice(0, 20).padEnd(22)} ${ds[0].name.slice(0, 8)}`);
  for (const d of ds) console.log(`      ${d.field.padEnd(11)} 「${d.from || '(빈)'}」 → 「${d.to}」`);
}
if (byKey.size > 14) console.log(`   … 외 ${byKey.size - 14}대`);
if (unread.length) {
  console.log(`\n  ⚠ 못 읽은 시트 ${unread.length}곳`);
  for (const u of unread) console.log(`   ${u[1].slice(0, 15).padEnd(16)}${u[0].padEnd(10)}${u[2]}`);
}

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/identity-gap-fix.csv', `﻿${[
  ['차량번호', '공급사', 'RTDB키', '칸', '고치기전', '고친후'].join(','),
  ...diffs.map((d) => [d.plate, d.name, d.key, d.field, d.from, d.to].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/identity-gap-fix.csv (${diffs.length}행)`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

let done = 0; let failed = 0;
for (const [key, ds] of byKey) {
  const patch: Rec = { updatedAt: new Date().toISOString() };
  for (const d of ds) patch[d.field] = d.to;
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(key)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (res.ok) done++;
  else { failed++; console.log(`  △ ${ds[0].plate} ${key} — ${res.status} ${(await res.text()).slice(0, 120)}`); }
}
console.log(`\n  반영 ${done}대 · 실패 ${failed}대`);
console.log('  다음: 영업자 시트 두 탭을 다시 찍는다.\n');
