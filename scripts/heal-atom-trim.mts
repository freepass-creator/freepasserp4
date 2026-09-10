/**
 * **원자(SSOT)의 빈 세부트림을 채운다.** 기본 미리보기 · 반영은 `--apply`.
 *
 * > 사장님 2026-09-10 「원자의 기본형을 채워야 되고」 ·
 * >  「한 번만 **SSOT에다가 번호별로** 한 번만 잘 이쁘게 해 놓으면 문제가 없을 거 같은데」
 *
 * ⚠⚠ **왜 규칙이 있는데 안 채워져 있었나 — 쓰는 곳이 SSOT 가 아니었다.**
 * ```
 *   ⑬½ 원자 치유(fix-atoms-from-refined-sheets)  →  RTDB  v4/products      ← 여기에 썼다
 *   원자 SSOT                                    →  Firestore  products    ← 넷이 읽는 곳
 * ```
 *   치유 마지막 줄이 「다음 미러가 Firestore 로 전파」다. 그 전파가 끊기면 «고쳤는데 안 보인다».
 *   실측 2026-09-10 — 세운 차 697 중 **세부트림 빈 차 121**, 원자에 「기본형」인 차 **0대**.
 *   치유를 돌려도 「세부트림 교정 0」이었다(치유는 정제시트에 있는 차만 본다 — 4곳뿐).
 * ⇒ 이 스크립트는 **Firestore 원자에 바로 쓴다.** 규칙은 `lib/domain/trim-pick` 한 벌을 쓴다.
 *
 * ★**지어내지 않는다** — 마스터 트림 풀에 있는 이름만. 못 고르면 「기본형」.
 * ★**있는 값은 안 덮는다** — 빈 칸만 채운다.
 * ★**세부모델이 비면 손대지 않는다** — 그건 진짜 «모른다»다(실측 46소3896 폴스타 2).
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/heal-atom-trim.mts [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildTrimPool, pickTrim } from '../lib/domain/trim-pick';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore(app);

const pool = buildTrimPool(JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')));
const docs = (await fs.collection('products').get()).docs;

type Fix = { ref: FirebaseFirestore.DocumentReference; car: string; code: string; sub: string; raw: string; to: string };
const 채울것: Fix[] = [];
let 이미있음 = 0, 세부모델없음 = 0, 안세움 = 0;
for (const d of docs) {
  const v = d.data() as Record<string, unknown>;
  if (v.listable !== true) { 안세움++; continue; }          // 세운 차만 — 창고 차는 발행에 안 쓴다
  if (S(v.trim_name)) { 이미있음++; continue; }             // 있는 값은 안 덮는다
  const sub = S(v.sub_model);
  if (!sub) { 세부모델없음++; continue; }                    // 진짜 모른다 — 손대지 않는다
  /** 원문 차명 — 미러가 만든 「원문」 객체, 없으면 RTDB 쪽 이름칸. */
  const raw = S((v['원문'] as Record<string, unknown> | undefined)?.['차명']) || S(v.supplier_vehicle_name);
  const to = pickTrim(sub, raw, pool);
  if (!to) continue;
  채울것.push({ ref: d.ref, car: S(v.car_number), code: S(v.provider_company_code), sub, raw, to });
}

const 골라낸 = 채울것.filter((x) => x.to !== '기본형');
const 기본형 = 채울것.filter((x) => x.to === '기본형');
console.log(`\n■ 원자 세부트림 채우기 — 세운 차 ${docs.length - 안세움}대`);
console.log(`  이미 있음 ${이미있음} · 채울 것 ${채울것.length}(원문에서 고름 ${골라낸.length} · 기본형 ${기본형.length}) · 세부모델이 비어 손 안 댐 ${세부모델없음}`);

const 곳 = new Map<string, number>();
for (const x of 채울것) 곳.set(x.code, (곳.get(x.code) || 0) + 1);
if (곳.size) console.log(`  공급사별 — ${[...곳].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ')}`);
for (const x of 골라낸.slice(0, 6)) console.log(`     ${x.car.padEnd(11)} ${x.sub} → 「${x.to}」   원문「${x.raw.slice(0, 44)}」`);
for (const x of 기본형.slice(0, 4)) console.log(`     ${x.car.padEnd(11)} ${x.sub} → 「기본형」  원문「${x.raw.slice(0, 44)}」`);

/**
 * ★**한 번에 너무 많이 채우면 멈춘다** — 마스터가 깨졌을 때 재고 전체가 「기본형」으로 덮이는 걸 막는다.
 *   빈 칸만 채우는 일이라 되돌리기가 번거롭다(무엇이 원래 비었는지 뒤에 알 수 없다).
 */
if (채울것.length > Math.max(200, (docs.length - 안세움) * 0.5)) {
  console.error(`\n⛔ 한 번에 ${채울것.length}대를 채우려 한다 — 세운 차의 절반이 넘는다. 마스터부터 보라.\n`);
  process.exit(1);
}
if (!APPLY) { console.log(`\n미리보기 — 쓰려면 --apply\n`); process.exit(0); }
if (!채울것.length) { console.log(`\n✓ 채울 것 없음\n`); process.exit(0); }

let n = 0;
for (let i = 0; i < 채울것.length; i += 400) {
  const batch = fs.batch();
  for (const x of 채울것.slice(i, i + 400)) { batch.set(x.ref, { trim_name: x.to, _trim_healed_at: Date.now() }, { merge: true }); n++; }
  await batch.commit();
}
console.log(`\n✓ 원자 세부트림 ${n}대 채웠다 — 원문에서 고름 ${골라낸.length} · 기본형 ${기본형.length}\n`);
process.exit(0);
