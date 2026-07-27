'use client';

import { useEffect, useState } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { MemberCreateRow, MemberListRow } from '@/components/list-rows';
import { Btn, C, CenterNote, FS } from '@/components/ui';
import { toast } from '@/components/Toaster';
import type { MemberTab } from './member-filter';
import { List, Plus, RotateCcw } from 'lucide-react';

const PAGE = 100;
const PAGE_HARD = 500;

export function MembersList({
  tab, rows, selected, creating, draft, filtered,
  onSelect, onCreate, onClearConditions,
}: {
  tab: MemberTab;
  rows: EntityRecord[];
  selected: string | null;
  creating: boolean;
  draft: EntityRecord;
  filtered: boolean;
  onSelect: (row: EntityRecord) => void;
  onCreate: () => void;
  onClearConditions: () => void;
}) {
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    setLimit(PAGE);
  }, [tab, rows.length]);

  const shown = rows.slice(0, limit);
  const remaining = Math.max(0, rows.length - limit);
  const draftFillsSlot = creating && selected === 'new';

  return (
    <>
      {draftFillsSlot ? (
        <MemberListRow row={draft} kind={tab} selected />
      ) : (
        <MemberCreateRow kind={tab} onClick={onCreate} />
      )}
      {!rows.length ? (
        <CenterNote>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span>{filtered ? '검색 결과 없음' : `${tab === 'user' ? '사용자' : '파트너'} 없음`}</span>
            {filtered ? <Btn mobileIcon={<RotateCcw size={18} />} title="조건 해제" size="sm" variant="ghost" onClick={onClearConditions}>조건 해제</Btn> : null}
          </div>
        </CenterNote>
      ) : (
        <>
          {shown.map((row) => {
            const key = String(row._key || (tab === 'user' ? row.uid || row.user_code : row.partner_code));
            return (
              <MemberListRow
                key={key}
                row={row}
                kind={tab}
                selected={key === selected}
                onClick={() => onSelect(row)}
              />
            );
          })}
          {remaining > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              flexWrap: 'wrap', padding: '12px 14px', borderTop: `1px solid ${C.line2}`,
            }}>
              <span style={{ fontSize: FS.sub, color: C.mute }}>
                {shown.length.toLocaleString()} / {rows.length.toLocaleString()}명
              </span>
              <Btn mobileIcon={<Plus size={18} />} title={`더보기 ${Math.min(PAGE, remaining)}명`} variant="ghost" size="sm" onClick={() => setLimit((current) => current + PAGE)}>
                더보기 · {Math.min(PAGE, remaining).toLocaleString()}명
              </Btn>
              <Btn
                mobileIcon={<List size={18} />}
                title={`전체 ${rows.length}명 보기`}
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (rows.length > PAGE_HARD) {
                    setLimit(PAGE_HARD);
                    toast(`성능상 ${PAGE_HARD.toLocaleString()}명까지 표시합니다. 검색·필터로 좁혀주세요.`, 'info');
                  } else {
                    setLimit(rows.length);
                  }
                }}
              >
                전체 보기
              </Btn>
            </div>
          )}
        </>
      )}
    </>
  );
}
