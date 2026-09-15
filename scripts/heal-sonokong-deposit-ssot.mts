/**
 * 손오공(RP012) 「사라진 차」— 오늘 API 덤프에 없는 기존 원자 — 의 보증금을 SSOT 규칙(deposit_note
 * 글자 + price.deposit=0)으로 다시 맞춘다.
 *
 * 사장님 2026-09-15 「손오공꺼는 아직도 보증금 SSOT 적용 안 된거같음」로 발견 — 실측 292대 중 274대가
 * price[기간].deposit에 «계산된 숫자»(연수×대여료)가 그대로 남아 있었다. `ingest-supplier-to-firestore
 * --code=RP012 --apply`는 이미 deposit:0으로 정확히 짜여 있는데, 「오늘 덤프에 있는 차」만 다시 계산하고
 * 쓰기 때문에(사라진 차는 안 건드림 — 못 읽은 것과 없어진 것을 구별 못해서 의도된 동작), 그 전에
 * 옛 산식으로 박힌 값이 그대로 남는다. 재적용으로 274 → 21까지 줄었고, 남은 21대는 전부 픽업구독
 * (TCAR_EXTERNAL)이면서 오늘 덤프에 없는 차다.
 *
 * 이 스크립트는 그 빈틈을 메운다 — RP012 listable 전체를 재검사해 price.deposit>0 이 남아 있으면
 * deposit_note(`sonokongDepositRuleText`)를 채우고 그 기간의 deposit을 0으로 되돌린다. rent는 안 건드린다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/heal-sonokong-deposit-ssot.mts            드라이런
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/heal-sonokong-deposit-ssot.mts --apply    반영
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { sonokongDepositRuleText } from '../lib/domain/sales-published-tabs';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const docs = (await fs.collection('products').where('provider_company_code', '==', 'RP012').where('listable', '==', true).get()).docs;
type Fix = { id: string; car: string; price: Record<string, { rent: number; deposit: number }>; needsNote: boolean };
const fixes: Fix[] = [];
for (const d of docs) {
  const v = d.data() as Record<string, unknown>;
  const price = (v.price && typeof v.price === 'object') ? { ...(v.price as Record<string, { rent: number; deposit: number }>) } : null;
  if (!price) continue;
  let changed = false;
  for (const [p, t] of Object.entries(price)) {
    const dep = Number(t?.deposit);
    if (dep > 0) { price[p] = { ...t, deposit: 0 }; changed = true; }
  }
  if (changed) fixes.push({ id: d.id, car: S(v.car_number), price, needsNote: !S(v.deposit_note) });
}

console.log(`손오공 보증금 SSOT — 정정할 차 ${fixes.length}대 (deposit_note 새로 채울 차 ${fixes.filter((f) => f.needsNote).length})`);
for (const f of fixes) console.log(`  ${f.car}${f.needsNote ? ' (deposit_note 없음)' : ''}`);
if (!fixes.length) { console.log('✓ 전부 SSOT(price.deposit=0) 일치.'); process.exit(0); }
if (!APPLY) { console.log('\n미리보기 — 반영하려면 --apply'); process.exit(0); }

let w = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) {
    batch.update(fs.collection('products').doc(f.id), {
      price: f.price,
      deposit_note: sonokongDepositRuleText(),
      _sono_dep_ruled_at: Date.now(),
    });
    w++;
  }
  await batch.commit();
}
console.log(`\n반영 완료 — ${w}대 보증금을 SSOT(deposit_note 글자 + price.deposit=0)로 바로잡았다.`);
process.exit(0);
