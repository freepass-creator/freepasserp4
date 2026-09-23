/**
 * **손오공 구독/픽업 보증금을 규칙 글자로 되돌린다.** 중고렌트는 ERP 보증금 숫자를 보존하고 과거 규칙 글자만 지운다.
 * 기본 미리보기, 반영은 `--apply`.
 *
 * ★사장님 2026-09-17 「손오공 보증금 ssot에 제대로 반영 안된거 같음」 · 「규칙 글자로」.
 *
 * ★무엇이 어긋나 있었나(실측 2026-09-17) — RP012 listable 258대 **전부**가
 *   `deposit_note`(「월 대여료 × 약정연수 (최대 3개월)」)는 갖고 있는데 `price[기간].deposit` 에
 *   계산된 숫자도 그대로 남아 있었다. 판매시트는 보증금 칸이 «빌 때만» 규칙 글자를 쓰므로
 *   (`sales-atom-row.ts`) 그 글자가 **한 번도 안 보였다.** 규칙이 두 번 바뀌며 절반만 반영된 자리다.
 *   ⇒ 인제스터는 이제 `deposit: 0` 으로 넣는다(같은 회차 수정). 이 도구는 **이미 박힌 숫자**를 지운다.
 *
 * ⚠ `rent` 는 건드리지 않는다 — 대여료는 원천 값이다. 보증금 «숫자»만 0 으로 눕힌다.
 * ⚠ 줄을 지우지 않는다. 칸 값만 고친다.
 *
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs --require ./scripts/lib/server-only-shim.cjs scripts/heal-sonokong-deposit-ssot.mts
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs --require ./scripts/lib/server-only-shim.cjs scripts/heal-sonokong-deposit-ssot.mts --apply
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { erp5InventoryAppOptions } from '../lib/server/erp5-inventory-service-account';
import { sonokongDepositRuleText } from '../lib/domain/sales-published-tabs';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const RULE = sonokongDepositRuleText();

initializeApp(erp5InventoryAppOptions());
const fs = getFirestore();

/** listable 만 보지 않는다 — 출고불가 차도 원자 값은 규격대로여야 한다(다시 서는 날 그대로 나간다). */
const docs = (await fs.collection('products').where('provider_company_code', '==', 'RP012').get()).docs;

type Fix = { id: string; car: string; rental: boolean; price: Record<string, { rent: number; deposit: number }>; 숫자칸: number; note고침: boolean };
const fixes: Fix[] = [];
for (const d of docs) {
  const v = d.data() as Record<string, unknown>;
  const cls = v.sonokong_classification as { product_type?: unknown } | undefined;
  const rental = S(cls?.product_type || v.product_type) === '중고렌트';
  const price = (v.price && typeof v.price === 'object')
    ? { ...(v.price as Record<string, { rent: number; deposit: number }>) } : null;
  const note고침 = rental ? S(v.deposit_note) === RULE : S(v.deposit_note) !== RULE;
  if (!price) { if (note고침) fixes.push({ id: d.id, car: S(v.car_number), rental, price: {}, 숫자칸: 0, note고침 }); continue; }
  let 숫자칸 = 0;
  if (!rental) for (const [p, t] of Object.entries(price)) {
    if (Number(t?.deposit) > 0) { price[p] = { ...t, deposit: 0 }; 숫자칸++; }
  }
  if (숫자칸 || note고침) fixes.push({ id: d.id, car: S(v.car_number), rental, price, 숫자칸, note고침 });
}

console.log(`■ 손오공 보증금 SSOT — RP012 ${docs.length}대 중 고칠 차 ${fixes.length}대`);
console.log(`  구독/픽업 숫자 제거 ${fixes.filter((f) => f.숫자칸).length}대 · 규칙 글자 정리 ${fixes.filter((f) => f.note고침).length}대`);
console.log(`  규칙 글자 정본: 「${RULE}」`);
for (const f of fixes.slice(0, 6)) console.log(`   · ${f.car} ${f.rental ? '중고렌트 ERP 숫자 보존' : `구독 숫자칸 ${f.숫자칸}`}${f.note고침 ? ' · 글자 정리' : ''}`);
if (fixes.length > 6) console.log(`   … 그 밖 ${fixes.length - 6}대`);

if (!fixes.length) { console.log('\n✓ 전부 규격대로 — 중고렌트 ERP 숫자 보존 · 구독/픽업 규칙 글자 일치.'); process.exit(0); }
if (!APPLY) { console.log('\n미리보기 — 반영하려면 --apply'); process.exit(0); }

let n = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) {
    batch.set(fs.collection('products').doc(f.id), {
      ...(f.숫자칸 ? { price: f.price } : null),
      deposit_note: f.rental ? FieldValue.delete() : RULE,
      _sono_dep_ruled_at: Date.now(),
    }, { merge: true });
    n++;
  }
  await batch.commit();
}
console.log(`\n반영 완료 — ${n}대. 중고렌트 ERP 보증금은 보존하고 구독/픽업 규칙 글자를 맞췄다(rent 는 안 건드림).`);
console.log('  ※ 시트까지 가려면 판매시트를 다시 발행한다.');
process.exit(0);
