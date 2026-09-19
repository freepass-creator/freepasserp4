import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { basisOf, genesisConfig, modelKey, expandGenesis, fillBlankFuel } from '../lib/domain/estimate/genesis-lineup';

const S=(v:unknown)=>String(v??'').trim();

function genesisPrices(subModel:string,before:number,after:number):Record<string,unknown>{
  const basis=(()=>{
    try{
      const m=genesisConfig(process.cwd()).get(modelKey(subModel));
      return m?basisOf(m as Parameters<typeof basisOf>[0]).basis:'';
    }catch{return'';}
  })();
  try{
    const m=genesisConfig(process.cwd()).get(modelKey(subModel));
    const cfgPrice=m?basisOf(m as Parameters<typeof basisOf>[0]).price:0;
    if(cfgPrice>0&&before>0&&cfgPrice>before){
      return {priceBefore:cfgPrice,priceAfter:before,priceBasis:'세제혜택 전'};
    }
  }catch{}
  return {...(after>0&&after<before?{}:{}),...(basis?{priceBasis:basis}:{})};
}
function powertrainLabel(fuel:string,body:string,sourceName:string):string{
  const seat=/(\d{1,2}\s*인승)/.exec(S(body))?.[1]?.replace(/\s+/g,'')??'';
  const drive=/(2WD|4WD|AWD|HTRAC)/i.exec(S(sourceName))?.[1]??'';
  return [S(fuel),seat,drive].filter(Boolean).join(' · ');
}

const credPath=S(process.env.GOOGLE_APPLICATION_CREDENTIALS)||'tmp/firebase-auth/sa.json';
const outPath=S(process.env.OUT)||'data/new-car/current-feed.snapshot.json';
const sa=JSON.parse(readFileSync(credPath,'utf8')) as {project_id:string;client_email:string;private_key:string};

const app=getApps()[0]||initializeApp({
  credential:cert({
    projectId:sa.project_id,
    clientEmail:sa.client_email,
    privateKey:sa.private_key.replace(/\\n/g,'\n'),
  }),
  projectId:sa.project_id,
});

const fs=getFirestore(app);
const snap=await fs.collection('new_car_trim').get();

const allowed=[
  'maker','sub_model','carType','fuel','body','sourceName','trim',
  'priceBefore','priceAfter','priceBasis','options','extColors','intColors',
  'basePrices','rules','optionsMaster','exclusiveGroups','optionExcludes',
  'availableOptions','impliedOptions','trimKey','crawledAt'
] as const;

let rows=snap.docs.map(d=>{
  const v=d.data() as Record<string,unknown>;
  const maker=S(v.maker);
  const subModel=S(v.sub_model);
  const rawFuel=S(v.fuel);
  const out:Record<string,unknown>={id:d.id};
  for(const k of allowed) if(v[k]!==undefined) out[k]=v[k];
  out.fuel=powertrainLabel(rawFuel,S(v.body),S(v.sourceName));
  out.fuelRaw=rawFuel;
  if(maker==='제네시스'){
    Object.assign(out,genesisPrices(subModel,Number(v.priceBefore||0),Number(v.priceAfter||0)));
  }
  return out;
});
rows=expandGenesis(rows as any[]) as Record<string,unknown>[];
rows=fillBlankFuel(rows as any[]) as Record<string,unknown>[];
rows.sort((a,b)=>
  S(a.maker).localeCompare(S(b.maker),'ko')
  || S(a.sub_model).localeCompare(S(b.sub_model),'ko')
  || S(a.fuel).localeCompare(S(b.fuel),'ko')
  || S(a.trim).localeCompare(S(b.trim),'ko')
  || S(a.id).localeCompare(S(b.id))
);

const latest=rows.map(r=>S(r.crawledAt)).filter(Boolean).sort().at(-1)||null;
const makers=[...new Set(rows.map(r=>S(r.maker)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
const stats={
  count:rows.length,
  makers,
  with_price:rows.filter(r=>Number(r.priceAfter||r.priceBefore||0)>0).length,
  with_options_master:rows.filter(r=>r.optionsMaster&&Object.keys(r.optionsMaster as object).length>0).length,
  with_exclusive_groups:rows.filter(r=>Array.isArray(r.exclusiveGroups)&&(r.exclusiveGroups as unknown[]).length>0).length,
  with_available_options:rows.filter(r=>Array.isArray(r.availableOptions)).length,
  with_trim_key:rows.filter(r=>S(r.trimKey)).length,
};
const artifact={
  schema_version:1,
  source:{project:sa.project_id,collection:'new_car_trim'},
  exported_at:new Date().toISOString(),
  data_as_of:latest,
  ...stats,
  rows,
};
mkdirSync(dirname(outPath),{recursive:true});
writeFileSync(outPath,JSON.stringify(artifact,null,2)+'\n','utf8');
console.log(`PASS new_car_trim public snapshot — ${rows.length} rows · priced ${stats.with_price} · rules ${stats.with_options_master} · trimKey ${stats.with_trim_key}`);
