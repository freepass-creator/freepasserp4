/**
 * **영업자 시트를 ERP 로 되읽는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-13 — 「자 이렇게 시트부터 작업하고 erp가 이걸 그대로 갖고 가면 되잖아」)
 *   시트가 사람이 매일 보는 자리이고 거기서 틀린 건 바로 눈에 띈다. 그 시트를 정본으로 삼아
 *   ERP 가 같은 값을 갖게 한다. 그래야 「시트는 맞는데 ERP 는 틀린」 상태가 안 남는다.
 *
 * ★**옮기는 것은 차명 축 넷뿐이다** — 모델 · 세부모델 · 파워트레인 · 세부트림.
 *   발행할 때 우리가 바로잡은 것(어순 정리·트림 분리·표기 사전)이 ERP 원본에도 들어가야
 *   다음 감사에서 또 어긋났다고 나오지 않는다.
 *
 * ⚠ **돈은 되읽지 않는다.** 시트의 대여료·보증금은 ERP 숫자를 «보기 좋게 찍은 글자»(「1,070,000」)다.
 *   그걸 되넣으면 숫자가 글자로 바뀌어 계산이 깨진다. 돈의 정본은 공급사 시트 → ERP 유입이다.
 * ⚠ **계약 중인 차는 건드리지 않는다.** 계약서·정산이 그 이름으로 나갔을 수 있다.
 * ⚠ 값을 지우지 않는다 — 시트가 비어 있으면 ERP 값을 그대로 둔다(빈 칸이 «없다»는 뜻은 아니다).
 *
 *   npx tsx scripts/apply-sheet-to-erp.mts
 *   npx tsx scripts/apply-sheet-to-erp.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { EMPTY_BOOK, type AliasBook } from '../lib/domain/master-alias';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const SHEET = arg('sheet', S(process.env.INVENTORY_EXPORT_SHEET_ID) || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 시트 열 이름 → 매물 필드. 여기 없는 열은 되읽지 않는다. */
const FIELD: Record<string, string> = {
  모델: 'model', 세부모델: 'sub_model', 파워트레인: 'variant', 세부트림: 'trim_name',
};
/**
 * ★연령할증은 **시트가 ERP 보다 많이 안다.**
 *   발행기가 공급사 시트 칸을 직접 긁어 싣는데(실측 286대), ERP `sheet_meta` 는 대부분 비어 있다.
 *   그 값이 없으면 영업자가 21세 손님 할증을 못 말한다 — 시트에 있는 걸 ERP 에도 넣어 둔다.
 * ⚠ `sheet_meta` 아래로 들어간다(매물 최상위가 아니다).
 */
const META: Record<string, string> = {
  '21세': 'age_21', '23세': 'age_23', '1만+': 'year_1plus',
};
/** 이 상태의 차는 건드리지 않는다 — 계약서가 그 이름으로 나갔을 수 있다. */
const LOCKED = new Set(['계약중']);

/** 사람이 확인한 규칙은 가드를 넘긴다 — 아래에서 쓴다. */
const ALIAS: AliasBook = (() => {
  try { return JSON.parse(readFileSync('public/data/master-aliases.json', 'utf8')) as AliasBook; } catch { return EMPTY_BOOK; }
})();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

const get = async (u: string) => {
  const r = await fetch(u, { headers: { Authorization: `Bearer ${shT}` } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t) as Rec;
};
const meta = await get(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets.properties(title,hidden)`);
const tab = ((meta.sheets || []) as Rec[])
  .find((s) => !s.properties.hidden && S(s.properties.title).startsWith('상품리스트'))?.properties.title;
if (!tab) throw new Error('상품리스트 탭을 못 찾음');
const vals = await get(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`'${String(tab).replace(/'/g, "''")}'`)}`);
const rows = (vals.values || []) as string[][];
const hdr = (rows[0] || []).map(S);
const iPlate = hdr.indexOf('차량번호');
if (iPlate < 0) throw new Error('시트에 차량번호 열이 없다');
console.log(`■ 시트 → ERP 되읽기 ${APPLY ? '반영' : '미리보기(dry-run)'}\n`);
console.log(`  시트 「${tab}」 ${rows.length - 1}줄`);

const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbT}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
/** 차번 → 매물 키. 같은 차번이 둘이면 손대지 않는다 — 어느 쪽인지 우리가 정할 일이 아니다. */
const keyByPlate = new Map<string, string[]>();
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const pl = norm(p.car_number);
  if (!pl) continue;
  (keyByPlate.get(pl) || keyByPlate.set(pl, []).get(pl)!).push(k);
}

