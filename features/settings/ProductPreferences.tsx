'use client';

import type { HiddenSnap } from '@/lib/product-hide';
import type { PassSnap } from '@/lib/product-pass';
import { clearFavs, clearRecent } from '@/lib/product-interest';
import { clearHidden, unhideProduct } from '@/lib/product-hide';
import { clearPassed, unpassProduct } from '@/lib/product-pass';
import { toast } from '@/components/Toaster';
import { Btn, ButtonLabel, C, DetailGrid, FS, ListGroup, ListRow, NUM, SectionLabel, ICON } from '@/components/ui';
import { History, RotateCcw, StarOff, Trash2 } from 'lucide-react';

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
              sub={row.plate ? <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{row.plate}</span> : undefined}
              right={(
                <Btn title={actionLabel} size="sm" variant="ghost" haptic="select" onClick={() => { action(row.code); }}>
                  <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>{actionLabel}</ButtonLabel>
                </Btn>
              )}
            />
          ))}
          <div style={{ paddingTop: 8 }}>
            <Btn title={clearLabel} size="sm" variant="ghost" haptic="impact" onClick={() => { clear(); }}>
              <ButtonLabel icon={<Trash2 size={ICON.md} aria-hidden />}>{clearLabel}</ButtonLabel>
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}

export function ProductPreferences({ recentCount, favoriteCount, passed, hidden, showInterest = true }: {
  recentCount: number;
  favoriteCount: number;
  passed: PassSnap[];
  hidden: HiddenSnap[];
  /** 관심함(최근·관심 수+비우기) 블록 — **모바일은 끈다**(하단탭 「내가본상품」이 같은 걸 더 잘 한다, 2026-08-22 중복 정리). */
  showInterest?: boolean;
}) {
  return (
    <>
      {showInterest ? (
      <div>
        <SectionLabel mt={0}>관심함{recentCount + favoriteCount ? ` · ${recentCount + favoriteCount}` : ''}</SectionLabel>
        {/* DetailGrid 는 카드 안 규격(행 좌우 12) — 카드 없이 두면 라벨만 안으로 밀려 섹션 제목과 어긋난다. */}
        <ListGroup>
          <DetailGrid rows={[['최근', `${recentCount}건`], ['관심', `${favoriteCount}건`]]} />
        </ListGroup>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <Btn title="최근 비우기" size="sm" variant="ghost" haptic="impact" disabled={!recentCount} onClick={() => { clearRecent(); toast('최근 목록을 비웠습니다', 'info'); }}>
            <ButtonLabel icon={<History size={ICON.md} aria-hidden />}>최근 비우기</ButtonLabel>
          </Btn>
          <Btn title="관심 비우기" size="sm" variant="ghost" haptic="impact" disabled={!favoriteCount} onClick={() => { clearFavs(); toast('관심을 비웠습니다', 'info'); }}>
            <ButtonLabel icon={<StarOff size={ICON.md} aria-hidden />}>관심 비우기</ButtonLabel>
          </Btn>
        </div>
      </div>
      ) : null}
      <ManagedProducts title="관심없음" emptyText="「관심없음」한 상품은 목록 맨 뒤로 보냅니다." rows={passed}
        action={(code) => { unpassProduct(code); toast('다시 앞쪽에 표시합니다', 'ok'); }} actionLabel="앞으로"
        clear={() => { clearPassed(); toast('관심없음을 모두 해제했습니다', 'info'); }} clearLabel="전체 앞으로" />
      <ManagedProducts title="숨긴 상품" emptyText="「숨기기」한 상품은 목록에서 빠집니다. 여기서 다시 볼 수 있어요." rows={hidden}
        action={(code) => { unhideProduct(code); toast('다시 목록에 표시됩니다', 'ok'); }} actionLabel="보이기"
        clear={() => { clearHidden(); toast('숨긴 상품을 모두 해제했습니다', 'info'); }} clearLabel="전체 보이기" />
    </>
  );
}
