/**
 * 파트너사관리 인라인 정책 편집기 ↔ 공급사 운영정책 시트(v2) — «동일한가»를 기계로 대조한다(사장님 2026-08-19 「엑셀 운영정책이랑 동일하게 맞췄어?」).
 *   ① 열 차례: 폼이 덮는 시트 열 이름의 차례 == 시트 머리글(정책코드·정책명 제외)
 *   ② 드롭다운: 폼 select 의 선택지 == 시트 드롭다운(policy-value-spec.allowed)
 *   ③ 종류: 글자 칸(불가조건 1~4·특이사항·기타서류)은 text · 제출서류는 칩(체크) 6 · 시트 열마다 폼 칸이 있다
 *   ④ 원자 값 규격: 프리패스 기본 정책(POLICY_DEFAULTS)이 select 선택지 안의 글자다(숫자 아님)
 */
import assert from 'node:assert/strict';
import { partnerPolicyFormParts, partnerPolicyFormSheetNames, DOC_CHECK_NAMES, VIRTUAL_DOCS_KEY } from '../lib/domain/partner-policy-form';
import { POLICY_SHEET_FIELDS, POLICY_KEY_COLUMNS, policySheetHeader } from '../lib/domain/policy-sheet-layout';
import { POLICY_VALUE_RULE_BY_NAME } from '../lib/domain/policy-value-spec';
import { POLICY_DEFAULTS, applyPolicyDefaults } from '../lib/domain/policy-defaults';
import { POLICY_COLUMN_FIELDS } from '../lib/domain/supplier-template-sheet';

const sheetNames = policySheetHeader().slice(POLICY_KEY_COLUMNS.length);
const formNames = partnerPolicyFormSheetNames();

// ① 차례 — 시트 열 하나하나가 같은 자리에
assert.deepEqual(formNames, sheetNames, `폼 차례 ≠ 시트 차례\n폼: ${formNames.join(' | ')}\n시트: ${sheetNames.join(' | ')}`);

// ② 드롭다운 — 시트에 목록이 있는 열은 폼도 같은 목록(칩·체크 제외)
const parts = partnerPolicyFormParts();
const fields = parts.flatMap((p) => p.fields);
let selects = 0;
for (const f of fields) {
  if (f.key === VIRTUAL_DOCS_KEY) { assert.deepEqual(f.options, DOC_CHECK_NAMES); continue; }
  const rule = POLICY_VALUE_RULE_BY_NAME[f.label];
  if (!rule) continue;
  if (rule.kind === 'text' || rule.kind === 'check') { assert.equal(f.type, 'text', `${f.label}: 글자 칸이어야`); continue; }
  if (rule.allowed.length) {
    assert.equal(f.type, 'select', `${f.label}: 시트는 드롭다운인데 폼은 ${f.type}`);
    assert.deepEqual(f.options, rule.allowed, `${f.label}: 선택지가 시트와 다르다\n폼: ${(f.options || []).join('/')}\n시트: ${rule.allowed.join('/')}`);
    selects++;
  }
}
assert.ok(selects >= 40, `select 칸이 너무 적다 ${selects}`);

// ③ 파트 = 시트 파트 · 시트 열마다 매핑(불가조건·서류는 가상 키)
const partOrder = [...new Set(POLICY_SHEET_FIELDS.map((f) => f.part))];
assert.deepEqual(parts.map((p) => p.part), partOrder);
const mapped = new Set(POLICY_COLUMN_FIELDS.map((c) => c.name));
for (const sf of POLICY_SHEET_FIELDS) {
  const virtualOk = /^불가조건 \d$/.test(sf.name) || DOC_CHECK_NAMES.includes(sf.name) || sf.name === '기타서류';
  assert.ok(mapped.has(sf.name) || virtualOk, `시트 열 「${sf.name}」 이 ERP 원자에 안 붙어 있다`);
}

// ④ 프리패스 기본 정책 값 = select 선택지 글자(숫자로 남은 것 없음)
const byKey = new Map(fields.map((f) => [f.key, f]));
for (const d of POLICY_DEFAULTS) {
  const f = byKey.get(d.key);
  if (!f || f.type !== 'select' || d.value == null || d.value === '') continue;
  assert.equal(typeof d.value, 'string', `${d.key} 기본값이 숫자(${String(d.value)}) — 시트 규격 글자여야`);
  assert.ok((f.options || []).includes(String(d.value)), `${d.key} 기본값 「${String(d.value)}」 이 선택지에 없다`);
}
const common = applyPolicyDefaults({ policy_code: 'SIM' }).next;
assert.equal(common.deposit_return_days, '7일');
assert.equal(common.over_mileage_rate_domestic, '200원');

console.log(`✓ 파트너사관리 정책 편집기 = 운영정책 시트: 열 ${sheetNames.length}개 같은 차례 · 드롭다운 ${selects}칸 같은 목록 · 파트 ${parts.length}`);
