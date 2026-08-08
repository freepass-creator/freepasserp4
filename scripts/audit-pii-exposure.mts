/**
 * PII·상업기밀 노출 실측(읽기 전용) — 지금 «로그인만 하면» 읽히는 것이 무엇인가.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/audit-pii-exposure.mts
 *
 * 배경: `database.rules.json` 의 users(:4)·partners(:25)와 v4 오버레이(:328·:344) read 가
 * «인증만» 이라 스코프가 없다. 즉 **영업자 계정 하나로 전 회원 연락처와 전 공급사 수수료율이
 * 열린다.** RTDB 는 필드 단위 권한이 없으므로 민감 필드를 **다른 노드로 옮기는 것** 말고는 방법이 없다.
 * 이 스크립트는 옮길 것과 규모를 숫자로 못박는다. 쓰기는 하지 않는다.
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, unknown>;

/** 옮길 후보 — 이름만 보고 고르지 않는다. 실제로 값이 들어 있는 필드만 센다. */
const SENSITIVE = [
  // 사람 신원·연락
  'email', 'phone', 'mobile', 'tel', 'contact', 'address', 'birth', 'rrn', 'resident_no',
  // 돈
  'fee_rate', 'agent_payout_rate', 'payout_rate', 'commission', 'margin', 'bank', 'account',
  // 사업자
  'business_no', 'business_number', 'biz_no',
];

function sensitiveKeys(rec: Rec): string[] {
  return Object.keys(rec).filter((k) => {
    const low = k.toLowerCase();
    return SENSITIVE.some((s) => low === s || low.includes(s));
  });
}

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();

  for (const node of ['users', 'partners', 'v4/users', 'v4/partners']) {
    const val = (await db.ref(node).get()).val() as Record<string, Rec> | null;
    if (!val) { console.log(`\n■ ${node} — 없음`); continue; }
    const rows = Object.values(val).filter((r) => r && typeof r === 'object');
    console.log(`\n■ ${node} — ${rows.length}건`);

    // 필드별로 «값이 있는» 레코드 수를 센다. 빈 칸만 있는 필드는 옮길 필요가 없다.
    const count = new Map<string, number>();
    for (const r of rows) {
      for (const k of sensitiveKeys(r)) {
        const v = r[k];
        if (v === undefined || v === null || v === '') continue;
        count.set(k, (count.get(k) || 0) + 1);
      }
    }
    if (count.size === 0) { console.log('   민감 필드 없음'); continue; }
    for (const [k, n] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${k.padEnd(22)} ${String(n).padStart(4)}건`);
    }
  }

  // 이 값들을 이름표로 쓰는 화면이 있으므로, «공개로 남길 것»도 같이 센다.
  const partners = (await db.ref('v4/partners').get()).val() as Record<string, Rec> | null;
  const names = Object.values(partners || {}).filter((p) => String(p.name || '').trim()).length;
  console.log(`\n공개로 남길 이름표(v4/partners.name): ${names}건 — 목록·카드가 이걸로 회사명을 쓴다.`);
  console.log('\n※ 쓰기 없음. 옮기기는 별도 스크립트 + 사람 승인.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
