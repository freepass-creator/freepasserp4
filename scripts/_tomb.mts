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
  // 오늘(08-06) 시트 동기화로 갱신된 «삭제된» 레코드가 있나
  let tombUpdatedToday = 0, tombWithOptions = 0, liveNoOptions = 0;
  const samples: string[] = [];
  for (const [k, p] of Object.entries(v4)) {
    const isDead = p?._deleted === true || S(p?.status) === 'deleted';
    const up = S(p?.updatedAt);
    if (isDead && up.startsWith('2026-08-06')) {
      tombUpdatedToday++;
      if (S(p.options)) {
        tombWithOptions++;
        const sv = S(p._merged_into) ? v4[S(p._merged_into)] : null;
        if (sv && !S(sv.options)) {
          liveNoOptions++;
          if (samples.length < 8) samples.push(`   ${k.padEnd(22)} 옵션«${S(p.options).slice(0,34)}» → 생존 ${S(p._merged_into)} 옵션 빈칸`);
        }
      }
    }
  }
  console.log(`오늘 갱신된 «삭제된» 레코드      ${tombUpdatedToday}건`);
  console.log(`  그중 옵션이 채워진 것          ${tombWithOptions}건`);
  console.log(`  생존자는 옵션이 빈 것          ${liveNoOptions}건  ← 시트가 죽은 쪽을 갱신한 증거`);
  if (samples.length) { console.log('\n표본'); for (const s of samples) console.log(s); }
}
main().catch((e) => { console.error(e); process.exit(1); });
