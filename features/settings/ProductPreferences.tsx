'use client';

import type { HiddenSnap } from '@/lib/product-hide';
import type { PassSnap } from '@/lib/product-pass';
import { clearFavs, clearRecent } from '@/lib/product-interest';
import { clearHidden, unhideProduct } from '@/lib/product-hide';
import { clearPassed, unpassProduct } from '@/lib/product-pass';
import { haptic } from '@/lib/haptics';
import { toast } from '@/components/Toaster';
import { Btn, C, DetailGrid, FS, ListRow, NUM, SectionLabel } from '@/components/ui';
import { Eye, RotateCcw, Trash2 } from 'lucide-react';

function ManagedProducts({ title, emptyText, rows, action, actionLabel, clear, clearLabel }: {
  title: string;
  emptyText: string;
  rows: (HiddenSnap | PassSnap)[];
  action: (code: string) => void;
  actionLabel: string;
  clear: () => void;
  clearLabel: string;
}) {
  return (
    <div>
      <SectionLabel mt={0}>{title}{rows.length ? ` · ${rows.length}` : ''}</SectionLabel>
      {!rows.length ? (
        <div style={{ padding: '10px 0 4px', fontSize: FS.body, color: C.faint, lineHeight: 1.45 }}>{emptyText}</div>
      ) : (
        <>
          {rows.map((row) => (
            <ListRow
              key={row.code}
              main={row.name || row.code}
              sub={row.plate ? <span style={{ fontFamily: NUM }}>{row.plate}</span> : undefined}
              right={<Btn mobileIcon={<Eye size={18} />} title={actionLabel} size="sm" variant="ghost" onClick={() => { haptic.select(); action(row.code); }}>{actionLabel}</Btn>}
            />
          ))}
          <div style={{ paddingTop: 8 }}>
            <Btn mobileIcon={<RotateCcw size={18} />} title={clearLabel} size="sm" variant="ghost" onClick={() => { haptic.impact(); clear(); }}>{clearLabel}</Btn>
          </div>
        </>
      )}
    </div>
  );
}

export function ProductPreferences({ recentCount, favoriteCount, passed, hidden }: {
  recentCount: number;
  favoriteCount: number;
  passed: PassSnap[];
  hidden: HiddenSnap[];
}) {
  return (
    <>
      <div>
        <SectionLabel mt={0}>관심함{recentCount + favoriteCount ? ` · ${recentCount + favoriteCount}` : ''}</SectionLabel>
        <DetailGrid rows={[['최근 본', `${recentCount}건`], ['찜', `${favoriteCount}건`]]} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <Btn mobileIcon={<Trash2 size={18} />} title="최근 본 비우기" size="sm" variant="ghost" disabled={!recentCount} onClick={() => { haptic.impact(); clearRecent(); toast('최근 본을 비웠습니다', 'info'); }}>최근 비우기</Btn>
          <Btn mobileIcon={<Trash2 size={18} />} title="찜 비우기" size="sm" variant="ghost" disabled={!favoriteCount} onClick={() => { haptic.impact(); clearFavs(); toast('찜을 비웠습니다', 'info'); }}>찜 비우기</Btn>
        </div>
      </div>
      <ManagedProducts title="관심없음" emptyText="「관심없음」한 상품은 목록 맨 뒤로 보냅니다." rows={passed}
        action={(code) => { unpassProduct(code); toast('다시 앞쪽에 표시합니다', 'ok'); }} actionLabel="앞으로"
        clear={() => { clearPassed(); toast('관심없음을 모두 해제했습니다', 'info'); }} clearLabel="전체 앞으로" />
      <ManagedProducts title="숨긴 상품" emptyText="「숨기기」한 상품은 목록에서 빠집니다. 여기서 다시 볼 수 있어요." rows={hidden}
        action={(code) => { unhideProduct(code); toast('다시 목록에 표시됩니다', 'ok'); }} actionLabel="보이기"
        clear={() => { clearHidden(); toast('숨긴 상품을 모두 해제했습니다', 'info'); }} clearLabel="전체 보이기" />
    </>
  );
}
