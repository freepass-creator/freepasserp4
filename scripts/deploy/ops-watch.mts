/**
 * 오픈 당일 관측 — 한 화면에서 «지금 무엇이 잘못되고 있는가».
 *
 *   npm run ops:watch          지금 상태
 *   npm run ops:watch -- 24    최근 24시간 기준(기본 24)
 *
 * ★ 왜 필요한가
 *   클라이언트 에러는 `v4/_client_errors` 에 쌓이지만 **아무도 안 본다.** 알림이 없어서
 *   오픈 당일에 사람이 콘솔을 뒤져야 한다. 그런데 정작 봐야 할 것은 에러만이 아니다 —
 *   «멈춘 딜»과 «요율 미확정 정산»은 에러를 내지 않고 조용히 쌓인다.
 *   터미널 한 줄로 그 셋을 같이 본다.
 *
 * ★ 여기서 판정하지 않는다
 *   멈춤·미확정 판정은 앱과 **같은 함수**(contractStage·settlementWarning)를 쓴다.
 *   여기서 따로 세면 화면과 숫자가 갈리고, 갈리는 순간 이 도구는 못 믿을 것이 된다.
 */
import { readFileSync } from 'node:fs';
import { contractStage, isOpenContractRow } from '@/lib/domain/contract';
import { settlementWarning } from '@/lib/domain/settlement-display';
import type { EntityRecord } from '@/lib/intake/entities';

const S = (v: unknown) => String(v ?? '').trim();
const HOURS = Number(process.argv[2]) || 24;

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [errs, v4c, v3c, v4s, v3s] = await Promise.all([
    db.ref('v4/_client_errors').get(), db.ref('v4/contracts').get(), db.ref('contracts').get(),
    db.ref('v4/settlements').get(), db.ref('settlements').get(),
  ]).then((snaps) => snaps.map((s) => (s.val() || {}) as Record<string, any>));

  const since = Date.now() - HOURS * 3600_000;
  console.log(`\n━━ 최근 ${HOURS}시간 ━━`);

  // ① 클라이언트 에러 — 같은 메시지는 묶는다. 20번 난 것 하나가 1번 난 것 20개보다 급하다.
  const recent = Object.values(errs).filter((e: any) => Number(e?.at || e?.created_at || 0) >= since);
  const groups = new Map<string, { n: number; last: number; where: string }>();
  for (const e of recent as any[]) {
    const key = S(e?.message).slice(0, 90) || '(메시지 없음)';
    const g = groups.get(key) || { n: 0, last: 0, where: S(e?.path || e?.url) };
    g.n++; g.last = Math.max(g.last, Number(e?.at || e?.created_at || 0));
    groups.set(key, g);
  }
  console.log(`\n클라이언트 에러 ${recent.length}건 · 종류 ${groups.size}`);
  for (const [msg, g] of [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) {
    console.log(`   ${String(g.n).padStart(3)}회  ${ago(g.last).padEnd(8)} ${msg}`);
    if (g.where) console.log(`        ${g.where}`);
  }
  // 권한 거부는 규칙 사고의 첫 신호다 — 따로 센다.
  const denied = (recent as any[]).filter((e) => /permission[\s_-]*denied|PERMISSION_DENIED/i.test(S(e?.message)));
  if (denied.length) console.log(`\n   ⚠ 권한 거부 ${denied.length}건 — 규칙이 정상 동작을 막고 있는지 즉시 확인`);

  // ② 멈춘 딜 — 화면이 「상태 확인」·「완료 처리 대기」로 보여 주는 것들.
  const stuck: string[] = [];
  for (const [node, rows] of [['v4', v4c], ['v3', v3c]] as const) {
    for (const [k, c] of Object.entries(rows)) {
      const row = { ...c, _key: k } as EntityRecord;
      if (!isOpenContractRow(row)) continue;
      const stage = contractStage(row);
      if (stage.label === '상태 확인' || stage.label === '완료 처리 대기' || stage.tone === 'red') {
        stuck.push(`   ${node} ${S(c?.contract_code || k).padEnd(22)} ${stage.label}`);
      }
    }
  }
  console.log(`\n멈춘 딜 ${stuck.length}건`);
  stuck.slice(0, 10).forEach((s) => console.log(s));
  if (stuck.length > 10) console.log(`   … 외 ${stuck.length - 10}건`);

  // ③ 요율 미확정 정산 — 조용히 10% 로 쌓이는 것들.
  let unresolved = 0, badRent = 0;
  for (const rows of [v4s, v3s]) {
    for (const s of Object.values(rows)) {
      const w = settlementWarning(s as EntityRecord);
      if (w.unresolvedRate) unresolved++;
      if (w.invalidRent) badRent++;
    }
  }
  console.log(`\n정산 경고 — 공급사율 미확정 ${unresolved}건 · 대여료 이상 ${badRent}건`);
  if (unresolved) console.log('   요율 확정 후 관리자가 재계산해야 한다. 오픈이 길어질수록 이 수가 는다.');
  console.log();
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
