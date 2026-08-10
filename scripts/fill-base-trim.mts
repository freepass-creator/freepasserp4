/**
 * **안 적힌 칸을 «가장 기본값»으로 채운다** — 세부트림·인승·구동. 기본 dry-run, 반영은 `--apply`.
 *
 * ★규칙(사장님 2026-08-10) — 「트림 없으면 우리 정한 것처럼 그냥 젤 바닥 트림으로」.
 *   공급사가 트림을 안 적는 경우가 있다(아이카 26 · 이안카 13 · 오플 10 …).
 *   옵션 칸에 「기본형」이라고만 적혀 오기도 한다. 그때 **없는 채로 두면 영업자가 못 판다** —
 *   손님은 늘 「무슨 트림이냐」를 묻는다. 마스터가 아는 최하 트림을 기본값으로 놓고,
 *   실제가 더 높은 트림이면 공급사가 고쳐 주면 된다. 없는 것보다 낫다.
 *   같은 규칙을 **인승·구동**에도 쓴다. 단 인승에는 조건이 있다 —
 *
 * ★**인승은 «인승이 갈리는 차»에만 넣는다**(사장님 2026-08-10 — 「승용은 하는 거 아니다」).
 *   카니발 9인승/7인승, 스타리아 11인승처럼 SUV·RV·승합은 인승이 곧 상품이라 채워야 하지만,
 *   쏘나타·그랜저 같은 승용에 「5인승」을 적는 건 아무 뜻이 없다.
 *   판정은 **마스터가 그 차의 인승을 말해 주는가**로 한다 — 말해 주지 않으면 안 채운다.
 *   (전에 승용까지 5인승으로 일괄로 넣었다가 되돌렸다.)
 *
 * ★트림은 **그 차의 파워트레인 아래에서만** 고른다. 마스터의 세대 전체 트림 목록에서
 *   고르면 다른 파워트레인의 트림이 붙는다(가솔린 차에 하이브리드 전용 트림 등).
 *   마스터의 `variants[].trims` 는 낮은 등급부터 적혀 있어 첫 번째가 최하다.
 *
 * ⚠ **이미 트림이 있는 차는 건드리지 않는다.** 추정으로 실측을 덮으면 안 된다.
 * ⚠ 넣은 값에는 `_trim_inferred: true` 를 남긴다 — 나중에 «시트에서 온 값»과 갈라 봐야 한다.
 *
 *   npx tsx scripts/fill-base-trim.mts
 *   npx tsx scripts/fill-base-trim.mts --apply
 *   npx tsx scripts/fill-base-trim.mts --apply --only=RP004
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONLY = arg('only').split(',').map(S).filter(Boolean);
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbT}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const targets = Object.entries<Rec>(prods)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord))
  .filter((p) => !isHiddenFromCatalog(p as Rec) && priceList(p).length > 0)
  .filter((p) => !S((p as Rec).trim_name) || !S((p as Rec).seats) || !S((p as Rec).drive_type))
  .filter((p) => !ONLY.length || ONLY.includes(S((p as Rec).provider_company_code)));

type Fill = { plate: string; key: string; code: string; car: string; variant: string; patch: Rec; all: string[] };
const fills: Fill[] = [];
const noCandidate: Fill[] = [];
for (const p of targets) {
  const r = p as Rec;
  const entry = entries.find((e: Rec) => S(e.sub_model) === S(r.sub_model));
  // ★그 차의 파워트레인 아래에서만 고른다.
  const variant = (entry?.variants || []).find((v: Rec) => S(v.label) === S(r.variant));
  const trims: string[] = (variant?.trims || []).map(S).filter(Boolean);
  const patch: Rec = {};
  // 트림 — 마스터의 첫 트림이 가장 낮은 등급이다.
  if (!S(r.trim_name) && trims[0]) patch.trim_name = trims[0];
  // 인승 — 마스터가 아는 차만. 모르면 «승용»이라 뜻이 없으므로 비워 둔다.
  const seat = S(variant?.seat) || S(entry?.seat);
  if (!S(r.seats) && seat) patch.seats = seat;
  // 구동 — 마스터에 적힌 값이 있으면 그것, 없으면 2WD(표준양식의 「안 적으면 2WD 로 본다」와 같다).
  if (!S(r.drive_type)) patch.drive_type = S(variant?.drivetrain) || '2WD';
  const row: Fill = {
    plate: S(r.car_number) || '(무번호)', key: S(r._key), code: S(r.provider_company_code),
    car: `${S(r.maker)} ${S(r.sub_model) || S(r.model)}`.trim(), variant: S(r.variant),
    patch, all: trims,
  };
  // 트림이 비었는데 후보도 없으면 «못 채운 것»으로 남긴다 — 인승·구동만 채우고 넘어가지 않는다.
  if (!S(r.trim_name) && !trims[0]) noCandidate.push(row);
  if (Object.keys(patch).length) fills.push(row);
}

console.log(`■ 세부트림이 빈 차에 최하 트림을 넣는다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  빈 차 ${targets.length}대 · 채울 수 있는 차 ${fills.length}대 · 마스터에 후보가 없는 차 ${noCandidate.length}대\n`);
const byProv = new Map<string, number>();
for (const f of fills) byProv.set(f.code, (byProv.get(f.code) || 0) + 1);
for (const [c, n] of [...byProv].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${c}`);
console.log('');
for (const f of fills.slice(0, 16)) {
  const what = Object.entries(f.patch).map(([k, v]) => `${k === 'trim_name' ? '트림' : k === 'seats' ? '인승' : '구동'} 「${v}」`).join(' · ');
  console.log(`   ${f.plate.padEnd(11)} ${f.car.slice(0, 22).padEnd(24)} ${f.variant.padEnd(16)} → ${what}`);
}
if (fills.length > 16) console.log(`   … 외 ${fills.length - 16}대`);
if (noCandidate.length) {
  console.log(`\n  마스터에 트림 후보가 없어 못 채우는 차 ${noCandidate.length}대 — 마스터를 손봐야 한다`);
  for (const f of noCandidate) console.log(`   ${f.plate.padEnd(11)} ${f.car.slice(0, 24).padEnd(26)} ${f.variant || '(파워트레인 없음)'}`);
}

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/base-trim-fill.csv', `﻿${[
  ['차량번호', '공급사코드', 'RTDB키', '차종', '파워트레인', '트림', '인승', '구동', '트림 후보'].join(','),
  ...fills.map((f) => [f.plate, f.code, f.key, f.car, f.variant,
    S(f.patch.trim_name), S(f.patch.seats), S(f.patch.drive_type), f.all.join(' · ')].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/base-trim-fill.csv (${fills.length}행)`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
let done = 0; let bad = 0;
for (const f of fills) {
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(f.key)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    // 추정값이라는 표시를 남긴다 — 공급사가 실제 값을 주면 그때 덮는다.
    body: JSON.stringify({ ...f.patch, _spec_inferred: true, updatedAt: at }),
  });
  if (res.ok) done++;
  else { bad++; console.log(`  △ ${f.plate} — ${res.status} ${(await res.text()).slice(0, 100)}`); }
}
console.log(`\n  채움 ${done}대 · 실패 ${bad}대`);
console.log('  다음: 영업자 시트 두 탭을 다시 찍는다.\n');
