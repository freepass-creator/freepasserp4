/**
 * **erp3(v3)가 아직 공급사 시트를 읽고 있는가.**
 *
 * 왜 중요한가: 같은 시트를 erp3 와 fp4 가 «각각» 읽어 각자 저장한다.
 * 그래서 같은 차가 두 레코드로 존재한다 — v3 의 `EXT_*` 와 v4 의 `<공급사>_<번호판>`.
 * 지금까지 접은 트윈 200여 그룹이 전부 이 구조에서 나왔다.
 * 도메인을 fp4 로 넘긴 뒤에도 erp3 동기화를 켜 두면 **다음 날부터 다시 쌓인다.**
 *
 * 판정: v3 `products` 의 살아있는 `EXT_*` 레코드 중 최근 갱신된 것이 있는가.
 * fp4 는 v3 에 쓰지 않으므로(어댑터는 v4 오버레이에만 쓴다) v3 가 갱신됐다면 erp3 다.
 *
 * 읽기 전용.
 *   npx tsx scripts/check-erp3-sync-stopped.mts
 *   ... --since=2026-08-05     기준일 지정(기본: 오늘)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();
const S = (v: unknown) => String(v ?? '').trim();
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice('--since='.length).trim();

/** v3 는 초·밀리초·ISO 가 뒤섞여 있다. 전부 YYYY-MM-DD 로 정규화한다. */
function day(v: unknown): string {
  const s = S(v); if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s); if (!Number.isFinite(n) || n <= 0) return '';
  return new Date(n < 1e12 ? n * 1000 : n).toISOString().slice(0, 10);
}

async function main() {
  const cutoff = SINCE || new Date().toISOString().slice(0, 10);
  const snap = await db.ref('products').get();
  const v3 = (snap.val() || {}) as Record<string, Record<string, unknown>>;

  const ext = Object.entries(v3).filter(([k]) => k.startsWith('EXT_'));
  const live = ext.filter(([, r]) => r && r._deleted !== true && S(r.status) !== 'deleted');
  const recent = live.filter(([, r]) => {
    const d = day(r.updated_at ?? r.updatedAt ?? r.created_at ?? r.createdAt);
    return d && d >= cutoff;
  });

  console.log(`\n══ erp3 시트 동기화 상태 (기준 ${cutoff} 이후) ══\n`);
  console.log(`v3 products 전체 ${Object.keys(v3).length}`);
  console.log(`  EXT_ 레코드 ${ext.length} · 살아있음 ${live.length}`);
  console.log(`  ★ 기준일 이후 갱신 ${recent.length}건`);

  const byDay = new Map<string, number>();
  for (const [, r] of live) {
    const d = day(r.updated_at ?? r.updatedAt ?? r.created_at ?? r.createdAt) || '(시각없음)';
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  console.log('\n최근 갱신일:');
  [...byDay.entries()].filter(([d]) => d !== '(시각없음)').sort().slice(-6)
    .forEach(([d, n]) => console.log(`  ${d}  ${String(n).padStart(4)}건`));

  console.log('');
  if (recent.length) {
    console.log(`🔴 erp3 가 아직 시트를 읽고 있다 — ${recent.length}건이 ${cutoff} 이후 갱신됐다.`);
    console.log('   fp4 는 v3 에 쓰지 않으므로(v4 오버레이 전용) 이 갱신의 주체는 erp3 다.');
    console.log('   이 상태로 두면 fp4 가 접은 트윈이 매일 다시 생긴다.');
    console.log('   → 도메인 전환 뒤 erp3 의 시트 동기화를 끄고 이 스크립트로 재확인할 것.');
    process.exitCode = 1;
  } else {
    console.log(`🟢 erp3 시트 동기화가 멈춘 것으로 보인다 — ${cutoff} 이후 갱신 0건.`);
    console.log('   하루 이상 지켜본 뒤 확정할 것(주기 동기화라면 다음 실행에서 다시 나타난다).');
  }
  console.log('');
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1); });
