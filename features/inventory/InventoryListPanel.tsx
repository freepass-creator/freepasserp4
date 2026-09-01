'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { InventoryCreateRow, InventoryListRow } from '@/components/list-rows';
import { Btn, CenterNote, ListMoreBar } from '@/components/ui';
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
    rows, limit, selectedCode, creating, hasConditions,
    onSelect, onCreate, onClearConditions, onLimitChange,
  } = model;
  const shown = rows.slice(0, limit);

  return (
    <div>
      <InventoryCreateRow selected={creating} onClick={creating ? () => {} : onCreate} />
      {rows.length === 0 ? (
        <CenterNote>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span>{hasConditions ? '검색 결과 없음' : '상품 없음'}</span>
            {hasConditions ? <Btn title="조건 해제" size="sm" variant="ghost" onClick={onClearConditions}>조건 해제</Btn> : null}
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
          <ListMoreBar
            shown={shown.length}
            total={rows.length}
            unit="대"
            pageSize={PAGE}
            onMore={() => onLimitChange((current) => current + PAGE)}
            onShowAll={() => {
              if (rows.length > PAGE_HARD) {
                onLimitChange(PAGE_HARD);
                toast(`성능상 ${PAGE_HARD.toLocaleString()}대까지 표시합니다. 검색·필터로 좁혀주세요.`, 'info');
              } else {
                onLimitChange(rows.length);
              }
            }}
          />
        </>
      )}
    </div>
  );
}
