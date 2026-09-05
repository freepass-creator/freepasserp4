import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import glob from 'node:fs';
const sa=JSON.parse(readFileSync('tmp/firebase-auth/sa.json','utf8'));
if(!getApps().length)initializeApp({credential:cert({projectId:sa.project_id,clientEmail:sa.client_email,privateKey:sa.private_key.replace(/\n/g,'\n')})});
const FS=getFirestore();
const APPLY=process.argv.includes('--apply');
const S=v=>String(v??'').trim();
const N=s=>S(s).toLowerCase().replace(/[\s()·\-]/g,'');
// 슬러그 → 한글 모델명(sub_model 에 포함되는지로 모델 매칭)
const SLUG2KO={avante:'아반떼',sonata:'쏘나타',grandeur:'그랜저',tucson:'투싼',santafe:'싼타페',kona:'코나',palisade:'팰리세이드',venue:'베뉴',staria:'스타리아',ioniq5:'아이오닉 5',ioniq6:'아이오닉 6',ioniq9:'아이오닉 9',nexo:'넥쏘'};
// 옵션 JSON 로드
import { readdirSync } from 'node:fs';
const files=readdirSync('tmp/newcar-pdf').filter(f=>/^hy_.*\.opt\.json$/.test(f));
const tables=[]; // {ko, fuel, trim, options}
for(const f of files){
  const d=JSON.parse(readFileSync(`tmp/newcar-pdf/${f}`,'utf8'));
  const base=d.model.replace(/-hybrid$|-ev$/,'');
  const ko=SLUG2KO[base]||SLUG2KO[d.model]; if(!ko)continue;
  for(const t of d.trims) tables.push({ko,fuel:t.fuel,trim:t.trim,options:t.options});
}
// 현대 Firestore 트림에 매칭
const snap=await FS.collection('new_car_trim').where('maker','==','현대').get();
let hit=0,cells=0; const batch=FS.batch(); let n=0;
for(const doc of snap.docs){
  const v=doc.data();
  const cands=tables.filter(tb=>N(v.sub_model).includes(N(tb.ko)) && N(tb.trim)===N(v.trim));
  // 연료 일치 우선, 없으면 트림만
  let pick=cands.find(tb=>tb.fuel&&N(v.fuel).includes(N(tb.fuel)))||cands[0];
  if(!pick||!pick.options.length)continue;
  hit++; cells+=pick.options.length;
  if(APPLY){batch.update(doc.ref,{options:pick.options});if(++n%400===0){await batch.commit();}}
}
if(APPLY&&n%400!==0)await batch.commit();
console.log(`현대 트림 ${snap.size} · 옵션매칭 ${hit}트림 · ${cells}셀 ${APPLY?'✓적재':'(드라이런)'}`);
// 샘플
const s=snap.docs.find(d=>/그랜저/.test(d.data().sub_model)&&/캘리그래피/.test(d.data().trim));
if(s){const c=tables.filter(tb=>N(s.data().sub_model).includes(N(tb.ko))&&N(tb.trim)===N(s.data().trim))[0];
  if(c)console.log('샘플 그랜저 캘리그래피:',c.options.slice(0,4).map(o=>`${o.name} ${o.price.toLocaleString()}`).join(' · '));}
