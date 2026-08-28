// v4/policies 표준화 후보 필드의 공급사별 분포 — 통일할 것 찾기. 읽기만.
import { readFileSync } from 'node:fs';
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';
for (const f of ['.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)) { const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l); if(!m)continue; const v=m[2].replace(/^["']|["']$/g,''); if(v&&!process.env[m[1]])process.env[m[1]]=v; } } catch {} }
const { firebaseAdminDatabase } = await import('../lib/server/firebase-admin');
const pols: Record<string, any> = (await firebaseAdminDatabase().ref('v4/policies').get()).val() || {};
const list = Object.values(pols);
const S = (v: unknown) => String(v ?? '').trim();
console.log(`v4/policies ${list.length}개 · 공통정책 ${list.filter(p=>p.is_freepass_common_policy).length}개\n`);
const FIELDS: [string, string][] = [
  ['annual_mileage','연주행'],['basic_driver_age','기본연령'],['driver_age_upper_limit','최대연령'],['driver_age_lowering','연령하향'],['age_lowering_cost','연령하향료'],
  ['license_period','면허기간'],['personal_driver_scope','개인운전범위'],['additional_driver_allowance_count','추가운전인원'],['additional_driver_cost','추가운전료'],
  ['over_mileage_rate_domestic','추가주행(국산)'],['over_mileage_rate_imported','추가주행(수입)'],['mileage_upcharge_per_10000km','만km당'],
  ['annual_roadside_assistance','긴급출동'],['maintenance_service','정비'],['insurance_included','보험포함'],
  ['injury_compensation_limit','대인한도'],['property_compensation_limit','대물한도'],['own_damage_compensation','자차한도'],['self_body_accident','자손'],['uninsured_damage','무보험'],
  ['injury_deductible','대인면책'],['property_deductible','대물면책'],['own_damage_min_deductible','자차최소면책'],['own_damage_max_deductible','자차최대면책'],
  ['deposit_installment','보증금분납'],['deposit_card_payment','보증금카드'],['succession_allowed','승계'],['succession_fee','승계료'],['delivery_fee','탁송비'],
  ['late_fee_rate','연체료율'],['engine_control_overdue_days','시동제어일'],['deposit_overdue_rounds','보증금연체회차'],['credit_grade','신용등급'],['payment_method','결제방식'],
  ['early_termination_rate_under1y','중도해지<1y'],['early_termination_rate_over1y','중도해지≥1y'],['screening_criteria','심사'],
];
const 갈림: string[] = [];
for (const [key, ko] of FIELDS) {
  const dist: Record<string, number> = {};
  for (const p of list) { const v = S(p[key]) || '(빈)'; dist[v] = (dist[v] || 0) + 1; }
  const e = Object.entries(dist).sort((a,b)=>b[1]-a[1]);
  const nonEmpty = e.filter(x=>x[0]!=='(빈)');
  const mark = nonEmpty.length <= 1 ? '✓통일' : nonEmpty.length <= 3 ? '△소수갈림' : '✗제각각';
  if (nonEmpty.length > 1) 갈림.push(ko);
  console.log(`${mark} ${ko.padEnd(11)}: ${e.slice(0,5).map(([v,n])=>`${v}(${n})`).join(' · ')}${e.length>5?` …+${e.length-5}`:''}`);
}
console.log(`\n갈리는 필드(${갈림.length}): ${갈림.join(', ')}`);
process.exit(0);
