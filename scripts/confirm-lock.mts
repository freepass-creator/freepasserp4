import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { readMasterSheet, MASTER_SHEET_ID, MASTER_TAB, pickConfirmedMasterCode } from '../lib/domain/vehicle-master-sheet';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB, PRODUCT_MASTER_BASE_COLUMNS, PRODUCT_MASTER_SYSTEM_COLUMNS } from '../lib/domain/product-master-sheet';
const APPLY=process.argv.includes('--apply');
const sa=JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS||'tmp/firebase-auth/sa.json','utf8'));
const jwt=new JWT({email:sa.client_email,key:sa.private_key,scopes:['https://www.googleapis.com/auth/spreadsheets'],subject:'pyh@teamjpk.com'}); await jwt.authorize();
const tok=(await jwt.getAccessToken()).token;
const api=(m,u,b)=>fetch(`https://sheets.googleapis.com/v4/spreadsheets/${u}`,{method:m,headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},...(b?{body:JSON.stringify(b)}:{})});
const get=async(id,rng)=>((await(await api('GET',`${id}/values/${encodeURIComponent(rng)}`)).json()).values||[]);
const BOOK=readMasterSheet(await get(MASTER_SHEET_ID,`'${MASTER_TAB}'`));
// 마음카 유일코드 차 뽑기
const SUP='1uq22EKUeEgNK_C3nJyFSxxFWwlttog0Qs-NrNZZhc-s';
const rv=await get(SUP,"'재고'!A1:BZ400"); const rh=rv[0]||[]; const ri=(n)=>rh.findIndex(c=>String(c||'').trim()===n); const rS=(r,n)=>{const k=ri(n);return k>=0?String(r[k]||'').trim():'';};
const 확정후보=[];
for(const r of rv.slice(1).filter(x=>x&&rS(x,'차량번호'))){
  if(/출고불가/.test(rS(r,'상태'))||!rS(r,'모델')) continue;
  const p=pickConfirmedMasterCode(BOOK, rS(r,'제조사(정제)'), rS(r,'모델'), rS(r,'세부모델'), rS(r,'연료(정제)'), rS(r,'세부트림'), rS(r,'연료(정제)'), rS(r,'배기량(정제)'), {drivetrain:rS(r,'구동방식'),seats:rS(r,'인승')});
  if(p.code) 확정후보.push({차번:rS(r,'차량번호'), 코드:p.code, 적용값:`${rS(r,'세부모델')} · ${rS(r,'세부트림')}`, 공급사:'마음카'});
}
// 상품마스터 현재
const pm=await get(DEFAULT_PRODUCT_MASTER_SHEET_ID,`'${PRODUCT_MASTER_TAB}'!A1:BC2000`); const ph=pm[0]||[]; const pi=(n)=>ph.findIndex(c=>String(c||'').trim()===n);
const byPlate=new Map(); pm.slice(1).forEach((r,idx)=>{const pl=String(r[0]||'').trim(); if(pl)byPlate.set(pl,{row:idx+2,cells:r});});
console.log(`확정후보 ${확정후보.length}대 · 상품마스터 ${pm.length-1}행`);
const 계획=[];
for(const c of 확정후보){ const ex=byPlate.get(c.차번);
  if(ex){ const 상태=String(ex.cells[pi('검증상태')]||'').trim(); const 코드=String(ex.cells[pi('차종코드')]||'').trim();
    if(상태==='확정'&&코드===c.코드){계획.push(`  = ${c.차번} 이미확정(${코드})`);continue;}
    계획.push(`  ✎ ${c.차번} 행${ex.row} → 검증상태=확정·차종코드=${c.코드} (기존 ${상태||'빈'})`);
    if(APPLY){ await api('POST',`${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values:batchUpdate`,{valueInputOption:'RAW',data:[{range:`'${PRODUCT_MASTER_TAB}'!E${ex.row}`,values:[['확정']]},{range:`'${PRODUCT_MASTER_TAB}'!AT${ex.row}`,values:[[c.코드]]}]}); }
  } else { 계획.push(`  + ${c.차번} 신규행 append → 확정·${c.코드}`);
    if(APPLY){ const row=Array(ph.length).fill(''); row[0]=c.차번; row[1]=c.공급사; row[3]=c.적용값; row[4]='확정'; row[pi('차종코드')]=c.코드; row[pi('원천')]='사람확정'; await api('POST',`${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A1`)}:append?valueInputOption=RAW`,{values:[row]}); }
  }
}
계획.forEach(x=>console.log(x));
console.log(APPLY?'\n★반영함':'\n--apply 로 실제 반영 · (검증상태=E열·차종코드=AT열 실측확인 필요)');
console.log('열 확인 — 검증상태 idx',pi('검증상태'),'차종코드 idx',pi('차종코드'));
