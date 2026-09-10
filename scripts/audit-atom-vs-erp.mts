/**
 * **원자(Firestore) ↔ ERP(RTDB v4/products) 대조.** 읽기 전용 · 벌어지면 알린다.
 *
 * ★사장님 2026-09-08 「원자를 상품리스트 2개(공용·하허호), **ERP에 반영해서 화이트라벨까지** 적용되게끔」
 *
 * ⚠ 지금 넷이 «같은 원자»를 안 본다 —
 * ```
 *   상품리스트 F01 · 하허호 F86   ←  Firestore products   (오늘 원천에서 다시 당긴 것)
 *   ERP 파인더·상세               ←  RTDB v4/products      (옛 길로 채워진 것)
 * ```
 *   실측 2026-09-08 — 양쪽에 다 있는 차 중 **674대**의 값이 달랐다. 그중 `vehicle_status` 가 149대.
 *   상태가 갈리면 **판 차가 ERP 에서 다시 서거나, 팔 수 있는 차가 ERP 에서만 숨는다.**
 *
 * ★**여기서 고치지 않는다.** 어느 쪽으로 밀지는 사람이 정할 일이고,
 *   ⑭ 미러가 RTDB→Firestore 로 흐르므로 반대로도 밀면 **두 방향 고리**가 된다.
 *   이 검사는 «얼마나 벌어졌나»를 매시간 눈에 띄게 두는 것이 일이다 — 조용히 자라는 것을 막는다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/audit-atom-vs-erp.mts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from './lib/disabled-rtdb.mts';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const K = (v: unknown) => S(v).replace(/\s/g, '');
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
const app = initializeApp({
  credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\n/g, '\n') }),
  databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
});

const F = new Map<string, any>();
for (const d of (await getFirestore(app).collection('products').get()).docs) { const v = d.data(); F.set(K(v.car_number) || d.id, v); }
const v4 = (await getDatabase(app).ref('v4/products').get()).val() as Record<string, any> || {};
const R = new Map<string, any>();
for (const x of Object.values(v4)) if (x?.car_number) R.set(K(x.car_number), x);

/** 「그 차를 말하는 데」 쓰는 칸만 본다 — 내부 표시값까지 세면 잡음이 이긴다. */
const FIELDS = ['maker', 'model', 'sub_model', 'trim_name', 'vehicle_status', 'ext_color', 'year', 'mileage', 'fuel_type', 'product_type'] as const;
const per = new Map<string, number>();
const 상태갈림: string[] = [];
let 다름 = 0;
for (const [p, f] of F) {
  const r = R.get(p); if (!r) continue;
  let d = 0;
  for (const k of FIELDS) { const a = S(f[k]), b = S(r[k]); if (a && b && a !== b) { d++; per.set(k, (per.get(k) || 0) + 1); } }
  const fa = S(f.vehicle_status), ra = S(r.vehicle_status) || S(r.status);
  /** ★상태만 따로 센다 — 「팔 수 있나」가 갈리는 것은 다른 칸과 무게가 다르다. */
  if (fa && ra && fa !== ra && (/출고불가|계약중/.test(fa) || /출고불가|계약중/.test(ra)) && 상태갈림.length < 12) 상태갈림.push(`${p}  원자 ${fa} ↔ ERP ${ra}`);
  if (d) 다름++;
}
const 원자만 = [...F.keys()].filter((k) => !R.has(k)).length;
const ERP만 = [...R.keys()].filter((k) => !F.has(k)).length;

console.log(`\n원자(Firestore) ${F.size} · ERP(RTDB v4) ${R.size}`);
console.log(`양쪽에 있는 차 중 값이 다른 차 ${다름} · 원자에만 ${원자만} · ERP에만 ${ERP만}`);
console.log(`칸별 — ${[...per].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}`);
if (상태갈림.length) { console.log(`\n  ▲ 팔 수 있나가 갈린 차(표본):`); for (const x of 상태갈림) console.log(`     ${x}`); }
const 심각 = 다름 > F.size * 0.1 || (per.get('vehicle_status') || 0) > 20;
console.log(심각
  ? `\n  ▲ 원자와 ERP 가 크게 벌어졌다 — 시트와 ERP 가 «다른 차»를 말하고 있다. 어느 쪽으로 맞출지 사람이 정해야 한다.\n`
  : `\n✓ 원자와 ERP 가 대체로 같다\n`);
process.exit(0);
