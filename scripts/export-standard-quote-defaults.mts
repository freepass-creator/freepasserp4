import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COST_DEFAULTS, configFrom } from '../lib/domain/estimate/cost-settings';

const S=(v:unknown)=>String(v??'').trim();
const credPath=S(process.env.GOOGLE_APPLICATION_CREDENTIALS)||'tmp/firebase-auth/sa.json';
const outPath=S(process.env.OUT)||'data/new-car/standard-quote-defaults.snapshot.json';
const sa=JSON.parse((await import('node:fs')).readFileSync(credPath,'utf8')) as {project_id:string;client_email:string;private_key:string};
const app=getApps()[0]||initializeApp({
  credential:cert({projectId:sa.project_id,clientEmail:sa.client_email,privateKey:sa.private_key.replace(/\\n/g,'\n')}),
  projectId:sa.project_id,
});
const fs=getFirestore(app);
const live=await fs.collection('settings').doc('estimate_cost').get();
const liveData=live.exists?live.data() as {cost?:unknown;updatedAt?:string}:null;

const credits=['정상','중신용','저신용','무신용'] as const;
const configs=Object.fromEntries(credits.map(credit=>[
  credit,
  configFrom(COST_DEFAULTS,{newCar:true,credit}),
]));

const artifact={
  schema_version:1,
  source:'freepasserp4/lib/domain/estimate/cost-settings.ts',
  generated_at:new Date().toISOString(),
  mode:'code-defaults',
  // 실제 회사 override 값은 public repo snapshot에 절대 싣지 않는다.
  live_override_present:!!liveData?.cost,
  live_override_updated_at:liveData?.updatedAt||null,
  cost_defaults:COST_DEFAULTS,
  engine_configs:configs,
};
mkdirSync(dirname(outPath),{recursive:true});
writeFileSync(outPath,JSON.stringify(artifact,null,2)+'\n');
console.log('PASS standard quote defaults snapshot',JSON.stringify({
  live_override_present:artifact.live_override_present,
  live_override_updated_at:artifact.live_override_updated_at,
  credits:Object.keys(configs),
}));
