/**
 * 「한 칸에 다 넣기」 2차 검증 — **실제 판매된 차**를 정답지로 쓴다.
 *
 * 계약에는 판매 시점의 확정 차종이 스냅샷으로 박혀 있다(maker/model/sub_model_snapshot).
 * 그 확정값으로 «공급사가 한 칸에 적을 법한 문장»을 만들어 매처에 넣고,
 * 같은 차종으로 되돌아오는지 본다. 되돌아오지 않으면 한 칸 입력을 권할 수 없다.
 *
 *   npx tsx scripts/sim-onecell-match.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { snapToMaster, unpackVehicleSignals } from '../lib/domain/vehicle-master-match';
type Rec = Record<string, any>;
const S=(v:unknown)=>String(v??'').trim();
const DB='https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa=JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS)||'tmp/firebase-auth/sa.json','utf8'));
const jwt=new JWT({email:sa.client_email,key:sa.private_key,scopes:['https://www.googleapis.com/auth/firebase.database','https://www.googleapis.com/auth/userinfo.email']});
const token=(await jwt.getAccessToken()).token;
const get=async(n:string)=>{const r=await fetch(`${DB}/${n}.json?access_token=${token}`);return r.ok?(JSON.parse(await r.text())||{}) as Record<string,Rec>:{};};
const [v4c,v3c,prods]=await Promise.all([get('v4/contracts'),get('contracts'),get('v4/products')]);
const mm=JSON.parse(readFileSync('public/data/vehicle-master.json','utf8'));
const entries=(Array.isArray(mm)?mm:mm.entries)||[];

// 계약 정답지 — 차번 기준 중복 제거
const truth=new Map<string,{maker:string;model:string;sub:string;trim:string;fuel:string}>();
for (const c of [...Object.values(v4c), ...Object.values(v3c)]) {
  if(!c||typeof c!=='object')continue;
  const plate=S(c.car_number_snapshot)||S(c.car_number); const sub=S(c.sub_model_snapshot);
  if(!plate||!sub)continue;
  const p=Object.values(prods).find((x:any)=>S(x?.car_number)===plate) as Rec|undefined;
  truth.set(plate,{maker:S(c.maker_snapshot),model:S(c.model_snapshot),sub,
    trim:S(c.trim_name_snapshot)||S(p?.trim_name)||'',fuel:S(p?.fuel_type)||''});
}

/**
 * 문자열이 아니라 **세대(gen_code)** 로 맞춘다.
 * 계약 스냅샷은 마스터 표기가 아니다 — 「그랜저 GN7 22~」·「G80 (RG3)」·「올 뉴 K5 DL3」처럼
 * 연식 꼬리표·괄호·세대 접두가 섞여 있어 문자열로 대면 «같은 차»가 어긋난 것으로 세어진다.
 * 물어야 할 것은 「같은 세대를 잡았는가」다.
 */
const genOf = (sub: string): string => {
  const hit = entries.find((e: any) => S(e.sub_model) === sub);
  if (hit) return S(hit.gen_code).toUpperCase();
  const toks = sub.match(/[A-Za-z]{1,3}\d{1,3}[A-Za-z]?/g) || [];
  const codes = new Set(entries.map((e: any) => S(e.gen_code).toUpperCase()).filter(Boolean));
  for (const t of toks) if (codes.has(t.toUpperCase())) return t.toUpperCase();
  return '';
};
const bareModel = (sub: string) => S(sub)
  .replace(/\((?:[^)]*)\)/g, ' ')
  .replace(/\d{2}~\s*$/,' ')
  .replace(/^(디\s*올\s*뉴|올\s*뉴|더\s*뉴|신형)\s*/,'')
  .replace(/[A-Za-z]{1,3}\d{1,3}[A-Za-z]?/g,' ')
  .replace(/\s+/g,' ').trim();

let n=0, hit=0, miss=0, genHit=0, genUnknown=0; const conf=new Map<string,number>(); const bad:string[]=[];
for (const [plate,t] of truth) {
  // 공급사가 한 칸에 적을 법한 문장 — 제조사 빼고 세부모델+트림+연료를 이어 붙인다.
  const oneCell=[t.sub,t.trim,t.fuel].filter(Boolean).join(' ');
  const r=snapToMaster(unpackVehicleSignals({ maker:t.maker, model:oneCell } as any, entries), entries);
  n++;
  const c=S(r?.confidence)||'-'; conf.set(c,(conf.get(c)||0)+1);
  const got=S(r?.sub_model);
  const gTruth=genOf(t.sub), gGot=genOf(got);
  const sameGen = (gTruth && gGot) ? gTruth===gGot : bareModel(t.sub)===bareModel(got);
  if(!gTruth || !gGot) genUnknown++;
  if(got===t.sub) hit++;
  if(sameGen) genHit++;
  else {
    miss++;
    if (bad.length < 12) {
      bad.push(`${plate} 「${oneCell}」\n      정답 ${t.sub}(${gTruth || '세대미상'}) → 결과 ${got || '-'}(${gGot || '세대미상'}) · ${c}`);
    }
  }
}
console.log(`\n══ 한 칸 입력 재현 — 실제 판매 ${n}대 ══\n`);
console.log(`  같은 세대로 복원 ${genHit}/${n} (${(genHit/n*100).toFixed(1)}%) · 어긋남 ${miss}`);
console.log(`  표기까지 똑같이 ${hit}/${n} · 세대코드 없는 건 ${genUnknown}`);
console.log(`  신뢰도 ${['high','medium','low','-'].map(k=>`${k} ${conf.get(k)||0}`).join(' · ')}`);
if(bad.length){ console.log('\n어긋난 예'); for(const b of bad) console.log('  '+b); }
process.exit(miss > n*0.1 ? 1 : 0);
