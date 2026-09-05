import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
const sa=JSON.parse(readFileSync('tmp/firebase-auth/sa.json','utf8'));
if(!getApps().length)initializeApp({credential:cert({projectId:sa.project_id,clientEmail:sa.client_email,privateKey:sa.private_key.replace(/\n/g,'\n')})});
const FS=getFirestore();const APPLY=process.argv.includes('--apply');
const day=new Date().toISOString().slice(0,10);
const models=['g70','g80','g80-ev','g90','gv60','gv70','gv70-ev','gv80'];
// ★먼저 «전 파일 읽고 검증»한 뒤에 삭제·적재한다(Codex: 검증 전 삭제하면 파일 누락 시 제네시스가 빈다).
const docs=[];let tot=0;
for(const m of models){
  const d=JSON.parse(readFileSync(`tmp/gen-${m}.json`,'utf8'));
  const base=d.basePrices.filter(p=>p>=20000000).sort((a,b)=>a-b);
  const opts=d.options.map(o=>({name:o.name,price:o.price,group:o.group}));
  if(!base.length){console.error(`✗ ${m} 기본가 0 — 추출 실패, 중단(삭제 안 함)`);process.exit(1);}
  docs.push({id:`genesis_${m}`,doc:{maker:'제네시스',carType:m.toUpperCase().replace('-EV',' 전기'),sub_model:m.toUpperCase(),fuel:/ev/.test(m)?'전기':'가솔린',
    priceBefore:base[0],priceAfter:base[0],basePrices:base,options:opts,
    optionGroups:{필수:opts.filter(o=>o.group==='필수').length,선택:opts.filter(o=>o.group==='선택').length},
    brandSource:'genesis PDF',crawledAt:day}});
  tot+=opts.length;
  console.log(`  ${m.toUpperCase().padEnd(9)} 기본가 ${base.length}변형(${(base[0]/10000).toFixed(0)}만~${(base[base.length-1]/10000).toFixed(0)}만) · 옵션 ${opts.length}`);
}
if(APPLY){
  // 8모델 전부 검증됨 → 그제서야 삭제·적재
  const old=await FS.collection('new_car_trim').where('maker','==','제네시스').get();const b=FS.batch();old.docs.forEach(d=>b.delete(d.ref));await b.commit();
  const batch=FS.batch();docs.forEach(x=>batch.set(FS.collection('new_car_trim').doc(x.id),x.doc));await batch.commit();
  console.log(`기존 삭제 ${old.size} → ✓적재 ${docs.length}모델 · 옵션 ${tot}`);
}else console.log('(드라이런)');
