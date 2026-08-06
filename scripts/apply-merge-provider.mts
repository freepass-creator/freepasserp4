/**
 * 같은 회사인데 공급사코드가 갈린 것을 하나로 합친다 — 기본 dry-run, 반영은 --apply.
 *
 * 엘씨렌트카와 빌린카는 같은 회사다(2026-08-06 사용자 확인). 그런데 코드가 셋으로 갈려 있었다.
 *   RP021 빌린카        재고 49 · 시트 O(빌린카·엘씨렌트·빌린카구독 3탭) · 공급사계정 1  ← 정본
 *   PT-0024 주식회사 빌린카 재고  0 · 시트 X · 계정 0
 *   PT-0026 주식회사 엘씨   재고 13 · 시트 X · 계정 0
 *
 * 시트도 계정도 없는 코드에 재고가 묶여 있으면 **영원히 갱신되지 않는다**. 공급사가 자기 차를
 * 보지도 못한다. 시트와 계정을 가진 쪽으로 합쳐야 동기화 범위 안에 들어온다.
 *
 * ★안전 계약
 *   · 계약이 걸린 매물(`locked_by_contract`·계약중)은 옮기지 않는다 — 정산 귀속이 딸려간다.
 *   · 정책도 같이 옮긴다. 매물만 옮기면 정책 소유가 어긋나 판매조건이 끊긴다.
 *   · 파트너 레코드 자체는 지우지 않는다 — 과거 계약·정산이 그 코드를 가리킬 수 있다.
 *
 *   npx tsx scripts/apply-merge-provider.mts --from=PT-0026 --to=RP021
 *   ... --apply
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
const held = (r: Rec) => !!S(r.locked_by_contract) || S(r.vehicle_status).replace(/\s/g, '') === '계약중';

async function main() {
  const apply = process.argv.includes('--apply');
  const FROM = (process.argv.find((a) => a.startsWith('--from=')) || '').split('=')[1] || '';
  const TO = (process.argv.find((a) => a.startsWith('--to=')) || '').split('=')[1] || '';
  if (!FROM || !TO) { console.log('사용: --from=PT-0026 --to=RP021 [--apply]'); return; }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4s, p4s] = await Promise.all([db.ref('v4/products').get(), db.ref('v4/policies').get()]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const pol = (p4s.val() || {}) as Record<string, Rec>;

  const move: { key: string; plate: string; name: string }[] = [];
  const skip: string[] = [];
  for (const [k, r] of Object.entries(v4)) {
    if (dead(r) || S(r.provider_company_code) !== FROM) continue;
    const label = `${S(r.maker)} ${S(r.model)}`.trim() || '(차종 미상)';
    if (held(r)) { skip.push(`   ${S(r.car_number) || k} — 계약 걸림`); continue; }
    move.push({ key: k, plate: S(r.car_number) || k, name: label });
  }

  const polMove: { key: string; code: string; name: string }[] = [];
  for (const [k, p] of Object.entries(pol)) {
    if (dead(p)) continue;
    if (S(p.provider_company_code) !== FROM && S(p.partner_code) !== FROM) continue;
    polMove.push({ key: k, code: S(p.policy_code) || k, name: S(p.policy_name) });
  }

  console.log(`\n══ 공급사 통합 ${FROM} → ${TO} ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  매물 ${move.length}대 · 정책 ${polMove.length}건 · 계약으로 건너뜀 ${skip.length}대\n`);
  console.log('■ 옮길 매물');
  for (const m of move.slice(0, 15)) console.log(`   ${m.plate.padEnd(12)} ${m.name}`);
  if (move.length > 15) console.log(`   … 그 외 ${move.length - 15}대`);
  if (polMove.length) { console.log('\n■ 옮길 정책'); for (const p of polMove) console.log(`   ${p.code.padEnd(14)} ${p.name}`); }
  if (skip.length) { console.log('\n■ 건너뜀'); for (const s of skip) console.log(s); }

  if (!apply) { console.log(`\n※ dry-run. 반영은 --apply\n`); return; }

  let done = 0, poled = 0;
  const errors: string[] = [];
  for (const m of move) {
    try { await db.ref(`v4/products/${m.key}`).update({ provider_company_code: TO }); done++; }
    catch (e) { errors.push(`product ${m.key}: ${(e as Error)?.message || String(e)}`); }
  }
  for (const p of polMove) {
    try { await db.ref(`v4/policies/${p.key}`).update({ provider_company_code: TO }); poled++; }
    catch (e) { errors.push(`policy ${p.key}: ${(e as Error)?.message || String(e)}`); }
  }
  console.log(`\n  매물 ${done}대 · 정책 ${poled}건 반영`);
  if (errors.length) { console.log(`  ❌ 오류 ${errors.length}건`); for (const e of errors.slice(0, 10)) console.log(`     ${e}`); }
  console.log(`\n끝. 확인: npx tsx scripts/audit-sync-scope.mts\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
