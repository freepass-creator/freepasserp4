/**
 * **옛 종합시트에서 채운 대여료를 되돌린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-10)
 *   RTDB 의 아이카(RP004) `sheet_url` 이 **우리 옛 종합시트**를 가리키고 있었다
 *   (「프리패스 공급사 상품리스트」 · freepassmobility 소유 · 탭 24개 · 공급사별 과거 사본).
 *   그걸 아이카 재고로 알고 `fill-missing-prices` 가 18대에 가격을 채웠다.
 *   그 표는 정본이 아니다 — 사장님이 「과거 종합 탭은 이제 안 본다」고 못박았다.
 *
 * ★되돌리는 방법 — 그때 **무엇을 썼는지 다시 계산해서 그 키만 지운다.**
 *   price 노드를 통째로 지우지 않는다. 옛 유입이 남긴 다른 키가 함께 날아갈 수 있다.
 *
 *   npx tsx scripts/revert-aggregate-prices.mts
 *   npx tsx scripts/revert-aggregate-prices.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { autoMapHeaders, importSheetTable } from '../lib/domain/sheet-import';
import { priceList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
/** 되돌릴 출처 — 우리 옛 종합시트. */
const AGGREGATE = '1BcHvwidHrdJADPUH0M3C5abaxst04fDnfxm7R9FgLDg';
/**
 * ★**오늘 실제로 채운 18대만** 되돌린다.
 *
 * 「지금 값이 옛 종합시트 값과 같은 차」로 잡으면 안 된다 — 정상 시트에서 온 가격도
 * 같은 기간 키를 쓰므로 함께 걸린다(첫 시도에서 21대가 잡혔고 대부분 무고했다).
 * 되돌림은 «내가 건드린 것»에만 해야 한다.
 */
const TOUCHED = new Set([
  '133호1996', '151호2233', '151호2249', '133하4557', '151호2267', '161호8342',
  '125호9561', '162호2310', '133하8078', '151호1331', '10호3649', '101하8595',
  '20하9506', '01하6472', '34하3209', '101하9148', '161호1005', '161호1019',
]);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbT}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const byPlate = new Map<string, Rec[]>();
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const pl = norm(p.car_number);
  if (pl) byPlate.set(pl, [...(byPlate.get(pl) || []), { ...p, _key: k }]);
}

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

/** 그때 채웠을 값을 다시 만든다 — 차번 → 기간 키. */
const wrote = new Map<string, Set<string>>();
const m = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${AGGREGATE}?fields=sheets.properties.title`, { headers: { Authorization: `Bearer ${shT}` } })).json();
for (const tab of (m.sheets || []).map((s: Rec) => s.properties.title)) {
  const v = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${AGGREGATE}/values/${encodeURIComponent(tab)}!A1:BZ2000`, { headers: { Authorization: `Bearer ${shT}` } })).json();
  const table: string[][] = v.values || [];
  if (table.length < 2) continue;
  try {
    const prof = autoMapHeaders(table[0] || []);
    if (prof.car_number === undefined) continue;
    const out = importSheetTable(table, { profile: prof, providerCode: 'RP004', providerName: '아이카', entries } as Parameters<typeof importSheetTable>[1]);
    for (const src of ((out as Rec).products || []) as EntityRecord[]) {
      const pl = norm((src as Rec).car_number);
      if (!pl) continue;
      for (const [k, e] of Object.entries(((src as Rec).price || {}) as Rec)) {
        if (Number((e as Rec)?.rent) > 0) wrote.set(pl, (wrote.get(pl) || new Set()).add(k));
      }
    }
  } catch { /* 못 읽는 탭은 건너뛴다 */ }
}

/** 지금 그 값이 실제로 들어 있는 차만 되돌린다. */
type Undo = { plate: string; key: string; keys: string[]; after: number };
const undo: Undo[] = [];
for (const [pl, keys] of wrote) {
  if (!TOUCHED.has(pl)) continue;
  for (const rec of byPlate.get(pl) || []) {
    const price = (rec.price || {}) as Rec;
    const hit = [...keys].filter((k) => price[k]);
    if (!hit.length) continue;
    const left = { ...price };
    for (const k of hit) delete left[k];
    const after = priceList({ ...rec, price: left } as EntityRecord).length;
    undo.push({ plate: pl, key: S(rec._key), keys: hit, after });
  }
}

console.log(`■ 옛 종합시트發 대여료 되돌리기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  되돌릴 차 ${undo.length}대\n`);
for (const u of undo) {
  console.log(`   ${u.plate.padEnd(11)} ${u.key.slice(0, 22).padEnd(24)} 지울 기간 ${u.keys.join('·').padEnd(18)} 남는 대여료 ${u.after}건${u.after ? '' : '  → 목록에서 빠짐'}`);
}
if (!undo.length) console.log('  되돌릴 것이 없다 — 이미 정리됐거나 값이 다르다.');

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

let done = 0;
for (const u of undo) {
  const patch: Rec = {};
  for (const k of u.keys) patch[k] = null;   // null 이면 그 키만 지워진다
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(u.key)}/price.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (res.ok) done++;
  else console.log(`  △ ${u.plate} — ${res.status} ${(await res.text()).slice(0, 100)}`);
}
console.log(`\n  되돌림 ${done}대\n`);
