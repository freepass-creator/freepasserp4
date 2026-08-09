/**
 * 죽은 계약 정리 — 계약철회 + 상품코드 없는 계약을 «삭제» 표식으로 내린다.
 *
 *   tsx scripts/apply-retire-dead-contracts.mts          미리보기
 *   tsx scripts/apply-retire-dead-contracts.mts --apply  실제 반영
 *
 * ★ 왜 지우는가
 *   둘 다 isOpenContractRow 가 «살아 있는 계약»으로 잡는다. 그래서 그 차가 계속 묶여
 *   재판매·시트반영이 막힌다. 정작 계약은 진행되지 않는다 —
 *     계약철회      운영 이관 등으로 접은 건. 화면엔 빨강 「계약철회」로만 뜬다.
 *     상품코드 없음  상태까지 빈값이라 화면엔 「상태 확인」. 서버 선점 경로도 안 타서
 *                   입금 체크조차 안 된다(applyStepCheck 의 `productCode &&` 분기).
 *
 * ★ 왜 레코드를 실제로 지우지 않는가
 *   정산(ST_<코드>)·문의방(linked_contract)·매물락(locked_by_contract)이 계약코드를 가리킨다.
 *   행을 없애면 그 참조들이 가리킬 곳을 잃는다. 이 시스템의 «삭제»는 원래 표식이다
 *   (isOpenContractRow 가 _deleted 를 먼저 본다). 같은 방식을 쓴다 — 목록에서 사라지고,
 *   차는 풀리고, 이력과 참조는 남는다.
 *
 * ★ 참조가 살아 있으면 손대지 않는다
 *   정산이 붙어 있거나 매물을 잠그고 있는 건은 «사람이 볼 것»으로 남기고 건너뛴다.
 *   돈이 걸린 것을 조용히 치우지 않는다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');

type Target = { node: string; key: string; code: string; reason: string; blockers: string[]; notes: string[] };

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4c, v3c, v4s, v3s, v4r, v3r, v4p] = await Promise.all([
    db.ref('v4/contracts').get(), db.ref('contracts').get(),
    db.ref('v4/settlements').get(), db.ref('settlements').get(),
    db.ref('v4/rooms').get(), db.ref('rooms').get(),
    db.ref('v4/products').get(),
  ]).then((snaps) => snaps.map((s) => (s.val() || {}) as Record<string, any>));

  const settlementCodes = new Set([...Object.values(v4s), ...Object.values(v3s)].map((s) => S(s?.contract_code)));
  const roomLinks = new Set([...Object.values(v4r), ...Object.values(v3r)].map((r) => S(r?.linked_contract)));
  const lockedBy = new Set(Object.values(v4p).map((p) => S(p?.locked_by_contract)));

  const targets: Target[] = [];
  for (const [node, rows] of [['v4/contracts', v4c], ['contracts', v3c]] as const) {
    for (const [key, c] of Object.entries(rows)) {
      if (c?._deleted === true || S(c?.status) === 'deleted') continue;
      const code = S(c?.contract_code) || key;
      const status = S(c?.contract_status);
      const reason = status === '계약철회' ? '계약철회'
        : !S(c?.product_code) ? '상품코드 없음'
          : '';
      if (!reason) continue;
      // 차단은 «돈·재고»만이다. 문의방 연결은 막을 이유가 아니다 —
      //  계약이 내려가면 그 방은 contractStage 가 null 을 받아 그냥 「문의」로 되돌아간다.
      const blockers: string[] = [];
      if (settlementCodes.has(code)) blockers.push('정산 있음');
      if (lockedBy.has(code)) blockers.push('매물을 잠그고 있음');
      const notes = roomLinks.has(code) ? ['문의방 연결 → 문의로 되돌아감'] : [];
      targets.push({ node, key, code, reason, blockers, notes });
    }
  }

  console.log(`\n대상 ${targets.length}건`);
  for (const t of targets) {
    const mark = t.blockers.length ? '건너뜀' : '표식';
    console.log(`  [${mark}] ${t.node}/${t.key.padEnd(24)} ${t.reason.padEnd(12)} ${[...t.blockers, ...t.notes].join(' · ')}`);
  }
  const doable = targets.filter((t) => !t.blockers.length);
  const skipped = targets.filter((t) => t.blockers.length);
  console.log(`\n  표식 대상 ${doable.length} · 사람 확인 필요 ${skipped.length}`);

  if (!APPLY) { console.log('\n  미리보기만 했다. 실제 반영은 --apply 를 붙인다.\n'); process.exit(0); }
  if (!doable.length) { console.log('\n  반영할 것이 없다.\n'); process.exit(0); }

  const at = new Date().toISOString();
  const multi: Record<string, unknown> = {};
  for (const t of doable) {
    multi[`${t.node}/${t.key}/_deleted`] = true;
    multi[`${t.node}/${t.key}/deletedAt`] = at;
    multi[`${t.node}/${t.key}/deleted_reason`] = `정리: ${t.reason} (2026-08-09 사장님 지시)`;
  }
  mkdirSync('tmp/deploy/migrations', { recursive: true });
  const log = `tmp/deploy/migrations/${at.replace(/[:.]/g, '-').slice(0, 19)}-retire-dead-contracts.json`;
  writeFileSync(log, JSON.stringify({ at, retired: doable, skipped }, null, 2), 'utf8');
  await db.ref().update(multi);
  console.log(`\n  ✔ ${doable.length}건 «삭제» 표식 · 목록 → ${log}`);
  console.log('    되돌리려면 그 경로들의 _deleted/deletedAt/deleted_reason 을 지운다.\n');
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
