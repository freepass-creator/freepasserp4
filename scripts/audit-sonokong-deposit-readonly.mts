import { readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { view } from '../sonokong/lib/sonokong.mjs';
const source = JSON.parse(readFileSync('sonokong/lib/wonja/손오공차량.json','utf8'));
const sa = JSON.parse(readFileSync('C:/dev/freepasserp4-rtdb-current/tmp/firebase-auth/freepasserp5-sa.json','utf8'));
if(sa.project_id !== 'freepasserp5' || process.env.FIRESTORE_EMULATOR_HOST) throw Error('Boundary');
const db = getFirestore(initializeApp({credential:cert(sa),projectId:'freepasserp5'}));
const snap = await db.collection('products').where('provider_company_code','==','RP012').get();
const rows = source.차량.map((c:any)=>{
 const docs = snap.docs.filter(d=>String(d.get('car_number')).replace(/\s/g,'') === String(c.차번).replace(/\s/g,''));
 const d = docs.length === 1 ? docs[0] : null;
 return {id:c.id,plate:c.차번,bucket:c.버킷,rawDeposit:c.보증금,low:c.저신용월납,docId:d?.id,type:d?.get('product_type'),price:d?.get('price'),matches:docs.length};
});
const samples = [rows.find((r:any)=>r.bucket==='SON_NO_KONG'),rows.find((r:any)=>r.bucket==='TCAR_EXTERNAL')].filter(Boolean);
for(const r of samples){const live=await view(r.id); r.live={keys:Object.keys(live),estimates:live.estimates};}
const missing=rows.filter((r:any)=> !r.price || !Object.values(r.price).some((p:any)=>p.deposit>0));
const report={at:new Date().toISOString(),sourceAt:source.갱신,count:rows.length,missing:missing.map((r:any)=>({plate:r.plate,type:r.type,matches:r.matches})),samples,rows};
writeFileSync('tmp/son-options-20260915/deposit-readonly.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({at:report.at,count:rows.length,missing:report.missing,samples},null,2));
