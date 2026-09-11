/**
 * 정책 금액 «한글 단위» 통일 2단계 (사장님 2026-09-11).
 * 1단계(heal-policy-money-unit)는 원단위 숫자(500000)→「50만원」만 했다. 이제 «표기 스타일»까지 통일:
 *   「1,500만원」→「1500만원」 · 「5,000만원」→「5천만원」 · 「1.5억원」→「1억5천만원」 ·
 *   「차량가 기준」→「차량가액」 · 「0만원/0%」→「없음」(면책·보상) / 「무료」(추가운전).
 * 손님 상세(ShopDetail)가 이 값을 «그대로» 보여준다 — 원자 스타일이 곧 화면이다.
 *
 * 원 → 한글: <1억은 만배수면 「N천만원」(N천의 배수)·아니면 「N만원」 · ≥1억은 「X억[Y천만/Y만]원」.
 * 기본 = 미리보기. --apply.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { parseMoneyOrRate, wonLabel } from '../lib/domain/policy-money-rate';
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

// 값을 캐논으로. 순수금액이면 wonLabel(정본 포매터·1천만 미만 숫자/이상 한글), 「월/1인당」 접두 보존, 특수문구 표준화, 그 외 유지.
function canon(raw: string, zeroText: string): string {
  const t = S(raw); if (!t) return t;
  if (/^차량가\s*기준$/.test(t)) return '차량가액';
  const pre = t.match(/^(월|1인당|월\s*1인당)\s+/); const body = pre ? t.slice(pre[0].length) : t;
  const p = parseMoneyOrRate(body);
  if (p.kind === 'won') { if (p.won === 0) return zeroText; const k = wonLabel(p.won); return pre ? `${pre[1]} ${k}` : k; }
  if (p.kind === 'none') return zeroText;                 // 0원·0%·없음·무료
  return t;                                                // rate·개월분·무한·차량가액·서술형 등 유지
}

const sa = JSON.parse(readFileSync('tmp/firebase-auth/freepasserp5-sa.json','utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\n/g,'\n') }) });
const db = getFirestore();
// 필드 → 0일 때 표현
const DED = '없음', FREE = '무료';
const FIELDS: Record<string,string> = {
  additional_driver_cost: FREE, age_lowering_cost: DED, mileage_upcharge_per_10000km: DED,
  injury_deductible: DED, property_deductible: DED, self_body_deductible: DED,
  own_damage_min_deductible: DED, own_damage_max_deductible: DED, succession_fee: DED,
  injury_compensation_limit: DED, property_compensation_limit: DED, own_damage_compensation: DED,
  self_body_accident: DED, uninsured_damage: DED, uninsured_deductible: DED,
};
const snap = await db.collection('policy').get();
const changes: { id: string; d: string[]; u: Record<string,string> }[] = [];
for (const doc of snap.docs) { const v = doc.data() as Record<string,unknown>; const u: Record<string,string> = {}; const d: string[] = [];
  for (const [f, zero] of Object.entries(FIELDS)) { const cur = v[f]; if (cur == null || cur === '') continue;
    const nv = canon(S(cur), zero);
    if (nv !== S(cur)) { u[f] = nv; d.push(`${f}: «${S(cur)}»→«${nv}»`); } }
  if (Object.keys(u).length) changes.push({ id: doc.id, d, u });
}
const agg: Record<string,number> = {};
for (const c of changes) for (const s of c.d) { const k = s.split(':')[0] + ' ' + s.split('»→«')[0].split('«')[1] + '→' + s.split('»→«')[1].replace('»',''); agg[k]=(agg[k]||0)+1; }
console.log(`정책 ${snap.size} · 스타일통일 대상 ${changes.length}건`);
console.log('── 변환 집계 ──'); for (const [k,n] of Object.entries(agg).sort((a,b)=>b[1]-a[1])) console.log(`  ${k} ×${n}`);
if (!APPLY) { console.log('\n미리보기 — --apply'); process.exit(0); }
let w=0; for (let i=0;i<changes.length;i+=400){const b=db.batch();for(const c of changes.slice(i,i+400)){b.set(db.collection('policy').doc(c.id),{...c.u,_money_kr_healed_at:Date.now()},{merge:true});w++;}await b.commit();}
console.log(`\n반영 완료 — ${w}건`); process.exit(0);
