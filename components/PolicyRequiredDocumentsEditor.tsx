'use client';

import { FilePlus2, Trash2 } from 'lucide-react';
import { Btn, ButtonLabel, ICON, WorkInput, WorkRow, WorkSplit, WorkTable } from '@/components/ui';
import {
  ESIGN_DOCUMENT_PRESETS,
  MAX_ESIGN_REQUIRED_DOCUMENTS,
  esignDocumentPreset,
  normalizeEsignRequiredDocuments,
  serializeEsignRequiredDocuments,
  type EsignRequiredDocument,
} from '@/lib/domain/esign-required-documents';

export function PolicyRequiredDocumentsEditor({
  value,
  disabled,
  onChange,
}: {
  value: unknown;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const documents = normalizeEsignRequiredDocuments(value);
  const commit = (next: EsignRequiredDocument[]) => onChange(serializeEsignRequiredDocuments(next));
  const update = (index: number, patch: Partial<EsignRequiredDocument>) => {
    commit(documents.map((row, slot) => slot === index ? { ...row, ...patch } : row));
  };
  const add = () => {
    if (documents.length >= MAX_ESIGN_REQUIRED_DOCUMENTS) return;
    commit([...documents, {
      key: `custom_${Date.now().toString(36)}`,
      label: '추가 제출서류',
      note: '',
      required: true,
    }]);
  };

  return (
    <WorkTable
      title="고객 추가 제출서류"
      hint="이 정책으로 계약할 때 고객에게 실제로 받을 서류만 정합니다. 운전면허증과 본인 셀카는 별도로 항상 받습니다."
    >
      {!disabled ? (
        <WorkRow label="묶음 적용">
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {ESIGN_DOCUMENT_PRESETS.map((preset) => (
              <Btn key={preset.key} title={`${preset.label} 서류 묶음 적용`} size="sm" variant="ghost" onClick={() => commit(esignDocumentPreset(preset.key))}>
                {preset.label}
              </Btn>
            ))}
            <Btn title="추가 제출서류 모두 비우기" size="sm" variant="ghost" onClick={() => commit([])}>없음</Btn>
          </div>
        </WorkRow>
      ) : null}
      {documents.length ? documents.flatMap((document, index) => {
        const split = documents.length > 1 ? [<WorkSplit key={`${document.key}-split`} label={`${index + 1}`} />] : [];
        if (disabled) {
          return [
            ...split,
            <WorkRow key={`${document.key}-name`} label="서류명">{document.label}</WorkRow>,
            <WorkRow key={`${document.key}-req`} label="구분">{document.required ? '필수' : '선택'}</WorkRow>,
            ...(document.note ? [<WorkRow key={`${document.key}-note`} label="안내">{document.note}</WorkRow>] : []),
          ];
        }
        return [
          ...split,
          <WorkRow key={`${document.key}-name`} label="서류명"><WorkInput value={document.label} onChange={(next) => { if (next.trim()) update(index, { label: next }); }} /></WorkRow>,
          <WorkRow key={`${document.key}-note`} label="고객 안내"><WorkInput value={document.note} onChange={(next) => update(index, { note: next })} /></WorkRow>,
          <WorkRow key={`${document.key}-req`} label="구분">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Btn title={document.required ? '필수 서류' : '선택 서류'} size="sm" variant={document.required ? 'solid' : 'ghost'} onClick={() => update(index, { required: !document.required })}>
                {document.required ? '필수' : '선택'}
              </Btn>
              <Btn title={`${document.label} 삭제`} size="sm" variant="ghost" onClick={() => commit(documents.filter((_, slot) => slot !== index))}>
                <Trash2 size={ICON.sm} aria-hidden />
              </Btn>
            </div>
          </WorkRow>,
        ];
      }) : (
        <WorkRow label="목록">추가 제출서류 없음</WorkRow>
      )}
      {!disabled ? (
        <WorkRow label="추가">
          <Btn title="제출서류 한 칸 추가" size="sm" variant="ghost" disabled={documents.length >= MAX_ESIGN_REQUIRED_DOCUMENTS} onClick={add}>
            <ButtonLabel icon={<FilePlus2 size={ICON.sm} aria-hidden />}>
              {documents.length >= MAX_ESIGN_REQUIRED_DOCUMENTS ? `최대 ${MAX_ESIGN_REQUIRED_DOCUMENTS}개` : '서류 추가'}
            </ButtonLabel>
          </Btn>
        </WorkRow>
      ) : null}
    </WorkTable>
  );
}
