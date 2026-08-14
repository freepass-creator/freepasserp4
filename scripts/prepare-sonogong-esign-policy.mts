/**
 * 손오공 렌트(POL-0046)를 프리패스 전자계약 발송 정책으로 준비한다.
 *
 * 기본은 dry-run이며 `--apply`일 때만 v4/policies/POL-0046을 PATCH한다.
 * 구독(POL-0020)과 v3 운영 노드는 수정하지 않는다.
 *
 * 근거
 * - 손오공 실제 체결계약서(161허1169, 2026-04): AXA, 대인 무한, 대물 2억,
 *   대인·대물 면책 30만원, 자차 차량가액·수리비 20%·50만~100만원, 긴급출동 5회
 * - 프리패스 확정값(2026-08): 자손 사망·후유 3천/부상 1,500, 무보험 미가입,
 *   지연손해금 24%, 승계수수료 100만원, 표준 약관 정책값
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { applyPolicyDefaults, FREEPASS_POLICY_PACK } from '@/lib/domain/policy-defaults';
import { canIssueContract } from '@/lib/domain/policy-tier';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const POLICY_KEY = 'POL-0046';
const S = (value: unknown) => String(value ?? '').trim();

const CONFIRMED: Record<string, unknown> = {
  policy_name: '손오공 표준 렌트 · 보험료 포함',
  policy_type: '중고렌트',
  provider_company_code: 'RP012',
  contract_authoring: '프리패스가 작성',
  insurance_included: '보험료 포함',
  insurer_name: 'AXA손해보험(차량별 가입처 상이)',
  injury_compensation_limit: '무한',
  injury_deductible: '30만원',
  property_compensation_limit: '2억원',
  property_deductible: '30만원',
  self_body_accident: '사망·후유장애 1인당 3천만원 · 부상 1인당 1,500만원',
  self_body_deductible: '없음',
  uninsured_damage: '미가입',
  uninsured_deductible: '없음',
  own_damage_compensation: '차량가액',
  own_damage_repair_ratio: '20%',
  own_damage_min_deductible: '50만원',
  own_damage_max_deductible: '100만원',
  annual_roadside_assistance: '연간 5회',
  payment_timing: '선불',
  late_fee_rate: 0.24,
  succession_fee: 1_000_000,
  policy_default_pack: FREEPASS_POLICY_PACK,
};

async function main() {
  const apply = process.argv.includes('--apply');
  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = (await jwt.getAccessToken()).token;
  const url = `${DB}/v4/policies/${POLICY_KEY}.json?access_token=${token}`;
  const read = async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`정책 읽기 실패 ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return (await response.json()) as Record<string, unknown> | null;
  };

  const current = await read();
  if (!current) throw new Error(`${POLICY_KEY} 정책을 찾지 못했습니다.`);
  if (S(current.provider_company_code) !== 'RP012') throw new Error(`${POLICY_KEY}는 손오공(RP012) 정책이 아닙니다.`);
  if (!/렌트/.test(S(current.policy_name))) throw new Error(`${POLICY_KEY}가 렌트 정책인지 확인할 수 없습니다.`);

  const standard = applyPolicyDefaults(current).next;
  const desired = { ...standard, ...CONFIRMED };
  const patch = Object.fromEntries(Object.entries(desired).filter(([key, value]) => {
    return JSON.stringify(current[key] ?? null) !== JSON.stringify(value ?? null);
  }));
  const gate = canIssueContract(desired);

  console.log(`\n손오공 전자계약 정책 ${apply ? '반영' : '미리보기'} — ${POLICY_KEY}`);
  console.log(`현재: ${S(current.policy_name)} → 변경 후: ${S(desired.policy_name)}`);
  console.log(`변경 ${Object.keys(patch).length}개`);
  for (const [key, value] of Object.entries(patch)) {
    console.log(`  ${key.padEnd(36)} ${JSON.stringify(current[key] ?? '')} → ${JSON.stringify(value)}`);
  }
  console.log(`발송 게이트: ${gate.ok ? 'PASS' : `BLOCK — ${gate.missing.map((field) => field.label).join(' · ')}`}`);
  if (!gate.ok) throw new Error('발송 필수값이 남아 있어 반영하지 않습니다.');
  if (!apply) {
    console.log('\n※ dry-run입니다. 확인 후 --apply로 반영합니다.\n');
    return;
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`정책 반영 실패 ${response.status}: ${(await response.text()).slice(0, 200)}`);

  const saved = await read();
  const savedGate = canIssueContract(saved);
  if (!savedGate.ok) throw new Error(`반영 후 재검증 실패: ${savedGate.missing.map((field) => field.label).join(' · ')}`);
  console.log(`\n반영 완료 · 재조회 발송 게이트 PASS · ${S(saved?.policy_name)}\n`);
}

main().catch((error) => {
  console.error(`\n실패 — ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
