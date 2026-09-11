/**
 * 정책 금액 단위표기 통일 — «N만원» (사장님 2026-09-11 「50만원 · 원자를 바꾸자」).
 *
 * 같은 필드인데 어떤 정책은 «50만원»(글자)·어떤 정책은 500000(숫자)·"500000"(숫자글자)로 섞여 있었다.
 * 정본 철자는 «만원 글자»다 — policy-defaults·공급사템플릿·문서가 다 «만원». 숫자는 옛 입력의 잔재다.
 * ⇒ 숫자/숫자글자로 든 «만원 단위 금액»을 «N만원» 글자로 통일한다.
 *
 * ★안전: 계산은 parseMoneyOrRate 가 숫자·글자를 «같은 값»으로 읽는다(100000 = 「10만원」). 굳히기 안 깨짐.
 *   변환은 «10000의 양의 배수»일 때만 — 반올림 없음(손님 정책 넷 규격 「반올림 금지」 준수). 그 외(협의·없음·대여료의10%·%)는 그대로.
 *
 * 기본 = 미리보기. --apply 로만 쓴다.
 * 실행: FIREBASE_SERVICE_ACCOUNT_JSON=tmp/firebase-auth/freepasserp5-sa.json \
 *        npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/heal-policy-money-unit.mts [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

// 단위 섞인 «만원 단위 금액» 필드만 (rate·개월수·일수·비율 필드는 손대지 않는다).
const MONEY_FIELDS = [
  'additional_driver_cost', 'age_lowering_cost', 'injury_deductible', 'mileage_upcharge_per_10000km',
  'own_damage_max_deductible', 'own_damage_min_deductible', 'property_deductible', 'self_body_deductible', 'succession_fee',
];

/** 숫자 또는 순수숫자글자이고 «10000의 양의 배수»면 «N만원» 글자로. 아니면 null(안 건드림). */
function toManwon(value: unknown): string | null {
  let n: number | null = null;
  if (typeof value === 'number') n = value;
  else { const s = S(value); if (/^\d+$/.test(s)) n = Number(s); }   // "500000" 같은 순수숫자글자만
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  if (n % 10000 !== 0) return null;         // 만 단위로 안 떨어지면 반올림 없이 보류(사람 검수)
  return `${n / 10000}만원`;
}

const keyPath = S(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) || 'tmp/firebase-auth/freepasserp5-sa.json';
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const db = getFirestore();

const snap = await db.collection('policy').get();
const changes: { id: string; updates: Record<string, string>; detail: string[] }[] = [];
const skipped: string[] = [];   // 만 단위 아님 → 보류
let fieldHits = 0;

for (const doc of snap.docs) {
  const v = doc.data() as Record<string, unknown>;
  const updates: Record<string, string> = {};
  const detail: string[] = [];
  for (const f of MONEY_FIELDS) {
    const cur = v[f];
    if (cur == null || cur === '') continue;
    if (typeof cur === 'string' && !/^\d+$/.test(cur.trim())) continue;   // 이미 글자(만원·협의·없음 등) → 통과
    const man = toManwon(cur);
    if (man === null) { if (typeof cur === 'number' || /^\d+$/.test(S(cur))) skipped.push(`${doc.id}.${f}=${cur}`); continue; }
    if (man === S(cur)) continue;
    updates[f] = man; detail.push(`${f}: ${cur} → ${man}`); fieldHits++;
  }
  if (Object.keys(updates).length) changes.push({ id: doc.id, updates, detail });
}

console.log(`policy ${snap.size} · 통일할 정책 ${changes.length}건 · 필드 ${fieldHits}개`);
for (const c of changes.slice(0, 18)) console.log(`  ${c.id}: ${c.detail.join(' · ')}`);
if (changes.length > 18) console.log(`  … 외 ${changes.length - 18}건`);
if (skipped.length) console.log(`\n⚠ 만 단위 아님 → 보류(사람 검수): ${skipped.join(' · ')}`);

if (!APPLY) { console.log('\n미리보기 — 안 씀. --apply 로 반영.'); process.exit(0); }

let w = 0;
for (let i = 0; i < changes.length; i += 400) {
  const batch = db.batch();
  for (const c of changes.slice(i, i + 400)) { batch.set(db.collection('policy').doc(c.id), { ...c.updates, _money_unit_healed_at: Date.now() }, { merge: true }); w++; }
  await batch.commit();
}
console.log(`\n반영 완료 — 정책 ${w}건 금액 «만원» 통일(반올림 없음, 계산 무영향).`);
process.exit(0);
