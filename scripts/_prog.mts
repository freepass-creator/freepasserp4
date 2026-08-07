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
  const v4 = ((await db.ref('v4/products').get()).val() || {}) as Record<string, any>;
  let alive = 0, noProvider = 0, withOpts = 0, sp900 = 0;
  for (const p of Object.values(v4)) {
    if (p?._deleted === true || S(p?.status) === 'deleted') continue;
    alive++;
    if (!S(p.provider_company_code)) noProvider++;
    if (S(p.provider_company_code) === 'SP900') sp900++;
    if (S(p.options)) withOpts++;
  }
  console.log(`살아있음 ${alive} · 공급사 미지정 ${noProvider} (SP900 ${sp900}) · 옵션 있음 ${withOpts}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
