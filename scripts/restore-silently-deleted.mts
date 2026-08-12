/**
 * **소리 없이 지워진 매물을 되살린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-12)
 *   공급사 시트에는 멀쩡히 있는데 ERP 에 없는 차가 있었다(아이카 12 · 경진카 1).
 *   파 보니 `_deleted = true` 인데 **`deleted_source` 가 비어 있었다** —
 *   사람이 내린 게 아니라 어떤 자동 처리가 지운 것이다.
 *   등록 도구는 «이미 있는 차»로 보고 다시 안 만든다(사람이 내린 차를 되살리지 않으려는 안전장치).
 *   그래서 영영 안 올라오고 「시트 = ERP = 엑셀」이 어긋난 채로 남았다.
 *
 * ★되살리는 조건은 **셋 다** 맞아야 한다.
 *   ① `_deleted` 표시가 있고
 *   ② `deleted_source` 가 비어 있고 — **사람이 내린 차는 절대 건드리지 않는다**
 *   ③ 지금 그 공급사 시트에 그 차번이 살아 있다 — 시트가 정본이다
 *   ④ **그 차의 살아 있는 기록이 ERP 에 하나도 없다**
 *      ⚠ 이게 없으면 큰일 난다. 지워진 기록의 대부분은 «이미 살아 있는 차의 옛 중복 키»다
 *        (실측 2026-08-12: 조건 ①②③만으로 225대가 걸렸는데 그중 212대가 그랬다).
 *        그걸 되살리면 같은 차가 두 대로 보이고, 영업이 없는 재고를 팔게 된다.
 * ★같은 차에 키가 여러 벌이면 **하나만** 살린다. 둘 다 살리면 같은 차가 두 대로 보인다.
 *   지금 규칙인 `<공급사코드>_<차번>` 꼴을 고르고, 나머지는 지워진 채로 둔다.
 *
 *   npx tsx scripts/restore-silently-deleted.mts
 *   npx tsx scripts/restore-silently-deleted.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const partners: Record<string, Rec> = {};
for (const [, src] of [['3', t3], ['4', t4]] as [string, Rec][]) {
  for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
}
const gone = (p: Rec) => S(p?.status) === 'deleted';
const isDead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || gone(p);
const partnerDead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || gone(p);

/** 공급사별로 «지금 시트에 살아 있는 차번». 시트를 못 읽으면 그 공급사는 건드리지 않는다. */
const alive = new Map<string, Set<string>>();
const seen = new Set<string>();
for (const p of Object.values<Rec>(partners)) {
  const code = S(p.partner_code);
  if (partnerDead(p) || !code || NOT_SHEET_BACKED.has(code)) continue;
  const id = (S(p.sheet_url).match(/\/d\/([\w-]+)/) || [])[1];
  if (!id || seen.has(`${code}|${id}`)) continue;
  seen.add(`${code}|${id}`);
  let grid: Rec;
  try {
    grid = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`,
      { headers: { Authorization: `Bearer ${gT}` } })).json() as Rec;
  } catch { continue; }
  if (grid?.error) continue;
  const set = alive.get(code) || new Set<string>();
  for (const t of readSupplierSheet(grid as never, p as EntityRecord).tabs) {
    const hdr = (t.table[0] || []).map(S);
    const pi = hdr.findIndex((h) => /차량번호|차번/.test(h));
    if (pi < 0) continue;
    for (const r of t.table.slice(1)) { const pl = norm(r[pi]); if (pl) set.add(pl); }
  }
  alive.set(code, set);
}

console.log(`■ 소리 없이 지워진 매물 되살리기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);

/** 지금 살아 있는 차번 — 이게 있으면 되살릴 이유가 없다(중복이 된다). */
const liveNow = new Set<string>();
for (const p of Object.values<Rec>(prods)) {
  if (!p || typeof p !== 'object' || isDead(p)) continue;
  const code = S(p.provider_company_code) || S(p.partner_code);
  const plate = norm(p.car_number);
  if (code && plate) liveNow.add(`${code}|${plate}`);
}

type Cand = { key: string; code: string; plate: string; name: string };
const cands: Cand[] = [];
let alreadyLive = 0;
const humanHeld: string[] = [];
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object') continue;
  if (!(p._deleted === true || !!p.deletedAt || gone(p))) continue;
  const code = S(p.provider_company_code) || S(p.partner_code);
  const plate = norm(p.car_number);
  if (!code || !plate) continue;
  if (!alive.get(code)?.has(plate)) continue;                 // 시트에 없으면 되살릴 이유가 없다
  if (liveNow.has(`${code}|${plate}`)) { alreadyLive++; continue; }   // ★이미 살아 있다 — 옛 중복 키다
  const why = S(p.deleted_source) || S(p.deletedReason);
  if (why) { humanHeld.push(`${plate} ${S(p.maker)} ${S(p.model)} — ${why}`); continue; }
  cands.push({ key: k, code, plate, name: `${S(p.maker)} ${S(p.model)}`.trim() });
}

/** 같은 차에 키가 여러 벌이면 지금 규칙(`<코드>_<차번>`)을 고른다. */
const byPlate = new Map<string, Cand[]>();
for (const c of cands) { const arr = byPlate.get(`${c.code}|${c.plate}`) || []; arr.push(c); byPlate.set(`${c.code}|${c.plate}`, arr); }
const pick: Cand[] = []; const dupSkipped: string[] = [];
for (const [, arr] of byPlate) {
  if (arr.length === 1) { pick.push(arr[0]); continue; }
  const want = arr.find((c) => c.key === `${c.code}_${c.plate}`) || arr[0];
  pick.push(want);
  for (const c of arr) if (c.key !== want.key) dupSkipped.push(`${c.plate} — 키 ${c.key} 는 지워진 채로 둔다(살리는 건 ${want.key})`);
}

const tally = new Map<string, number>();
for (const c of pick) tally.set(c.code, (tally.get(c.code) || 0) + 1);
console.log(`  되살릴 차 ${pick.length}대 — ${[...tally].map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`);
for (const c of pick.slice(0, 20)) console.log(`     ${c.plate.padEnd(11)}${c.name.padEnd(18)}${c.key}`);
if (dupSkipped.length) { console.log(`\n  키가 여러 벌이라 한쪽만 살리는 차 ${dupSkipped.length}건`); for (const d of dupSkipped) console.log(`     ${d}`); }
if (humanHeld.length) {
  console.log(`\n  ■ 사람이 내린 차라 **안 건드린 것** ${humanHeld.length}대`);
  for (const h of humanHeld.slice(0, 10)) console.log(`     ${h}`);
}

mkdirSync('tmp', { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/restore-backup-${stamp}.json`;
writeFileSync(backup, JSON.stringify(Object.fromEntries(pick.map((c) => [c.key, {
  _deleted: (prods as Rec)[c.key]?._deleted, deletedAt: (prods as Rec)[c.key]?.deletedAt, status: (prods as Rec)[c.key]?.status,
}])), null, 1), 'utf8');
console.log(`\n  되돌리기용 백업: ${backup}`);
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
let done = 0;
for (const c of pick) {
  const cur = (prods as Rec)[c.key] || {};
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(c.key)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    // 삭제 표시를 걷어낸다. `status` 가 'deleted' 였으면 비운다 — 상태는 시트가 다시 채운다.
    body: JSON.stringify({
      _deleted: null, deletedAt: null, deleted_source: null,
      ...(gone(cur) ? { status: null } : {}),
      updatedAt: at,
    }),
  });
  if (res.ok) done++; else console.log(`  △ ${c.plate} — ${res.status}`);
}
console.log(`\n  되살림 ${done}대\n`);
