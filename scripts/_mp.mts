import { readFileSync } from 'node:fs';
const S = (v: unknown) => String(v ?? '').trim();
async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const live = ((await db.ref('partners').get()).val() || {}) as Record<string, any>;
  const over = ((await db.ref('v4/partners').get()).val() || {}) as Record<string, any>;
  const m: Record<string, any> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) m[k] = { ...(live[k] || {}), ...(over[k] || {}) };
  for (const p of Object.values(m)) {
    if (!S(p.sheet_url)) continue;
    const mp = p.mapping_profile;
    const txt = typeof mp === 'string' ? mp : JSON.stringify(mp ?? null);
    const hasOpts = /"options"|옵션/.test(txt || '');
    console.log(`${S(p.partner_code).padEnd(9)} ${S(p.partner_name || p.company_name).padEnd(18)} 프로필 ${mp ? '있음' : '없음'} · 옵션매핑 ${mp ? (hasOpts ? '✅' : '❌ 없음') : '-'}`);
    if (mp && !hasOpts) console.log(`     ${String(txt).slice(0, 300)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
