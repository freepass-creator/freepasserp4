/**
 * 계약 중복 진단(읽기 전용) — 같은 `contract_code` 가 여러 RTDB 키에 들어가 있는가.
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/audit-contract-dup.mts
 *
 * 배경: 2026-08-05 v3→v4 이관이 계약을 **원본 push key 그대로** 한 번 더 넣었다.
 * 앱의 계약 키는 `contract_code`(entities.contract.idFrom) 이므로 push key 쪽은 잔재다.
 * 화면은 `lib/domain/contract-dedupe.ts` 가 읽는 자리에서 합쳐 이미 한 벌로 보이지만,
 * **데이터는 그대로 두 벌**이다 — 지우는 건 되돌릴 수 없어 백업·승인 뒤에 할 일이다.
 *
 * 쓰기는 하지 않는다. 정리 실행은 사람·Claude 게이트.
 */
import { readFileSync } from 'node:fs';

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [contractSnap, settlementSnap] = await Promise.all([
    db.ref('v4/contracts').get(),
    db.ref('v4/settlements').get(),
  ]);
  const all = (contractSnap.val() || {}) as Record<string, Record<string, unknown>>;
  const entries = Object.entries(all);

  const byCode = new Map<string, string[]>();
  for (const [k, v] of entries) {
    const code = String(v.contract_code || '');
    byCode.set(code, [...(byCode.get(code) || []), k]);
  }
  const dup = [...byCode.entries()].filter(([, keys]) => keys.length > 1);
  console.log(`\nv4/contracts 키 ${entries.length}개 · 고유 계약 ${byCode.size}건 · 중복 ${dup.length}건`);

  let conflict = 0;
  for (const [code, keys] of dup) {
    const recs = keys.map((k) => all[k]);
    const fields = new Set<string>();
    recs.forEach((r) => Object.keys(r).forEach((f) => fields.add(f)));
    // 「양쪽 다 값이 있는데 서로 다른」 칸 = 화면이 어느 쪽을 잡느냐에 따라 달라 보이는 칸.
    const hard = [...fields].filter((f) => {
      if (f === '_key') return false;
      const vals = recs.map((r) => r[f]).filter((v) => v !== undefined && v !== null && v !== '');
      return vals.length > 1 && new Set(vals.map((v) => JSON.stringify(v))).size > 1;
    });
    if (hard.length) {
      conflict += 1;
      console.log(`  ⚠ ${code} — 값이 어긋난 칸: ${hard.join(', ')}`);
    }
  }
  console.log(`값 충돌이 있는 계약: ${conflict}건 (나머지는 한쪽에만 값이 있는 «채움» 관계)`);

  const setts = Object.values((settlementSnap.val() || {}) as Record<string, Record<string, unknown>>);
  const perContract = new Map<string, number>();
  for (const s of setts) {
    const c = String(s.contract_code || '');
    if (c) perContract.set(c, (perContract.get(c) || 0) + 1);
  }
  const dupSett = [...perContract.entries()].filter(([, n]) => n > 1);
  console.log(`\n정산 ${setts.length}건 · 같은 계약에 정산 2건 이상: ${dupSett.length}건 ${dupSett.length ? '← 돈이 두 번 잡혔다. 즉시 확인.' : '(이중계상 없음)'}`);
  dupSett.forEach(([c, n]) => console.log(`   ${c} → ${n}건`));
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
