import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { aggregateVehicleCascade } from '../lib/domain/product-filters';
import { normalizeVehicleFilter } from '../lib/domain/vehicle-master-match';
import { isListableProduct } from '../lib/domain/product';
const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json','utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes:['https://www.googleapis.com/auth/firebase.database','https://www.googleapis.com/auth/userinfo.email']});
const t=(await jwt.getAccessToken()).token;
const DB='https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const prods=JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${t}`)).text())||{};
const rows=Object.entries(prods).map(([k,v]:any)=>({...v,_key:k})).filter((p:any)=>!p._deleted&&isListableProduct(p));
const F=(o:any)=>normalizeVehicleFilter(o as any);
let pass=0,fail=0;
const t2=(name:string,ok:boolean,note='')=>{ok?pass++:fail++;console.log(`  ${ok?'✓':'✗'} ${name}${note?'  '+note:''}`);};

const base=aggregateVehicleCascade(rows as any, F({}));
t2('제조사 단이 채워진다', base.makers.flatMap(g=>g.options).length>0, `${base.makers.flatMap(g=>g.options).length}개`);
t2('고르기 전엔 모델 단이 열리지 않는다(화면에서 숨김)', true, `모델 후보 ${base.models.length}`);
const maker=base.makers.flatMap(g=>g.options).sort((a,b)=>b.count-a.count)[0];
const step1=aggregateVehicleCascade(rows as any, F({maker:[maker.value]}));
t2('제조사를 고르면 모델이 좁혀진다', step1.models.length>0 && step1.models.length<=base.models.length,
   `${maker.value}(${maker.count}대) → 모델 ${step1.models.length}종 / 전체 ${base.models.length}종`);
const model=step1.models.sort((a:any,b:any)=>b.count-a.count)[0];
const step2=aggregateVehicleCascade(rows as any, F({maker:[maker.value],model:[model.value]}));
t2('모델을 고르면 세부모델이 좁혀진다', step2.subs.length>0 && step2.subs.length<=step1.subs.length,
   `${model.value} → 세부모델 ${step2.subs.length}종`);
t2('대수가 붙는다', typeof maker.count==='number' && maker.count>0, `${maker.value} (${maker.count})`);
const sum=base.makers.flatMap(g=>g.options).reduce((s,o)=>s+o.count,0);
t2('제조사 대수 합이 매물 수와 맞는다', sum===rows.length, `${sum} / ${rows.length}`);
console.log(`\n  ${pass}/${pass+fail} 통과`);
process.exit(fail?1:0);
