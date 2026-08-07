/**
 * 계약 이관 잔재 정리 — 같은 `contract_code` 가 두 키에 있는 것을 **정본 한 벌**로 만든다.
 *
 *   드라이런(기본, 쓰기 없음)
 *     GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/cleanup-contract-dup.mts
 *   실행(사람 승인 뒤에만)
 *     ... npx tsx scripts/cleanup-contract-dup.mts --apply
 *
 * 배경: 2026-08-05 v3→v4 이관이 계약을 원본 push key 그대로 한 번 더 넣었다.
 * 앱의 계약 키는 `contract_code`(entities.contract.idFrom) 이므로 push key 쪽이 잔재다.
 * 화면은 `lib/domain/contract-dedupe.ts` 가 읽는 자리에서 이미 합치고 있다 —
 * 이 스크립트는 **데이터도 같은 모양으로** 만드는 마무리다.
 *
 * 안 하는 것 · 못 하게 막은 것
 *   · `set()` 금지. 정본 보강은 `update()`(빈 칸 채우기)만, 삭제는 그 키 하나만 `remove()`.
 *   · 정본(코드키)이 없는 그룹은 **건드리지 않는다**. 지울 기준이 없다.
 *   · 잔재 키를 **누군가 참조하고 있으면 지우지 않는다**(방·정산·메시지 전수 검사).
 *   · 값이 서로 다른 칸이 하나라도 있으면 그 그룹은 건너뛴다 — 사람이 봐야 한다.
 *   · 쓰기 전 `v4/contracts` 전량을 파일로 백업한다. RTDB 는 롤백이 없다.
 */
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';

type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const DB_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: DB_URL });
  }
  const db = getDatabase();

  const [cSnap, rSnap, sSnap, aSnap] = await Promise.all([
    db.ref('v4/contracts').get(),
    db.ref('v4/rooms').get(),
    db.ref('v4/settlements').get(),
    db.ref('v4/admin_settlements').get(),
  ]);
  const contracts = (cSnap.val() || {}) as Record<string, Rec>;
  const others = JSON.stringify([rSnap.val(), sSnap.val(), aSnap.val()]);

  const byCode = new Map<string, string[]>();
  for (const [k, v] of Object.entries(contracts)) {
    const code = String(v.contract_code || '');
    if (!code) continue;
    byCode.set(code, [...(byCode.get(code) || []), k]);
  }

  const plan: { code: string; canonical: string; stale: string; backfill: Rec }[] = [];
  const skipped: string[] = [];

  for (const [code, keys] of byCode) {
    if (keys.length < 2) continue;
    if (!keys.includes(code)) { skipped.push(`${code}: 정본(코드키)이 없다 — 지울 기준 없음`); continue; }
    const canonical = contracts[code];
    for (const stale of keys.filter((k) => k !== code)) {
      const rec = contracts[stale];
      // ① 값이 어긋나는 칸이 있으면 사람이 봐야 한다.
      const conflict = Object.keys(rec).filter((f) => (
        f !== '_key' && !isEmpty(rec[f]) && !isEmpty(canonical[f])
        && JSON.stringify(rec[f]) !== JSON.stringify(canonical[f])
      ));
      if (conflict.length) { skipped.push(`${code}: 값 충돌(${conflict.join(', ')})`); continue; }
      // ② 잔재 키를 누가 참조하면 못 지운다(방 linked_contract·정산 등 전수 문자열 검사).
      if (others.includes(stale)) { skipped.push(`${code}: 잔재 키 ${stale} 를 다른 노드가 참조 중`); continue; }
      // ③ 정본에 없는 칸은 살려서 옮긴다(_key 는 정본 것을 지킨다).
      const backfill: Rec = {};
      for (const [f, v] of Object.entries(rec)) {
        if (f === '_key' || isEmpty(v)) continue;
        if (isEmpty(canonical[f])) backfill[f] = v;
      }
      plan.push({ code, canonical: code, stale, backfill });
    }
  }

  console.log(`\n계약 키 ${Object.keys(contracts).length}개 · 고유 ${byCode.size}건`);
  console.log(`정리 대상 잔재 ${plan.length}개 · 건너뜀 ${skipped.length}건`);
  for (const p of plan.slice(0, 40)) {
    const bf = Object.keys(p.backfill);
    console.log(`  ${p.code}  잔재 ${p.stale} 삭제${bf.length ? ` · 정본에 옮길 칸 ${bf.length}(${bf.slice(0, 5).join(', ')})` : ''}`);
  }
  skipped.forEach((s) => console.log(`  ⚠ 건너뜀 — ${s}`));

  if (!APPLY) {
    console.log('\n드라이런입니다(쓰기 없음). 실행하려면 --apply.\n');
    return;
  }

  // ── 여기서부터 쓰기. 백업이 유일한 복구수단이다.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = `tmp/migration-backups/${stamp}-contract-dup`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/v4_contracts.json`, JSON.stringify(contracts, null, 2), 'utf8');
  const log = `${dir}/apply.jsonl`;
  console.log(`\n백업: ${dir}/v4_contracts.json`);

  let backfilled = 0;
  let removed = 0;
  for (const p of plan) {
    if (Object.keys(p.backfill).length) {
      await db.ref(`v4/contracts/${p.canonical}`).update(p.backfill);
      backfilled += 1;
      appendFileSync(log, `${JSON.stringify({ op: 'backfill', code: p.code, from: p.stale, fields: p.backfill })}\n`);
    }
    await db.ref(`v4/contracts/${p.stale}`).remove();
    removed += 1;
    appendFileSync(log, `${JSON.stringify({ op: 'remove', key: p.stale, code: p.code, record: contracts[p.stale] })}\n`);
  }
  console.log(`정본 보강 ${backfilled}건 · 잔재 삭제 ${removed}건`);
  console.log(`로그(복구 근거): ${log}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
