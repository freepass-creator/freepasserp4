'use client';
import { useEffect, useMemo, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { ENTITIES, type EntityRecord, type Field } from '@/lib/intake/entities';
import { newId } from '@/lib/domain/ids';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';
import { PART_COLOR, PART_LABEL, POLICY_DOCUMENT_CHECKS } from '@/lib/domain/policy-sheet-layout';
import {
  DOC_CHECK_NAMES, VIRTUAL_DOCS_KEY, partnerPolicyFormParts, virtualDisqKey, virtualDocExtraKey, virtualExtraTermKey,
} from '@/lib/domain/partner-policy-form';
import {
  normalizeEsignRequiredDocuments, serializeEsignRequiredDocuments, type EsignRequiredDocument,
} from '@/lib/domain/esign-required-documents';
import { Btn, C, FS, FW, FormCard, FormGrid, Message, R } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { haptic } from '@/lib/haptics';

/**
 * 파트너사관리 › 운영정책 패널 안에서 **아래로 열리는** 정책 편집기(사장님 2026-08-19).
 *
 * ★왜 이 모양인가
 *   「정책관리 페이지는 없어졌으니 파트너사관리 안에서 등록하게, 그 패널에서 아래로 열리게 · 우리가 준비한 시트에 있는 내용을 반영하면 되는 것」.
 *   그래서 이 폼은 **공급사 운영정책 시트(v2)와 같은 차례·같은 파트·같은 열 이름·같은 드롭다운**이다 —
 *   `policy-sheet-layout.POLICY_SHEET_FIELDS`(열 차례·파트)와 `entities.sheetOpts`(드롭다운)가 정본이라 시트와 화면이 따로 놀 수 없다.
 *   시트 열 → ERP 원자 매핑은 `supplier-template-sheet.POLICY_COLUMN_FIELDS` 하나(시트→ERP 들여오기 도구와 같은 표).
 *
 * ★시트와 다른 두 가지(ERP 원자가 하나라서)
 *   · 불가조건 1~4  → `disqualification_conditions` 하나(「·」로 이음)
 *   · ⑩ 제출서류 체크 6 + 기타서류 → `esign_required_documents`(JSON) 하나 — 전자계약 링크에서 손님에게 첨부를 요청하는 목록
 *
 * 저장 규칙은 정책관리 페이지와 같다(applyPolicyDefaults → store.save+update). 삭제는 목록 줄의 「삭제」가 한다.
 */
const S = (v: unknown) => String(v ?? '').trim();
const DISQ_JOIN = ' · ';
const DOC_CHECK_KEYS = new Set(POLICY_DOCUMENT_CHECKS.map((d) => d.key));

type Virtual = { disq: string[]; docs: string[]; docsExtra: string[]; extraTerms: string[] };

function virtualFrom(policy: EntityRecord | null): Virtual {
  const disqRaw = S(policy?.disqualification_conditions);
  const disq = disqRaw ? disqRaw.split(/\s*[·]\s*/).map((x) => x.trim()).filter(Boolean) : [];
  const docs = normalizeEsignRequiredDocuments(policy?.esign_required_documents ?? policy?.required_documents);
  const checked = docs.filter((d) => DOC_CHECK_KEYS.has(d.key) || DOC_CHECK_NAMES.includes(d.label))
    .map((d) => POLICY_DOCUMENT_CHECKS.find((c) => c.key === d.key || c.name === d.label)!.name);
  const other = docs.filter((d) => !DOC_CHECK_KEYS.has(d.key) && !DOC_CHECK_NAMES.includes(d.label)).map((d) => d.label);
  return {
    disq: [0, 1, 2, 3].map((i) => disq[i] || ''),
    docs: [...new Set(checked)],
    // 체크 밖 서류 — 「필요서류 1~4」 네 칸으로 나눠 담는다(넘치면 마지막 칸에 「·」로 이어 붙인다).
    docsExtra: [0, 1, 2, 3].map((i) => (i === 3 ? other.slice(3).join(DISQ_JOIN) : other[i] || '')),
    // 기타사항 — 계약서 특약 칸에 «한 줄에 하나»로 실리므로 줄 단위로 나눠 담는다(사장님 2026-08-20).
    extraTerms: (() => {
      const lines = S(policy?.policy_extra_terms).split(/\n+/).map((x) => x.trim()).filter(Boolean);
      return [0, 1, 2, 3].map((i) => (i === 3 ? lines.slice(3).join('\n') : lines[i] || ''));
    })(),
  };
}

function documentsOf(v: Virtual): EsignRequiredDocument[] {
  const rows: EsignRequiredDocument[] = POLICY_DOCUMENT_CHECKS
    .filter((d) => v.docs.includes(d.name))
    .map((d) => ({ key: d.key, label: d.name, note: d.note, required: true }));
  v.docsExtra.forEach((cell, i) => {
    cell.split(/[·,/\n]+/).map((x) => x.trim()).filter(Boolean).forEach((label, k) => {
      rows.push({ key: `extra_${i + 1}${k ? `_${k + 1}` : ''}`, label: label.slice(0, 40), note: '', required: true });
    });
  });
  return rows;
}

export function PartnerPolicyEditor({
  providerCode, providerName, policy, onSaved, onCancel,
}: {
  providerCode: string;
  providerName: string;
  /** null = 새 정책 */
  policy: EntityRecord | null;
  onSaved: (saved: EntityRecord) => void;
  onCancel: () => void;
}) {
  const co = getCompanyId();
  const isNew = !policy;
  const [form, setForm] = useState<EntityRecord>({});
  const [virtual, setVirtual] = useState<Virtual>({ disq: ['', '', '', ''], docs: [], docsExtra: ['', '', '', ''], extraTerms: ['', '', '', ''] });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const partFields = useMemo(() => partnerPolicyFormParts(), []);
  const byKey = useMemo(() => Object.fromEntries((ENTITIES.policy?.fields || []).map((f) => [f.key, f])), []);

  useEffect(() => {
    if (policy) {
      setForm({ ...policy });
    } else {
      // 새 정책 — 기본 패키지 값은 채우되 이름은 비워 둔다(사람이 짓는다). 패키지가 붙인 이름(「프리패스 공통 렌트 …」)이 그대로 남으면 목록에서 못 가른다.
      setForm({ ...(applyPolicyDefaults({ policy_code: newId('policy'), provider_company_code: providerCode }).next as EntityRecord), policy_name: '' });
    }
    setVirtual(virtualFrom(policy));
    setDirty(false);
  }, [policy, providerCode]);

  const headFields: Field[] = [
    { ...(byKey.policy_name || { key: 'policy_name', label: '정책명', type: 'text' }), label: '정책명', required: true, manual: true, note: '목록·계약서 작성 화면에서 고르는 이름' },
    { ...(byKey.policy_type || { key: 'policy_type', label: '정책유형', type: 'text' }), label: '정책유형', manual: true },
  ];

  const gridForm: EntityRecord = {
    ...form,
    [virtualDisqKey(0)]: virtual.disq[0], [virtualDisqKey(1)]: virtual.disq[1], [virtualDisqKey(2)]: virtual.disq[2], [virtualDisqKey(3)]: virtual.disq[3],
    [VIRTUAL_DOCS_KEY]: virtual.docs.join(','),
    [virtualDocExtraKey(0)]: virtual.docsExtra[0], [virtualDocExtraKey(1)]: virtual.docsExtra[1],
    [virtualDocExtraKey(2)]: virtual.docsExtra[2], [virtualDocExtraKey(3)]: virtual.docsExtra[3],
    [virtualExtraTermKey(0)]: virtual.extraTerms[0], [virtualExtraTermKey(1)]: virtual.extraTerms[1],
    [virtualExtraTermKey(2)]: virtual.extraTerms[2], [virtualExtraTermKey(3)]: virtual.extraTerms[3],
  };
  const onChange = (key: string, value: string) => {
    setDirty(true);
    if (key.startsWith('__disq_')) {
      const i = Number(key.slice('__disq_'.length));
      setVirtual((v) => ({ ...v, disq: v.disq.map((x, k) => (k === i ? value : x)) }));
      return;
    }
    if (key === VIRTUAL_DOCS_KEY) { setVirtual((v) => ({ ...v, docs: value.split(',').map((x) => x.trim()).filter(Boolean) })); return; }
    if (key.startsWith('__extra_term_')) {
      const i = Number(key.slice('__extra_term_'.length));
      setVirtual((v) => ({ ...v, extraTerms: v.extraTerms.map((x, k) => (k === i ? value : x)) }));
      return;
    }
    if (key.startsWith('__doc_extra_')) {
      const i = Number(key.slice('__doc_extra_'.length));
      setVirtual((v) => ({ ...v, docsExtra: v.docsExtra.map((x, k) => (k === i ? value : x)) }));
      return;
    }
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async () => {
    const code = S(form.policy_code);
    if (!code) { toast('정책코드가 없습니다', 'error'); return; }
    if (!S(form.policy_name)) { toast('정책명을 적어 주세요', 'error'); return; }
    setSaving(true);
    try {
      const disq = virtual.disq.map((x) => x.trim()).filter(Boolean).join(DISQ_JOIN);
      const docs = documentsOf(virtual);
      const merged: EntityRecord = {
        ...form,
        provider_company_code: providerCode,
        disqualification_conditions: disq,
        policy_extra_terms: virtual.extraTerms.map((x) => x.trim()).filter(Boolean).join('\n'),
        esign_required_documents: docs.length ? serializeEsignRequiredDocuments(docs) : '',
      };
      // 정책관리 페이지와 같은 저장 규칙 — 최초 패키지만 자동 보충(명시값·삭제 의사가 기본값보다 우선).
      const patch = applyPolicyDefaults(merged).next as EntityRecord;
      await getStore().save('policy', co, [patch]);
      await getStore().update('policy', co, code, patch);
      haptic.success();
      toast(isNew ? '정책이 등록되었습니다' : '저장되었습니다', 'ok');
      setDirty(false);
      onSaved(patch);
    } catch (e) {
      toast(`저장 실패: ${String((e as Error)?.message || e)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="partner-policy-editor"
      style={{ display: 'grid', gap: 12, padding: '10px 0 4px', borderTop: `2px solid ${C.ink}`, marginTop: 6 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: FS.body, fontWeight: FW.strong, color: C.ink }}>
          {isNew ? '정책 등록' : '정책 수정'} · {providerName}
        </div>
        <span style={{ fontSize: FS.micro, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{S(form.policy_code)}</span>
        <span style={{ fontSize: FS.micro, color: C.faint }}>— 공급사 운영정책 시트와 같은 차례·같은 선택지</span>
      </div>
      <FormGrid fields={headFields} form={gridForm} onChange={onChange} cols={2} />
      {partFields.map(({ part, fields }) => (
        <FormCard
          key={part}
          title={(
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: R, background: `#${PART_COLOR[part]}`, border: `1px solid ${C.line}` }} />
              {PART_LABEL[part]}
            </span>
          )}
        >
          <FormGrid fields={fields} form={gridForm} onChange={onChange} cols={2} />
        </FormCard>
      ))}
      {dirty ? <Message variant="warning">수정 중 · 저장해야 반영됩니다</Message> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn size="sm" variant="ghost" onClick={onCancel} disabled={saving}>취소</Btn>
        <Btn size="sm" onClick={() => void save()} disabled={saving || (!isNew && !dirty)}>{saving ? '저장 중…' : isNew ? '정책 등록' : '저장'}</Btn>
      </div>
    </div>
  );
}