type Patch = { key: string; plate: string; before: Rec; after: Rec };
const patches: Patch[] = [];
/** 되읽으면 ERP 가 나빠지는 것 — 넣지 않고 사람에게 보여 준다. */
const rejected: string[] = [];
let noMatch = 0, dup = 0, locked = 0, same = 0;
for (const r of rows.slice(1)) {
  const plate = norm(r[iPlate]);
  if (!plate) continue;
  const keys = keyByPlate.get(plate) || [];
  if (!keys.length) { noMatch++; continue; }
  if (keys.length > 1) { dup++; console.log(`  ⚠ 차번 ${plate} 이 ERP 에 ${keys.length}건 — 건너뛴다`); continue; }
  const key = keys[0];
  const p = prods[key] as Rec;
  if (LOCKED.has(S(p.vehicle_status))) { locked++; continue; }
  const before: Rec = {}, after: Rec = {};
  for (const [col, field] of Object.entries(FIELD)) {
    const j = hdr.indexOf(col);
    if (j < 0) continue;
    const want = S(r[j]);
    const have = S(p[field]);
    // ⚠ 시트가 비면 ERP 값을 지우지 않는다.
    if (!want || have === want) continue;
    /**
     * ★**ERP 를 더 나쁘게 만드는 되읽기는 막는다**(사장님 2026-08-13 — 「절대로 혼선 없이」).
     *   ① 트림 자리에 «문장»이 오면 거부한다. 공급사 원문이 통째로 흘러든 것이다
     *      (실측: 「ARKANA-LJL 25MY SP 1.6 GTe Iconic」).
     *   ② ERP 가 이미 더 자세히 적고 있으면 덮지 않는다 — 「LPI 트렌디」를 「트렌디」로 줄이면 등급이 내려간다.
     *   막힌 것은 버리지 않고 아래 목록으로 남긴다. 사람이 보고 사전에 규칙을 넣을 자리다.
     */
    /**
     * ★**사람이 확인한 사전 규칙은 가드보다 위다.** 「LPI 트렌디 → 트렌디」처럼 값이 짧아지는 게
     *   맞다고 사람이 정한 자리가 있다. 그건 «나빠지는 것»이 아니라 «마스터 말로 맞추는 것»이다.
     */
    const decided = (ALIAS.rules || []).some((x) => x.reviewed
      && x.kind === (field === 'trim_name' ? 'trim' : 'variant')
      && norm(x.from) === norm(have) && norm(x.to) === norm(want));
    if (!decided) {
      if (field === 'trim_name' && (want.length > 20 || want.split(/\s+/).length > 4)) {
        rejected.push(`${plate} ${field} 「${have}」→「${want}」  (문장이라 거부)`);
        continue;
      }
      if (have && norm(have).includes(norm(want)) && norm(have).length > norm(want).length) {
        rejected.push(`${plate} ${field} 「${have}」→「${want}」  (ERP 가 더 자세해 거부)`);
        continue;
      }
    }
    before[field] = have;
    after[field] = want;
  }
  // 연령할증 — `sheet_meta` 아래로. 시트가 비면 ERP 값을 지우지 않는다.
  const meta = (p.sheet_meta || {}) as Rec;
  const metaAfter: Rec = {};
  for (const [col, field] of Object.entries(META)) {
    const j = hdr.indexOf(col);
    if (j < 0) continue;
    const want = S(r[j]);
    if (!want || S(meta[field]) === want) continue;
    before[`sheet_meta.${field}`] = S(meta[field]);
    metaAfter[field] = want;
  }
  if (Object.keys(metaAfter).length) after.sheet_meta = { ...meta, ...metaAfter };
  if (!Object.keys(after).length) { same++; continue; }
  patches.push({ key, plate, before, after });
}

console.log(`  이미 같음 ${same} · 고칠 것 ${patches.length} · 계약중이라 건너뜀 ${locked} · ERP 에 없음 ${noMatch}${dup ? ` · 차번 중복 ${dup}` : ''}`);
const byField = new Map<string, number>();
for (const x of patches) for (const f of Object.keys(x.after)) byField.set(f, (byField.get(f) || 0) + 1);
console.log(`  필드별: ${[...byField].map(([f, n]) => `${f} ${n}`).join(' · ') || '(없음)'}`);
console.log('\n  표본');
for (const x of patches.slice(0, 15)) {
  // `sheet_meta` 는 통째로 바꿔 넣지만 사람에게는 «무엇이 달라졌나»를 펴서 보여 준다.
  const d = Object.keys(x.after).flatMap((f) => (f === 'sheet_meta'
    ? Object.entries(META).map(([, k]) => `sheet_meta.${k} 「${S(x.before[`sheet_meta.${k}`])}」→「${S((x.after.sheet_meta as Rec)[k])}」`)
      .filter((s) => !s.includes('「」→「」'))
    : [`${f} 「${x.before[f]}」→「${x.after[f]}」`])).join(' · ');
  console.log(`   ${x.plate.padEnd(10)} ${d}`);
}
if (patches.length > 15) console.log(`   … 그 밖 ${patches.length - 15}대`);
if (rejected.length) {
  console.log(`\n  ⚠ 막은 것 ${rejected.length}건 — ERP 가 나빠지는 방향이라 넣지 않았다`);
  for (const x of rejected) console.log(`   ${x}`);
}

if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }
if (!patches.length) { console.log('\n  고칠 게 없다.\n'); process.exit(0); }

// 되돌릴 수 있게 «고치기 전» 값을 남긴다.
mkdirSync('tmp', { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const undo = `tmp/sheet-to-erp-undo-${stamp}.json`;
writeFileSync(undo, JSON.stringify(patches.map((x) => ({ key: x.key, plate: x.plate, before: x.before })), null, 2), 'utf8');

let done = 0, failed = 0;
for (const x of patches) {
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(x.key)}.json?access_token=${dbT}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...x.after, updatedAt: new Date().toISOString(), _synced_from: 'sales-sheet' }),
  });
  if (res.ok) done++;
  else { failed++; console.log(`   ⚠ ${x.plate} — ${res.status} ${(await res.text()).slice(0, 120)}`); }
}
console.log(`\n  반영 — ${done}대${failed ? ` · 실패 ${failed}대` : ''}`);
console.log(`  되돌리려면 ${undo} 의 before 값을 다시 넣어라\n`);
