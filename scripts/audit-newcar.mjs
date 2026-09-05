import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
const sa=JSON.parse(readFileSync('tmp/firebase-auth/sa.json','utf8'));
if(!getApps().length)initializeApp({credential:cert({projectId:sa.project_id,clientEmail:sa.client_email,privateKey:sa.private_key.replace(/\n/g,'\n')})});
const FS=getFirestore();const S=v=>String(v??'').trim();
const all=(await FS.collection('new_car_trim').get()).docs.map(d=>({id:d.id,...d.data()}));
console.log('신차마스터',all.length,'· 제조사',[...new Set(all.map(x=>x.maker))].join(' '));
const bad=[];
for(const t of all){
  const pb=Number(t.priceBefore||0),pa=Number(t.priceAfter||0);
  const base=Array.isArray(t.basePrices)&&t.basePrices.length?t.basePrices:[pb];
  // 1) 가격 이상: 500만 미만 or 3억 초과
  if(!pb||pb<9_000_000||pb>300_000_000)bad.push(`가격이상 ${t.maker} ${t.sub_model} ${t.trim}=${pb}`);
  // 2) 세제후>전 역전
  if(pa&&pb&&pa>pb)bad.push(`역전 ${t.maker} ${t.sub_model} ${t.trim} 전${pb}<후${pa}`);
  // 3) 제네시스 기본가 변형 이상
  for(const b of base)if(b<10_000_000||b>300_000_000)bad.push(`기본가이상 ${t.maker} ${t.sub_model}=${b}`);
  // 4) 옵션 가격 이상(음수·5천만 초과)
  for(const o of (t.options||[]))if(o.price<0||o.price>50_000_000)bad.push(`옵션이상 ${t.maker} ${t.sub_model} ${o.name}=${o.price}`);
  // 5) 트림명에 연료어 잔류
  if(/\b(hybrid|electric)\b/i.test(S(t.trim)))bad.push(`트림연료잔류 ${t.maker} ${t.trim}`);
  // 6) sub_model 비었거나 maker 비었으면
  if(!S(t.maker)||!S(t.sub_model))bad.push(`식별비었음 ${t.id}`);
}
// 중복(같은 maker+sub_model+fuel+trim+priceBefore 2개↑)
const seen=new Map();
for(const t of all){const k=`${t.maker}|${t.sub_model}|${t.fuel}|${t.trim}|${t.priceBefore}|${t.options?.length||0}`;seen.set(k,(seen.get(k)||0)+1);}
let dups=0;for(const [k,v] of seen)if(v>1){dups++;if(dups<=5)bad.push(`중복 ${v}× ${k}`);}
// 옵션 커버리지
const wo=all.filter(t=>(t.options||[]).length);
console.log('\n이상',bad.length,'건'+(dups>5?` (중복 ${dups}종 중 5개만 표시)`:''));
bad.slice(0,25).forEach(b=>console.log('  ✗ '+b));
console.log('\n옵션있는트림',wo.length,'/',all.length,'· 옵션셀',all.reduce((s,t)=>s+(t.options||[]).length,0));
console.log(bad.length===0?'\n✅ 견적기 피드 데이터 인증 — 이상 0':'\n⚠ 위 이상 확인 필요');
process.exit(0);
