/**
 * **ERP 차 이름을 판매시트의 「모델 · 차명」으로 갈아엎는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-20 「ERP 에 반영되는 거 그냥 차명을 넣기로 했는데???? · 모델 차명으로만 하기로 했잖아 ·
 *   그러니까 현재 검색은 모델로만 되는 거지 세부모델도 모르고」.
 *   실측 2026-08-20 — 빌린카 `29부7772`: 공급사 시트는 **「아반떼MD 자가용 가솔린 1.6 B 오토 11MY PREMIER」**,
 *   판매시트까지 그대로 갔는데 **ERP 만 「현대 더 뉴 아반떼 CN7 스마트」**로 불렀다(사진은 아반떼 MD 였다).
 *   08-15 상품마스터가 차종마스터로 맞춰 박아 둔 이름(`sub_model`·`trim_name`·`supplier_vehicle_name`)이
 *   그대로 남아 있었기 때문이다. 상품마스터는 이제 안 거치는데 이름만 옛것으로 남았다.
 *
 * ★쓰는 칸은 **둘뿐**이다 — `model`(검색용) · `supplier_vehicle_name`(화면에 뜨는 차명, 시트 원문 그대로).
 *   `sub_model`·`variant`·`trim_name`·`trim_extra` 는 **비운다** — 우리가 짐작해 만든 이름이라 틀리면 그대로 거짓말이 된다.
 *   (`lib/domain/vehicle-name-display.supplierVehicleName` 이 supplier_vehicle_name 을 먼저 쓰고,
 *    없을 때만 sub_model+trim 을 조합한다. 그래서 비워 두면 시트 이름만 남는다.)
 * ⚠ 판매시트를 못 읽었거나 50대 미만이면 아무것도 하지 않는다 — 0대는 «없다»가 아니라 «모름»이다.
 *
 *   npx tsx scripts/mirror-sales-vehicle-name.mts
 *   npx tsx scripts/mirror-sales-vehicle-name.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** 우리가 만든 이름 칸 — 비운다. */
const WIPE = ['sub_model', 'variant', 'trim_name', 'trim_extra'] as const;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const sheetJwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await sheetJwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return JSON.parse(x);
    if (r.status === 429 && n < 5) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 140)}`);
  }
};

// ── 판매시트: 차번 → 제조사 · 모델 · 차명 ────────────────────────────────────
const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}?fields=sheets.properties(title)`);
const tabs = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter((t) => /^(상품리스트|손오공구독|오플구독)/.test(t));
type Want = { maker: string; model: string; name: string };
const want = new Map<string, Want>();
for (const tab of tabs) {
  const v = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}/values/${encodeURIComponent(tab)}`);
  const rows = ((v.values || []) as string[][]);
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호')); if (hi < 0) continue;
  const hdr = rows[hi].map(norm);
  const pi = hdr.indexOf('차량번호');
  const mk = hdr.indexOf('제조사');
  const mo = ['모델', '모델명'].map((h) => hdr.indexOf(norm(h))).find((i) => i >= 0) ?? -1;
  const nm = hdr.findIndex((h) => h.startsWith('차명'));
  for (const r of rows.slice(hi + 1)) {
    const plate = norm(r[pi]); if (!plate || want.has(plate)) continue;
    want.set(plate, { maker: mk >= 0 ? S(r[mk]) : '', model: mo >= 0 ? S(r[mo]) : '', name: nm >= 0 ? S(r[nm]) : '' });
  }
}
console.log(`■ 판매시트 ${tabs.length}탭 · 차 ${want.size}대`);
if (want.size < 50) { console.log('⛔ 판매시트를 제대로 못 읽었다 — 아무것도 하지 않는다\n'); process.exit(1); }

// ── ERP 와 대조 ──────────────────────────────────────────────────────────────
const dbTok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbTok}`)).text()) || {};

type Job = { key: string; plate: string; before: string; after: string; patch: Rec };
const jobs: Job[] = [];
for (const [key, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object') continue;
  if (p._deleted === true || S(p.status) === 'deleted') continue;
  const plate = norm(p.car_number); if (!plate) continue;
  const w = want.get(plate); if (!w) continue;                       // 판매시트에 없는 차는 손대지 않는다
  const patch: Rec = {};
  if (w.maker && S(p.maker) !== w.maker) patch.maker = w.maker;
  if (w.model && S(p.model) !== w.model) patch.model = w.model;
  if (w.name && S(p.supplier_vehicle_name) !== w.name) patch.supplier_vehicle_name = w.name;
  for (const f of WIPE) if (S(p[f])) patch[f] = '';
  if (!Object.keys(patch).length) continue;
  const before = [S(p.maker), S(p.sub_model) || S(p.model), S(p.trim_name)].filter(Boolean).join(' ');
  const after = [w.maker || S(p.maker), w.model || S(p.model)].filter(Boolean).join(' ');
  jobs.push({ key, plate, before, after, patch });
}
console.log(`\n■ 이름 고칠 차 ${jobs.length}대 ${APPLY ? '(반영)' : '(dry-run)'}`);
for (const j of jobs.slice(0, 20)) console.log(`   ${j.plate.padEnd(10)} ${j.before.slice(0, 30).padEnd(32)} → ${j.after.slice(0, 22).padEnd(24)} 차명 ${S(j.patch.supplier_vehicle_name).slice(0, 34) || '(그대로)'}`);
if (jobs.length > 20) console.log(`   … 그 밖 ${jobs.length - 20}대`);
writeFileSync('tmp/mirror-sales-vehicle-name.json', JSON.stringify(jobs, null, 2));
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply · 되돌릴 값 tmp/mirror-sales-vehicle-name.json\n'); process.exit(0); }

let ok = 0, bad = 0;
for (const j of jobs) {
  const r = await fetch(`${DB}/v4/products/${encodeURIComponent(j.key)}.json?access_token=${dbTok}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...j.patch, updatedBy: 'mirror-sales-vehicle-name', updatedAt: new Date().toISOString() }),
  });
  if (r.ok) ok++; else { bad++; console.log(`   ⚠ ${j.plate} ${r.status} ${(await r.text()).slice(0, 100)}`); }
}
console.log(`\n■ 끝 — 고침 ${ok}대${bad ? ` · 실패 ${bad}` : ''} · 되돌릴 값 tmp/mirror-sales-vehicle-name.json\n`);
