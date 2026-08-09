/**
 * 원자 수집 규칙 회귀검증 — 「금액을 바꾸는 값은 손님에게 묻지 않는다」가 핵심.
 * 실행: npx tsx scripts/sim-esign-inputs.mts
 */
import {
  ADDITIONAL_DRIVER_INPUTS, ADMIN_INPUTS, ALL_CONSENTS, ALL_INPUTS, BANK_CONSENTS,
  BUSINESS_INPUTS, CONTRACT_CONSENTS, CUSTOMER_INPUTS, PRICE_AFFECTING_INPUTS,
  adminInputsFor, customerInputGroupsFor, customerInputsFor, isFilled, missingBeforeIssue,
  pendingConsents,
} from '../lib/domain/esign-inputs';
import { chakhandealIssuePayload } from '../lib/domain/chakhandeal-esign';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};
const r = (o: Record<string, unknown>) => o as unknown as EntityRecord;

const base = r({
  contract_code: 'C-1', customer_name: '홍길동', customer_phone: '01012345678',
  car_number_snapshot: '12가3456', rent_month_snapshot: 36, rent_amount_snapshot: 690000,
  deposit_amount_snapshot: 0,
});

// ── 불변식: 금액을 바꾸는 값은 약정에서만 ──
check('금액 항목은 stage=약정', PRICE_AFFECTING_INPUTS.every((f) => f.stage === '약정'));
check('약정 항목은 전부 금액 항목', ALL_INPUTS.filter((f) => f.stage === '약정').every((f) => f.affectsPrice));
check('손님 항목엔 금액 항목이 없다', CUSTOMER_INPUTS.every((f) => !f.affectsPrice));
check('관리자 항목엔 금액 항목이 없다', ADMIN_INPUTS.every((f) => !f.affectsPrice));
// ★가장 위험한 지점 — 운전자범위가 손님 화면에 뜨면 [개인특약] 선택이 동결 금액과 어긋난다.
check('운전자범위는 손님에게 안 묻는다',
  !customerInputsFor(base).some((f) => f.key === 'driver_scope'),
  customerInputsFor(base).map((f) => f.key));
check('추가운전자 지정 여부도 손님에게 안 묻는다',
  !customerInputsFor(base).some((f) => f.key === 'additional_driver'));

// ── 손님에게 물을 것 ──
const askedKeys = customerInputsFor(base).map((f) => f.key);
check('가족 연락처·관계·자동이체일은 묻는다',
  ['emergency_contact', 'emergency_relation', 'auto_debit_day'].every((k) => askedKeys.includes(k)), askedKeys);
check('개인이면 사업자 항목 안 묻는다', !askedKeys.some((k) => k.startsWith('biz_')));
check('추가운전자 미지정이면 그 항목 안 묻는다', !askedKeys.some((k) => k.startsWith('add_driver_')));

const biz = r({ ...base, customer_type: '개인사업자' });
check('개인사업자면 사업자 3항목을 묻는다',
  BUSINESS_INPUTS.every((f) => customerInputsFor(biz).some((x) => x.key === f.key)));

const withDriver = r({ ...base, esign_inputs: { additional_driver: '1인 지정' } });
check('추가운전자 지정이면 인적사항을 묻는다',
  ADDITIONAL_DRIVER_INPUTS.every((f) => customerInputsFor(withDriver).some((x) => x.key === f.key)));
// 주민번호·면허번호는 착한거래 본인확인이 받는다 — 우리가 폼으로 받으면 PII 면적이 는다.
check('추가운전자 주민번호·면허번호는 안 묻는다',
  !customerInputsFor(withDriver).some((f) => /jumin|resident|license/i.test(f.key)));

// ── 이미 채워진 건 다시 안 묻는다 ──
const filled = r({ ...base, esign_inputs: { emergency_contact: '01099998888' } });
check('저장된 입력값을 채워진 것으로 본다', isFilled(filled, 'emergency_contact'));
check('채워진 항목은 다시 안 묻는다',
  !customerInputsFor(filled).some((f) => f.key === 'emergency_contact'));
// 계약 본체에 있는 값도 채워진 것으로 본다 — 같은 걸 두 번 묻지 않게.
check('계약 본체 값도 채워진 것으로 본다', isFilled(r({ ...base, auto_debit_day: '10일' }), 'auto_debit_day'));

// ── 관리자 입력 ──
const rentReturn = r({ ...base, esign_template_id: 'rent_return' });
const rentBuyout = r({ ...base, esign_template_id: 'rent_buyout' });
check('반납형은 인수가격을 안 묻는다',
  !adminInputsFor(rentReturn).some((f) => f.key === 'buyout_price'),
  adminInputsFor(rentReturn).map((f) => f.key));
check('인수형은 인수가격을 묻는다',
  adminInputsFor(rentBuyout).some((f) => f.key === 'buyout_price'));
check('관리자가 넣은 뒤엔 안 묻는다',
  !adminInputsFor(r({ ...rentBuyout, esign_inputs: { buyout_price: '만기협의' } })).some((f) => f.key === 'buyout_price'));

