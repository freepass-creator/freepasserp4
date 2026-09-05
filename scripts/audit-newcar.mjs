import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
const sa=JSON.parse(readFileSync('tmp/firebase-auth/sa.json','utf8'));
if(!getApps().length)initializeApp({credential:cert({projectId:sa.project_id,clientEmail:sa.client_email,privateKey:sa.private_key.replace(/\n/g,'\n')})});
const FS=getFirestore();const S=v=>String(v??'').trim();
const num=v=>typeof v==='number'&&Number.isFinite(v);
const all=(await FS.collection('new_car_trim').get()).docs.map(d=>({id:d.id,...d.data()}));
console.log('신차마스터',all.length,'· 제조사',[...new Set(all.map(x=>x.maker))].join(' '));
const bad=[];
// 0) 빈 컬렉션은 «인증 통과»가 아니라 실패(Codex — 빈 것도 이상0으로 통과하던 것)
if(all.length<100)bad.push(`컬렉션 비었거나 급감: ${all.length}건(정상 400+)`);
for(const t of all){
  const pb=t.priceBefore,pa=t.priceAfter;
  const base=Array.isArray(t.basePrices)&&t.basePrices.length?t.basePrices:[pb];
  // 1) 가격 «숫자 아님»·이상: 900만 미만 or 3억 초과
  if(!num(pb)||pb<9_000_000||pb>300_000_000)bad.push(`가격이상 ${t.maker} ${t.sub_model} ${t.trim}=${pb}`);
  // 2) 세제후 «숫자 아님»·역전·음수
  if(!num(pa)||pa<0)bad.push(`세제후이상 ${t.maker} ${t.sub_model} ${t.trim}=${pa}`);
  else if(num(pb)&&pa>pb)bad.push(`역전 ${t.maker} ${t.sub_model} ${t.trim} 전${pb}<후${pa}`);
  // 3) 기본가 변형 «숫자 아님»·이상
  for(const b of base)if(!num(b)||b<10_000_000||b>300_000_000)bad.push(`기본가이상 ${t.maker} ${t.sub_model}=${b}`);
  // 4) 옵션: 가격 숫자 아님·음수·5천만 초과, 이름 빔
  for(const o of (t.options||[])){
    if(!num(o.price)||o.price<0||o.price>50_000_000)bad.push(`옵션가이상 ${t.maker} ${t.sub_model} ${o.name}=${o.price}`);
    if(!S(o.name))bad.push(`옵션명빔 ${t.maker} ${t.sub_model} =${o.price}`);
  }
  // 5) 트림명 연료 잔류
  if(/\b(hybrid|electric)\b/i.test(S(t.trim)))bad.push(`트림연료잔류 ${t.maker} ${t.trim}`);
  // 6) 식별·출처·수집일 빔
  if(!S(t.maker)||!S(t.sub_model))bad.push(`식별빔 ${t.id}`);
  if(!S(t.crawledAt))bad.push(`수집일빔 ${t.maker} ${t.sub_model} ${t.trim}`);
}
// 근사중복(같은 모델·연료·트림·가격이 여러 문서) — saleModelCode 다르면 실구성(스타리아 9/11인승)이라 «경고»만.
const seen=new Map();
for(const t of all){const k=`${t.maker}|${t.sub_model}|${t.fuel}|${t.trim}|${t.priceBefore}`;(seen.get(k)||seen.set(k,[]).get(k)).push(t.id);}
const warns=[];for(const [k,ids] of seen)if(ids.length>1)warns.push(`근사중복 ${ids.length}× ${k} (문서 ${ids.join(',')})`);
// 옵션 커버리지
const wo=all.filter(t=>(t.options||[]).length);
console.log('\n실오류',bad.length,'건 · 경고(근사중복)',warns.length,'건');
bad.slice(0,25).forEach(b=>console.log('  ✗ '+b));
warns.slice(0,5).forEach(w=>console.log('  ⚠ '+w));
console.log('\n옵션있는트림',wo.length,'/',all.length,'· 옵션셀',all.reduce((s,t)=>s+(t.options||[]).length,0));
console.log(bad.length===0?'\n✅ 견적기 피드 데이터 인증 — 이상 0':'\n⚠ 위 이상 확인 필요');
// ★배포 게이트로 쓸 수 있게 이상 있으면 exit 1(Codex — 종료코드가 늘 0이라 게이트 불가였다)
process.exit(bad.length===0?0:1);
