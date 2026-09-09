/**
 * **상태를 «한 벌»로 아문다 — `vehicle_status` 가 정본.** 기본 미리보기 · 반영은 `--apply`.
 *
 * ⚠ 2026-09-08 실측 — 원자 한 문서가 `status` 와 `vehicle_status` 를 **다른 값으로** 들고 있었다(33대).
 *   판매시트·문지기는 `vehicle_status` 를, ERP 일부는 `status` 를 읽는다. 그래서
 *   `102우8511` 은 한쪽에서 「계약중」, 다른 쪽에서 「출고불가」였다 — **판 차가 목록에 다시 설 수 있는 꼴.**
 *   그 위에 `vehicle_status` 가 아예 빈 차가 116대 있었다(직접수집이 `status` 만 썼던 흔적).
 *
 * ★규칙 둘 — 지어내지 않는다.
 * ```
 * ① 한쪽만 있다      → 있는 값을 양쪽에 (모르는 것을 만들지 않는다)
 * ② 둘이 다르다      → «잠그는 쪽»이 이긴다  출고불가 > 계약중 > 나머지
 *                      판 차가 다시 서는 것보다, 팔 수 있는 차가 하루 숨는 게 낫다
 *                      ⚠ 잠금이 안 낀 불일치는 «안 고치고 알린다» — 원천이 답이지 이 스크립트가 아니다
 * ```
 * 규칙 SSOT = `docs/원자-내려보내기-로직.md` §1.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/heal-atom-status.mts [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nextEnv from '@next/env';
import { resolveStatus } from '../lib/domain/atom-status';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\n/g, '\n') }) });
const fs = getFirestore();

/** 잠그는 순서 — 앞일수록 세다. 여기 없는 값끼리 다르면 손대지 않는다. */
const LOCK = ['출고불가', '계약중'];
const 세기 = (v: string) => { const i = LOCK.indexOf(v); return i < 0 ? LOCK.length : i; };
/** `vehicle_status` 에서 파생되는 것들 — 판정은 «한 곳»(atom-status resolveStatus). 여기선 상태만 넘긴다.
 *  ★status_label_raw·status_reason 은 «안 덮는다» — 원천 표기를 지우지 않으려고 골라 쓴다(merge). */
const derive = (st: string) => {
  const b = resolveStatus({ base: st });
  return { status: b.status, vehicle_status: b.vehicle_status, status_kind: b.status_kind, listable: b.listable };
};

const docs = (await fs.collection('products').get()).docs;
const 채움: { ref: FirebaseFirestore.DocumentReference; car: string; to: string; why: string }[] = [];
const 손안댐: string[] = [];
for (const d of docs) {
  const v = d.data() as any;
  const a = S(v.status), b = S(v.vehicle_status);
  const car = S(v.car_number) || d.id;
  // ★★정산원장에 계약이 올라간 차(locked)는 «맨 먼저 확인» — 상태가 계약상태여야 한다(사장님 2026-09-09).
  //   status·vehicle_status 가 둘 다 «가용»으로 clobber 됐어도(레이스·옛 버그) 여기서 잡는다 = heal 이 판 차를 되살리지 않는다.
  //   완료(어느 한쪽이 출고불가)면 숨기고, 아니면 계약중(선점). ⚠ 취소는 정산이 락을 «푼다» — 그때 locked 가 비어 아래 원천흐름으로.
  if (S(v.locked_by_contract)) {
    const desired = (a === '출고불가' || b === '출고불가') ? '출고불가' : '계약중';
    if (a !== desired || b !== desired) 채움.push({ ref: d.ref, car, to: desired, why: `정산원장 계약(${a || '∅'} ↔ ${b || '∅'})` });
    continue;
  }
  if (a === b && a) continue;
  if (!a && !b) continue;                                   // 둘 다 없다 — 원천이 채울 몫
  if (!a || !b) { 채움.push({ ref: d.ref, car, to: a || b, why: '한쪽만 있음' }); continue; }
  const 잠금 = Math.min(세기(a), 세기(b));
  if (잠금 === LOCK.length) { 손안댐.push(`${car}  ${a} ↔ ${b}`); continue; }   // 잠금 없는 불일치 — 원천이 답
  채움.push({ ref: d.ref, car, to: LOCK[잠금], why: `잠금 우선(${a} ↔ ${b})` });
}

console.log(`\n원자 ${docs.length} · 아물릴 것 ${채움.length} · 손 안 대고 알릴 것 ${손안댐.length}\n`);
for (const x of 채움.slice(0, 20)) console.log(`  ${x.car.padEnd(11)} → ${x.to.padEnd(6)} ${x.why}`);
if (채움.length > 20) console.log(`  … 그 밖 ${채움.length - 20}대`);
if (손안댐.length) { console.log(`\n  ▲ 잠금이 안 낀 불일치 — 원천을 봐야 한다(여기서 안 고친다):`); for (const x of 손안댐.slice(0, 15)) console.log(`     ${x}`); }
if (!채움.length) { console.log('\n✓ 상태가 이미 한 벌이다.\n'); process.exit(0); }
if (!APPLY) { console.log(`\n미리보기 — 쓰려면 --apply\n`); process.exit(0); }
let n = 0;
for (let i = 0; i < 채움.length; i += 400) {
  const batch = fs.batch();
  for (const x of 채움.slice(i, i + 400)) { batch.set(x.ref, { ...derive(x.to), _status_healed_at: Date.now() }, { merge: true }); n++; }
  await batch.commit();
}
console.log(`\n✓ ${n}대 상태를 한 벌로 아물렀다.\n`);
process.exit(0);
