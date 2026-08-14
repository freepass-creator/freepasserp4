/**
 * 모든 운영 공급사에 수정 가능한 「프리패스 공통 렌트」 정책 복사본을 배정한다.
 *
 * - 기본은 dry-run. `--apply` 때만 v4/policies를 쓴다.
 * - v3는 공급사 목록을 찾기 위해 읽기만 하고 절대 쓰지 않는다.
 * - 기존 업체별 정책은 건드리지 않는다.
 * - 이미 만든 공통 복사본의 업체 수정값은 유지하고, 없는 공급사만 새로 만든다.
 * - 상품 policy_code도 건드리지 않는다. 전자계약 화면은 provider_company_code로 연동한다.
 *
 * 사용:
 *   npx tsx scripts/apply-freepass-common-supplier-policies.mts
 *   npx tsx scripts/apply-freepass-common-supplier-policies.mts --code=RP012
 *   npx tsx scripts/apply-freepass-common-supplier-policies.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { POLICY_DEFAULTS, FREEPASS_POLICY_PACK } from '@/lib/domain/policy-defaults';
import { canIssueContract } from '@/lib/domain/policy-tier';

type Rec = Record<string, unknown>;

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const S = (value: unknown) => String(value ?? '').trim();
const dead = (row: Rec | null | undefined) => row?._deleted === true || /deleted|폐업|종료/i.test(S(row?.status));
const commonCode = (providerCode: string) => `FP-${providerCode.toUpperCase()}-RENT`;

const DEFAULT_RECORD = Object.fromEntries(
  POLICY_DEFAULTS.filter((item) => item.value !== null).map((item) => [item.key, item.value]),
);

const partnerCode = (row: Rec, key: string) => S(row.partner_code || row.company_code || row.provider_company_code || key).toUpperCase();
const partnerName = (row: Rec, code: string) => S(row.name || row.partner_name || row.company_name || row.corp_name) || code;

async function main() {
  const apply = process.argv.includes('--apply');
  const onlyCode = S((process.argv.find((arg) => arg.startsWith('--code=')) || '').split('=')[1]).toUpperCase();
  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = (await jwt.getAccessToken()).token;
  const readPath = async (path: string): Promise<Record<string, Rec>> => {
    const response = await fetch(`${DB}/${path}.json?access_token=${token}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${path} 읽기 실패 ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return (await response.json()) || {};
  };

  const [legacyPartners, v4Partners, policies] = await Promise.all([
    readPath('partners'),
    readPath('v4/partners'),
    readPath('v4/policies'),
  ]);

  const suppliers = new Map<string, Rec>();
  for (const [key, row] of [...Object.entries(legacyPartners), ...Object.entries(v4Partners)]) {
    if (dead(row)) continue;
    const code = partnerCode(row, key);
    if (!/^RP\d+$/i.test(code)) continue;
    if (onlyCode && code !== onlyCode) continue;
    suppliers.set(code, { ...(suppliers.get(code) || {}), ...row });
  }
  if (onlyCode && !suppliers.has(onlyCode)) throw new Error(`${onlyCode} 공급사를 찾지 못했습니다.`);
  if (!suppliers.size) throw new Error('배정할 운영 공급사가 없습니다.');

  const now = Date.now();
  const writes: Record<string, Rec> = {};
  const blocked: string[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  console.log(`\n프리패스 공통 렌트 정책 공급사 배정 — ${apply ? '반영' : '미리보기(dry-run)'}`);
  console.log(`패키지: ${FREEPASS_POLICY_PACK} · 공급사 ${suppliers.size}곳\n`);

  for (const [code, partner] of [...suppliers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const key = commonCode(code);
    const existing = policies[key] && !dead(policies[key]) ? policies[key] : null;
    const name = partnerName(partner, code);
    const policyName = `${name} · 프리패스 공통 렌트`;
    const candidate: Rec = {
      ...DEFAULT_RECORD,
      ...(existing || {}),
      _key: key,
      policy_code: key,
      term_code: key,
      policy_name: policyName,
      term_name: policyName,
      provider_company_code: code,
      policy_type: S(existing?.policy_type) || '중고렌트',
      policy_default_pack: FREEPASS_POLICY_PACK,
      is_freepass_common_policy: true,
      policy_scope: 'supplier-default',
      created_at: existing?.created_at || now,
      created_by: existing?.created_by || 'codex:freepass-common-policy',
    };
    const changed = !existing || Object.entries(candidate).some(([field, value]) => (
      JSON.stringify(existing[field] ?? null) !== JSON.stringify(value ?? null)
    ));
    const desired: Rec = changed
      ? { ...candidate, updated_at: now, updated_by: 'codex:freepass-common-policy' }
      : existing!;
    const gate = canIssueContract(desired);
    if (!gate.ok) {
      blocked.push(`${code} ${name}: ${gate.missing.map((field) => field.label).join(' · ') || gate.reason}`);
      continue;
    }
    if (changed) writes[key] = desired;
    if (!existing) created += 1;
    else if (changed) updated += 1;
    else unchanged += 1;
    const action = !existing ? '신규 배정' : changed ? '기본값 보완' : '변경 없음';
    console.log(`  ${action}  ${code} ${name} → ${key} · 발송 PASS`);
  }

  console.log(`\n신규 ${created} · 보완 ${updated} · 변경 없음 ${unchanged} · 차단 ${blocked.length}`);
  if (blocked.length) {
    for (const item of blocked) console.log(`  차단  ${item}`);
    throw new Error('발송 필수값이 비어 있는 공급사가 있어 아무것도 반영하지 않습니다.');
  }
  if (!apply) {
    console.log('\n※ 기존 업체별 정책과 상품 연결은 그대로입니다. 확인 후 --apply로 v4/policies에만 반영합니다.\n');
    return;
  }

  if (!Object.keys(writes).length) {
    console.log('\n이미 최신 상태입니다. 운영 데이터 쓰기 없이 종료합니다.\n');
    return;
  }

  const response = await fetch(`${DB}/v4/policies.json?access_token=${token}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(writes),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`공통 정책 반영 실패 ${response.status}: ${(await response.text()).slice(0, 300)}`);

  const saved = await readPath('v4/policies');
  const failures = Object.keys(writes).filter((key) => {
    const row = saved[key];
    return !row || S(row.policy_default_pack) !== FREEPASS_POLICY_PACK || !canIssueContract(row).ok;
  });
  if (failures.length) throw new Error(`반영 후 재검증 실패: ${failures.join(', ')}`);
  console.log(`\n반영 완료 · ${Object.keys(writes).length}개 공급사 복사본 재조회 및 전자계약 발송 게이트 PASS\n`);
}

main().catch((error) => {
  console.error(`\n실패 — ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