// ── 발송 전 차단 ──
const gate = missingBeforeIssue(base);
check('운전자범위 미정이면 발송 차단', gate.blocking.some((f) => f.key === 'driver_scope'), gate.blocking.map((f) => f.key));
check('차단 목록은 금액·관리자 항목뿐', gate.blocking.every((f) => f.stage !== '손님'));
check('손님에게 물을 필수 항목이 따로 나온다', gate.askCustomer.length > 0 && gate.askCustomer.every((f) => f.required));
const ready = r({ ...base, esign_inputs: { driver_scope: '[개인기본1] 계약자와 배우자 및 직계가족' } });
check('운전자범위가 정해지면 차단 해제', !missingBeforeIssue(ready).blocking.some((f) => f.key === 'driver_scope'));

// ── payload 에 실리는지 ──
const payload = chakhandealIssuePayload(
  { memberCompany: 'freepass', templateId: 'rent_return' }, base, {}, '회사포함',
);
const reqs = payload.inputRequests as { key: string; affectsPrice: boolean }[];
check('inputRequests 가 실린다', Array.isArray(reqs) && reqs.length > 0);
check('payload 에도 금액 항목은 없다', reqs.every((f) => !f.affectsPrice), reqs.map((f) => f.key));

// ── 출금계좌(CMS) — 우리 방식 ──
const bankKeys = customerInputsFor(base).filter((f) => f.group === 'bank').map((f) => f.key);
check('출금계좌는 늘 받는다', bankKeys.length > 0, bankKeys);
check('은행·계좌·예금주·생년월일·연락처·이체일',
  ['cms_bank', 'cms_account_no', 'cms_holder', 'cms_holder_birth', 'cms_holder_phone', 'auto_debit_day']
    .every((k) => bankKeys.includes(k)), bankKeys);
// 종이 신청서엔 수납업체·대표자·사업자번호·주소 칸이 있지만 전부 우리 회사 정보다 — 손님이 쓸 이유가 없다.
check('회사 정보는 손님에게 안 묻는다',
  !ALL_INPUTS.some((f) => /수납|대표자|company|agency/i.test(f.key + f.label)));

// ── 동의 원자 — 라벨만으론 유효하지 않다 ──
check('동의는 조회·수집·이용을 다 적는다',
  BANK_CONSENTS.some((c) => c.label === '개인정보 조회·수집·이용 동의'),
  BANK_CONSENTS.map((c) => c.label));
check('신용정보도 조회·수집·이용', CONTRACT_CONSENTS[0].label.includes('조회·수집·이용'));
// 개인정보보호법 §15·§17 — 항목·목적·보유기간이 없으면 동의가 유효하지 않다.
check('모든 동의에 항목이 있다', ALL_CONSENTS.every((c) => c.items.length > 0));
check('모든 동의에 목적이 있다', ALL_CONSENTS.every((c) => !!c.purpose));
check('모든 동의에 보유기간이 있다', ALL_CONSENTS.every((c) => !!c.retention));
// 거부 시 불이익을 안 적으면 «거부할 수 없는 동의»가 된다.
check('모든 동의에 거부 안내가 있다', ALL_CONSENTS.every((c) => !!c.refusalNote));
// 제3자 제공은 «받는 자»가 없으면 무효다.
const thirdParty = BANK_CONSENTS.find((c) => c.key === 'cms_consent_third_party')!;
check('제3자 제공은 받는 자를 적는다', (thirdParty.recipients || []).length > 0);
check('받는 자마다 목적·항목이 있다',
  (thirdParty.recipients || []).every((r) => !!r.name && !!r.purpose && r.items.length > 0));
check('제3자 제공 아닌 동의엔 받는 자가 없다',
  ALL_CONSENTS.filter((c) => c.key !== 'cms_consent_third_party').every((c) => !c.recipients));
check('이미 동의한 건 다시 안 묻는다',
  !pendingConsents(r({ ...base, esign_consents: { cms_consent_use: 1 } })).some((c) => c.key === 'cms_consent_use'));

// ── 묶음별 화면 ──
const igroups = customerInputGroupsFor(base);
check('묶음이 나온다', igroups.length > 0, igroups.map((g) => `${g.title}:${g.fields.length}+${g.consents.length}`));
check('출금계좌 묶음에 동의 2건이 붙는다',
  igroups.find((g) => g.key === 'bank')!.consents.length === 2);
check('빈 묶음은 안 만든다', igroups.every((g) => g.fields.length > 0 || g.consents.length > 0));
check('개인이면 사업자 묶음 없다', !igroups.some((g) => g.key === 'business'));

const payload2 = chakhandealIssuePayload(
  { memberCompany: 'freepass', templateId: 'rent_return' }, base, {}, '회사포함',
) as Record<string, unknown>;
check('payload 에 inputGroups 가 실린다', Array.isArray(payload2.inputGroups));
check('payload 에 consentAtoms 가 실린다', Array.isArray(payload2.consentAtoms));

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
