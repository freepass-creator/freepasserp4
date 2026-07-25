'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { InventoryCreateRow, InventoryListRow } from '@/components/list-rows';
import { Btn, C, CenterNote, FS } from '@/components/ui';
import { toast } from '@/components/Toaster';

const PAGE = 100;
const PAGE_HARD = 500;

export type InventoryListPanelModel = {
  rows: EntityRecord[];
  limit: number;
  selectedCode: string | null;
  creating: boolean;
  draft: EntityRecord;
  hasConditions: boolean;
  onSelect: (product: EntityRecord) => void;
  onCreate: () => void;
  onClearConditions: () => void;
  onLimitChange: (limit: number | ((current: number) => number)) => void;
};

export function InventoryListPanel({ model }: { model: InventoryListPanelModel }) {
  const {
    rows, limit, selectedCode, creating, draft, hasConditions,
    onSelect, onCreate, onClearConditions, onLimitChange,
  } = model;
  const shown = rows.slice(0, limit);
  const remaining = Math.max(0, rows.length - limit);
  const draftFillsSlot = creating
    && !!selectedCode
    && String(draft.product_code || '') === selectedCode;

  return (
    <div>
      {draftFillsSlot
        ? <InventoryListRow p={draft} selected onClick={onSelect} />
        : <InventoryCreateRow onClick={onCreate} />}
      {rows.length === 0 ? (
        <CenterNote>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span>{hasConditions ? '검색 결과 없음' : '상품 없음'}</span>
            {hasConditions ? <Btn size="sm" variant="ghost" onClick={onClearConditions}>조건 해제</Btn> : null}
          </div>
        </CenterNote>
      ) : (
        <>
          {shown.map((product) => (
            <InventoryListRow
              key={String(product.product_code)}
              p={product}
              selected={String(product.product_code) === selectedCode}
              onClick={onSelect}
            />
          ))}
          {remaining > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              flexWrap: 'wrap', padding: '12px 14px', borderTop: `1px solid ${C.line2}`,
            }}>
              <span style={{ fontSize: FS.sub, color: C.mute }}>
                {shown.length.toLocaleString()} / {rows.length.toLocaleString()}대
              </span>
              <Btn variant="ghost" size="sm" onClick={() => onLimitChange((current) => current + PAGE)}>
                더보기 · {Math.min(PAGE, remaining).toLocaleString()}대
              </Btn>
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (rows.length > PAGE_HARD) {
                    onLimitChange(PAGE_HARD);
                    toast(`성능상 ${PAGE_HARD.toLocaleString()}대까지 표시합니다. 검색·필터로 좁혀주세요.`, 'info');
                  } else {
                    onLimitChange(rows.length);
                  }
                }}
              >
                전체 보기
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}
