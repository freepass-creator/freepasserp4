import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import glob from 'node:fs';
const sa=JSON.parse(readFileSync('tmp/firebase-auth/sa.json','utf8'));
if(!getApps().length)initializeApp({credential:cert({projectId:sa.project_id,clientEmail:sa.client_email,privateKey:sa.private_key.replace(/\n/g,'\n')})});
const FS=getFirestore();
const APPLY=process.argv.includes('--apply');
const S=v=>String(v??'').trim();
// 트림 정규화 — 배터리·휠 꼬리(「(스탠다드) 18인치」) 제거 + 영문→한글 매핑, 그 뒤 소문자·기호제거.
const EN2KO={modern:'모던',smart:'스마트',premium:'프리미엄',inspiration:'인스퍼레이션',exclusive:'익스클루시브',calligraphy:'캘리그래피',prestige:'프레스티지','e-lite':'이라이트',elite:'이라이트','e-value':'이밸류',evalue:'이밸류','le blanc':'르블랑',leblanc:'르블랑'};
const canon=s=>{ let x=S(s).replace(/\((스탠다드|롱레인지|standard|long ?range)\)/gi,' ').replace(/\d+인치|\d+"?inch/gi,' ').replace(/\+/g,' ').replace(/\s+/g,' ').trim(); const lc=x.toLowerCase(); if(EN2KO[lc])x=EN2KO[lc]; return x; };
const N=s=>{ const c=canon(s); const lc=c.toLowerCase(); return (EN2KO[lc]||c).toLowerCase().replace(/[\s()·\-]/g,''); };
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
  // ★연료 정규화(LPi=LPG·배기량 뗌) + «연료 안 맞으면 아무거나 붙이지 않는다»(Codex 오부착 수정).
  //   연료매칭 실패 시: 후보가 단 하나(모호 없음)면 쓰고, 여럿이면 «틀린 연료 부착 대신 건너뛴다».
  const fuelN=x=>N(x).replace(/\d+\.?\d*/g,'').replace(/lpi/g,'lpg').replace(/일렉트릭|이브이/g,'전기');
  const fm=cands.filter(tb=>tb.fuel&&fuelN(v.fuel)&&fuelN(tb.fuel).includes(fuelN(v.fuel)));
  let pick=fm[0] || (cands.length===1?cands[0]:null);
  const opts=(pick&&pick.options.length)?pick.options:[];
  if(opts.length){hit++;cells+=opts.length;}
  // ★매칭 안 되면 옵션을 «비운다» — 이전 오부착 잔존 방지(안 비우면 옛 옵션이 남는다).
  if(APPLY){ if(opts.length||(Array.isArray(v.options)&&v.options.length)){ batch.update(doc.ref,{options:opts}); if(++n%400===0){await batch.commit();} } }
}
if(APPLY&&n%400!==0)await batch.commit();
console.log(`현대 트림 ${snap.size} · 옵션매칭 ${hit}트림 · ${cells}셀 ${APPLY?'✓적재':'(드라이런)'}`);
// 샘플
const s=snap.docs.find(d=>/그랜저/.test(d.data().sub_model)&&/캘리그래피/.test(d.data().trim));
if(s){const c=tables.filter(tb=>N(s.data().sub_model).includes(N(tb.ko))&&N(tb.trim)===N(s.data().trim))[0];
  if(c)console.log('샘플 그랜저 캘리그래피:',c.options.slice(0,4).map(o=>`${o.name} ${o.price.toLocaleString()}`).join(' · '));}
