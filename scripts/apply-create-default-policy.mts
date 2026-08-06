/**
 * 정책이 없는 공급사에 «기본 정책»을 만들어 붙인다 — 기본 dry-run, 반영은 --apply.
 *
 * 정책이 없으면 심사·연령·보증금 조건이 통째로 없어 화면에 「미입력」으로만 뜬다.
 * 오플(RP023)은 erp3 에도 정책이 없었다 — 매물 104대 전부 policy_code 공란이고
 * 정책 노드에도 RP023 소유가 0건이다. 이어붙일 게 아니라 만들어야 한다.
 *
 * ★기본값 (2026-08-06 사용자 결정)
 *     연령      만 26세 이상
 *     심사조건  무심사
 *     기본연령  만 26세 이상
 *     연주행    시트값을 따른다(매물의 annual_mileage). 정책에는 표준값만 둔다.
 *
 * 나머지 보험·면책·환수 조건은 **기존 무심사 정책(RP008_P01)을 그대로 복제**한다.
 * 임의로 바꾸면 근거 없는 조건이 손님 견적서로 나간다. 다르면 나중에 화면에서 고친다.
 *
 *   npx tsx scripts/apply-create-default-policy.mts --code=RP023
 *   ... --apply
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

/** 틀에서 «그 공급사 것»으로 갈아야 하는 필드 — 나머지는 복제한다. */
const OWN_FIELDS = ['_key', 'policy_code', 'term_code', 'policy_name', 'term_name', 'provider_company_code', 'created_at', 'updated_at', 'created_by'];

async function main() {
  const apply = process.argv.includes('--apply');
  const CODE = (process.argv.find((a) => a.startsWith('--code=')) || '').split('=')[1] || '';
  const TEMPLATE = (process.argv.find((a) => a.startsWith('--template=')) || '').split('=')[1] || 'RP008_P01';
  if (!CODE) { console.log('사용: --code=RP023 [--template=RP008_P01] [--apply]'); return; }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [p4s, v4s, pl, po] = await Promise.all([
    db.ref('v4/policies').get(), db.ref('v4/products').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const pol = (p4s.val() || {}) as Record<string, Rec>;
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const partners = { ...((pl.val() || {}) as Rec), ...((po.val() || {}) as Rec) } as Record<string, Rec>;
  const name = S(Object.values(partners).find((x) => S(x.partner_code) === CODE)?.partner_name
    || Object.values(partners).find((x) => S(x.partner_code) === CODE)?.company_name) || CODE;

  const existing = Object.values(pol).filter((p) => !dead(p) && (S(p.provider_company_code) === CODE || S(p.partner_code) === CODE));
  if (existing.length) {
    console.log(`\n${CODE} ${name} 는 이미 정책 ${existing.length}건이 있다 — 만들지 않는다.`);
    for (const p of existing) console.log(`   ${S(p.policy_code)} ${S(p.policy_name)}`);
    return;
  }

  const tmpl = pol[TEMPLATE];
  if (!tmpl) { console.log(`틀 ${TEMPLATE} 없음`); return; }

  // 다음 POL 번호
  const nums = Object.keys(pol).map((k) => (k.match(/^POL-(\d+)$/) || [])[1]).filter(Boolean).map(Number);
  const next = `POL-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`;

  const now = Date.now();
  const rec: Rec = {};
  for (const [k, v] of Object.entries(tmpl)) if (!OWN_FIELDS.includes(k)) rec[k] = v;
  rec._key = next;
  rec.policy_code = next;
  rec.term_code = next;
  rec.policy_name = '만 26세 이상';
  rec.term_name = '만 26세 이상';
  rec.provider_company_code = CODE;
  rec.screening_criteria = '무심사';
  rec.basic_driver_age = '만 26세 이상';
  rec.created_at = now;
  rec.updated_at = now;
  rec.created_by = 'claude:default-policy';

  const targets = Object.entries(v4).filter(([, r]) => !dead(r) && S(r.provider_company_code) === CODE && !S(r.policy_code));

  console.log(`\n══ ${CODE} ${name} 기본 정책 만들기 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  새 정책 ${next} (틀 ${TEMPLATE} 복제)`);
  console.log(`     정책명    ${rec.policy_name}`);
  console.log(`     심사조건  ${rec.screening_criteria}`);
  console.log(`     기본연령  ${rec.basic_driver_age}`);
  console.log(`     연령하향  ${S(rec.driver_age_lowering)} · 상한 ${S(rec.driver_age_upper_limit)}`);
  console.log(`     연주행    ${S(rec.annual_mileage)}  ※ 매물별 실제 연주행은 시트값을 따른다`);
  console.log(`     보험      대인 ${S(rec.injury_compensation_limit)} · 대물 ${S(rec.property_compensation_limit)} · 자차 ${S(rec.own_damage_compensation)}`);
  console.log(`     결제      ${S(rec.payment_method)} · 보증금분납 ${S(rec.deposit_installment)}`);
  console.log(`\n  붙일 매물 ${targets.length}대\n`);

  if (!apply) { console.log(`※ dry-run. 반영은 --apply\n`); return; }

  await db.ref(`v4/policies/${next}`).set(rec);
  let done = 0;
  const errors: string[] = [];
  for (const [k] of targets) {
    try { await db.ref(`v4/products/${k}`).update({ policy_code: next }); done++; }
    catch (e) { errors.push(`${k}: ${(e as Error)?.message || String(e)}`); }
  }
  console.log(`  정책 ${next} 생성 · 매물 ${done}대 연결`);
  if (errors.length) { console.log(`  ❌ 오류 ${errors.length}건`); for (const e of errors.slice(0, 10)) console.log(`     ${e}`); }
  console.log(`\n끝. 확인: npx tsx scripts/audit-policy-code.mts\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
