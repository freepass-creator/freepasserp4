import { readFileSync } from 'node:fs';
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';
for (const f of ['.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)) { const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l); if(!m)continue; const v=m[2].replace(/^["']|["']$/g,''); if(v&&!process.env[m[1]])process.env[m[1]]=v; } } catch {} }
const { firebaseAdminDatabase } = await import('../lib/server/firebase-admin');
const lock = (await firebaseAdminDatabase().ref('v4/system_locks/sheet_daily_sync').get()).val();
const now = Date.now();
console.log('now      :', new Date(now).toISOString());
console.log('lock     :', JSON.stringify(lock));
if (lock?.expires_at) console.log('만료까지  :', Math.round((Number(lock.expires_at)-now)/1000), '초 (음수면 스테일)');
process.exit(0);
