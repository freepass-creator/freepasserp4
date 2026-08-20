/**
 * 파트너사관리 › 운영정책 인라인 편집기의 **폼 정의** — 공급사 운영정책 시트(v2)와 같은 파트·차례·열 이름·드롭다운.
 *
 * ★정본은 셋이고 여기는 그걸 «엮기만» 한다(사장님 2026-08-19 「우리가 준비한 시트 내용을 반영」).
 *   · 열 차례·파트   `policy-sheet-layout.POLICY_SHEET_FIELDS`
 *   · 시트 열 → ERP 원자 `supplier-template-sheet.POLICY_COLUMN_FIELDS`
 *   · 입력 종류·선택지  `entities.ENTITIES.policy`(sheetOpts = policy-value-spec.allowed)
 *   그래서 시트를 고치면 폼이 따라오고, 둘이 갈리면 `sim-partner-policy-form` 이 잡는다.
 *
 * ★시트와 다른 두 가지(ERP 원자가 하나라서) — 가상 키(`__…`)로 받아 저장 때 접는다
 *   · 불가조건 1~4  → `__disq_0..3` → disqualification_conditions 하나(「·」)
 *   · ⑩ 제출서류 체크 6 → `__docs`(칩, 「,」로 이음) · 필요서류 1~4 → `__doc_extra_0..3` → esign_required_documents(JSON)
 */
import { ENTITIES, type Field } from '@/lib/intake/entities';
import {
  POLICY_DISQUALIFICATION_COLUMNS, POLICY_DOCUMENT_CHECKS, POLICY_DOCUMENT_EXTRA_COLUMNS, POLICY_EXTRA_TERM_COLUMNS, POLICY_SHEET_FIELDS, type PolicyPart,
} from './policy-sheet-layout';
import { POLICY_COLUMN_FIELDS } from './supplier-template-sheet';

export const DOC_CHECK_NAMES = POLICY_DOCUMENT_CHECKS.map((d) => d.name);
export const VIRTUAL_DOCS_KEY = '__docs';
export const virtualDocExtraKey = (i: number) => `__doc_extra_${i}`;
export const virtualExtraTermKey = (i: number) => `__extra_term_${i}`;
export const virtualDisqKey = (i: number) => `__disq_${i}`;

export type PartnerPolicyFormPart = { part: PolicyPart; fields: Field[] };

/** 시트 파트별 폼 정의 — 라벨은 시트 열 이름 그대로, 입력 종류·선택지는 ERP 원자 그대로. */
export function partnerPolicyFormParts(): PartnerPolicyFormPart[] {
  const byKey = Object.fromEntries((ENTITIES.policy?.fields || []).map((f) => [f.key, f]));
  const nameToKey = new Map(POLICY_COLUMN_FIELDS.map((c) => [c.name, c.field]));
  const parts: PolicyPart[] = [];
  for (const f of POLICY_SHEET_FIELDS) if (!parts.includes(f.part)) parts.push(f.part);
  return parts.map((part) => {
    const fields: Field[] = [];
    let docsAdded = false;
    for (const sf of POLICY_SHEET_FIELDS.filter((x) => x.part === part)) {
      const disqIndex = (POLICY_DISQUALIFICATION_COLUMNS as readonly string[]).indexOf(sf.name);
      if (disqIndex >= 0) { fields.push({ key: virtualDisqKey(disqIndex), label: sf.name, type: 'text', manual: true, note: sf.note }); continue; }
      if (DOC_CHECK_NAMES.includes(sf.name)) {
        if (!docsAdded) { fields.push({ key: VIRTUAL_DOCS_KEY, label: '제출서류 (체크)', type: 'chips', options: [...DOC_CHECK_NAMES], manual: true, note: '체크한 서류를 전자계약 링크에서 손님에게 첨부 요청' }); docsAdded = true; }
        continue;
      }
      const termIndex = (POLICY_EXTRA_TERM_COLUMNS as readonly string[]).indexOf(sf.name);
      if (termIndex >= 0) { fields.push({ key: virtualExtraTermKey(termIndex), label: sf.name, type: 'text', manual: true, note: sf.note }); continue; }
      const extraIndex = (POLICY_DOCUMENT_EXTRA_COLUMNS as readonly string[]).indexOf(sf.name);
      if (extraIndex >= 0) { fields.push({ key: virtualDocExtraKey(extraIndex), label: sf.name, type: 'text', manual: true, note: sf.note }); continue; }
      const key = nameToKey.get(sf.name);
      const ef = key ? byKey[key] : undefined;
      if (!ef) continue;
      fields.push({ ...ef, label: sf.name, note: sf.note, required: false, manual: true });
    }
    return { part, fields };
  }).filter((x) => x.fields.length);
}

/** 폼이 시트 열을 어떤 차례로 덮는가 — 칩(제출서류 6)은 시트 열 6개로 펼친다. 시트 머리글과 대조하는 sim 이 쓴다. */
export function partnerPolicyFormSheetNames(): string[] {
  return partnerPolicyFormParts().flatMap((p) => p.fields.flatMap((f) => (f.key === VIRTUAL_DOCS_KEY ? [...DOC_CHECK_NAMES] : [f.label])));
}
