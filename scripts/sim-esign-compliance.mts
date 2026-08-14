/**
 * 전자계약 법적 요건 점검 — 「빠진 게 없나」를 기계로 센다.
 * ⚠ 구조 점검이지 법률 자문이 아니다. 실계약 전 법률 검토 필요.
 * 실행: npx tsx scripts/sim-esign-compliance.mts
 */
import {
  COMPLIANCE_ITEMS, complianceSummary, openComplianceItems, requiredOpenItems,
} from '../lib/domain/esign-compliance';
import { chakhandealIssuePayload } from '../lib/domain/chakhandeal-esign';
import { ALL_CONSENTS } from '../lib/domain/esign-inputs';
import { KEY_CLAUSES } from '../lib/domain/esign-agreement-emphasis';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};

// ── 점검표 자체 ──
check('항목 키 중복 없음',
  new Set(COMPLIANCE_ITEMS.map((x) => x.key)).size === COMPLIANCE_ITEMS.length);
check('모든 항목에 근거 법령', COMPLIANCE_ITEMS.every((x) => !!x.law));
// 「그냥 하라」가 아니라 못 지키면 무슨 일이 생기는지 적어야 우선순위가 선다.
check('모든 항목에 위반 결과', COMPLIANCE_ITEMS.every((x) => !!x.risk));
check('모든 항목에 담당 위치', COMPLIANCE_ITEMS.every((x) => !!x.coveredBy));

// ── payload 가 실제로 담고 있는가 ──
const contract = {
  contract_code: 'C-1', customer_name: '홍길동', customer_phone: '01012345678',
  car_number_snapshot: '12가3456', rent_month_snapshot: 36, rent_amount_snapshot: 690000,
  deposit_amount_snapshot: 0,
} as unknown as EntityRecord;
const policy = { basic_driver_age: '만 26세이상', injury_compensation_limit: '무한' };
const p = chakhandealIssuePayload(
  { memberCompany: 'freepass', templateId: 'rent_return' }, contract, policy, '회사포함',
) as Record<string, any>;

// 약관규제법 §3① — 전문을 보여줘야 그 약관을 계약 내용으로 주장할 수 있다.
check('§3① 약관 전문이 실린다', p.agreement.sections.length === 28);
check('§3① 통독 강제', p.agreement.requireReadThrough === true);
// §3② — 중요 조항을 강조하지 않으면 그 조항만 계약에서 빠진다(위약금·면책금이 무효화될 수 있다).
check('§3② 중요 조항이 강조된다', p.agreement.sections.filter((s: any) => s.emphasis).length > 0);
check('§3② 강조가 절반 미만', p.agreement.sections.filter((s: any) => s.emphasis).length < 11);
check('§3② 재확인 항목이 있다', (p.keyClauses?.items || []).length === KEY_CLAUSES.length);
check('§3② 재확인 문구가 있다', !!p.keyClauses?.confirmLabel);
// 미납·운전자·사고 — 실제 분쟁이 나는 셋을 다 덮는가.
check('§3② 미납·운전자·사고를 다 덮는다',
  (['미납', '운전자', '사고'] as const).every((r) => KEY_CLAUSES.some((k) => k.risk === r)));

// 개인정보보호법 §15②·§17②·§22⑤
check('§15② 항목·목적·기간이 다 있다',
  ALL_CONSENTS.every((c) => c.items.length > 0 && !!c.purpose && !!c.retention));
check('§17② 제3자 제공에 받는자·목적·항목',
  ALL_CONSENTS.filter((c) => c.recipients).every((c) =>
    (c.recipients || []).every((r) => !!r.name && !!r.purpose && r.items.length > 0)));
check('§22⑤ 거부 시 불이익 고지', ALL_CONSENTS.every((c) => !!c.refusalNote));
// 선택 동의(마케팅)를 필수와 묶으면 끼워넣기 동의로 전체가 무효가 될 수 있다.
check('§22① 마케팅 동의가 섞여 있지 않다',
  !ALL_CONSENTS.some((c) => /마케팅|광고|홍보/.test(c.label + c.purpose)),
  ALL_CONSENTS.map((c) => c.label));
check('동의가 payload 에 실린다', Array.isArray(p.consentAtoms) && p.consentAtoms.length > 0);

// 전자문서법 §5 — 판을 안 남기면 문구를 고친 뒤 「그때 뭐였나」를 못 댄다.
check('약관 판이 실린다', !!p.agreement.version);
check('양식 판이 실린다', !!p.templateId);

// PII 경계 — 우리가 보내는 건 이름·생년·연락처뿐이다.
const serialized = JSON.stringify(p);
const payloadKeys = new Set<string>();
const collectKeys = (value: unknown) => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach(collectKeys);
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    payloadKeys.add(key);
    collectKeys(nested);
  }
};
collectKeys(p);
check('주민번호를 보내지 않는다',
  ![...payloadKeys].some((key) => /residentNumber|jumin|^ssn$|customer_id/i.test(key))
  && !/\d{6}-?\d{7}/.test(serialized));
check('signer 는 3항목뿐', Object.keys(p.signer).every((k) => ['name', 'phone', 'birth'].includes(k)),
  Object.keys(p.signer));

// ── 미구현을 숨기지 않는가 ──
const open = openComplianceItems();
const reqOpen = requiredOpenItems();
const sum = complianceSummary();
check('요약이 맞는다', sum.total === COMPLIANCE_ITEMS.length && sum.covered + sum.open === sum.total, sum);
check('미구현이 세어진다', open.length > 0, open.map((x) => x.title));
check('미구현은 전부 ⚠ 표시', open.every((x) => x.coveredBy.includes('⚠')));

console.log('\n── 미구현 ──');
for (const x of open) console.log(`   [${x.level}] ${x.law.padEnd(18)} ${x.title} — ${x.coveredBy.replace('⚠ ', '')}`);
console.log(`\n── 요약 ── 총 ${sum.total} · 충족 ${sum.covered} · 미구현 ${sum.open}(필수 ${sum.requiredOpen})`);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
