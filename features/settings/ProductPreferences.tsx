'use client';

import type { HiddenSnap } from '@/lib/product-hide';
import type { PassSnap } from '@/lib/product-pass';
import { clearFavs, clearRecent } from '@/lib/product-interest';
import { clearHidden, unhideProduct } from '@/lib/product-hide';
import { clearPassed, unpassProduct } from '@/lib/product-pass';
import { toast } from '@/components/Toaster';
import { Btn, C, DetailGrid, FS, ListGroup, ListRow, NUM, SectionLabel } from '@/components/ui';

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
        <div style={{ padding: '10px 0 4px', fontSize: FS.sub, color: C.faint, lineHeight: 1.45 }}>{emptyText}</div>
      ) : (
        <>
          {rows.map((row) => (
            <ListRow
              key={row.code}
              main={row.name || row.code}
              sub={row.plate ? <span style={{ fontFamily: NUM }}>{row.plate}</span> : undefined}
              right={<Btn title={actionLabel} size="sm" variant="ghost" haptic="select" onClick={() => { action(row.code); }}>{actionLabel}</Btn>}
            />
          ))}
          <div style={{ paddingTop: 8 }}>
            <Btn title={clearLabel} size="sm" variant="ghost" haptic="impact" onClick={() => { clear(); }}>{clearLabel}</Btn>
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
        {/* DetailGrid 는 카드 안 규격(행 좌우 12) — 카드 없이 두면 라벨만 안으로 밀려 섹션 제목과 어긋난다. */}
        <ListGroup>
          <DetailGrid rows={[['최근 본', `${recentCount}건`], ['찜', `${favoriteCount}건`]]} />
        </ListGroup>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <Btn title="최근 본 비우기" size="sm" variant="ghost" haptic="impact" disabled={!recentCount} onClick={() => { clearRecent(); toast('최근 본을 비웠습니다', 'info'); }}>최근 비우기</Btn>
          <Btn title="찜 비우기" size="sm" variant="ghost" haptic="impact" disabled={!favoriteCount} onClick={() => { clearFavs(); toast('찜을 비웠습니다', 'info'); }}>찜 비우기</Btn>
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
