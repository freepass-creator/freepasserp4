'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Btn, C, R, FS, FW } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';

export type DevTool = {
  key: string;
  label: string;
  /** 목록에서 한 줄로 무엇을 하는 도구인지 */
  hint: string;
  render: () => ReactNode;
};

/**
 * 개발도구 작업대 — 왼쪽 1/4 목록, 오른쪽 3/4 도구 화면.
 *
 * 도구가 늘어날수록 한 장짜리 세로 스크롤은 «어디에 뭐가 있는지»를 잃는다. 목록을 고정해
 * 두면 무엇이 있는지가 항상 보이고, 도구는 넓은 칸에서 표를 그대로 펼칠 수 있다 —
 * 동기화 미리보기처럼 엑셀 화면을 그대로 띄워야 하는 도구가 좁은 칸에서는 못 산다.
 *
 * 고른 도구는 주소(`?tool=`)에 남긴다. 새로고침·뒤로가기로 돌아오고, 링크로 공유된다.
 * 모바일은 분할하지 않는다 — 1/4 칸이 200px 도 안 되면 목록이 아니라 장애물이다.
 */
export function DevWorkbench({ tools, storageKey = 'fp4_dev_tool' }: { tools: DevTool[]; storageKey?: string }) {
  const mobile = useIsMobile();
  const [active, setActive] = useState<string>(tools[0]?.key || '');

  // 첫 페인트 뒤에 주소·저장값을 읽는다(SSR 불일치 방지).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromUrl = new URLSearchParams(window.location.search).get('tool') || '';
    const saved = fromUrl || localStorage.getItem(storageKey) || '';
    if (saved && tools.some((t) => t.key === saved)) setActive(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (key: string) => {
    setActive(key);
    if (typeof window === 'undefined') return;
    localStorage.setItem(storageKey, key);
    const url = new URL(window.location.href);
    url.searchParams.set('tool', key);
    window.history.replaceState(null, '', url.toString());
  };

  const current = tools.find((t) => t.key === active) || tools[0];

  const list = (
    <nav
      aria-label="개발도구 목록"
      style={{
        display: 'flex',
        flexDirection: mobile ? 'row' : 'column',
        gap: 2,
        overflowX: mobile ? 'auto' : undefined,
        overflowY: mobile ? undefined : 'auto',
        border: `1px solid ${C.line}`,
        borderRadius: R,
        background: C.taupeBg,
        padding: 6,
        // 모바일은 가로 칩 줄, 데스크톱은 좌측 고정 기둥.
        position: mobile ? undefined : 'sticky',
        top: mobile ? undefined : 12,
        maxHeight: mobile ? undefined : 'calc(100vh - 120px)',
      }}
    >
      {tools.map((t) => {
        const on = t.key === current?.key;
        return (
          <Btn
            key={t.key}
            size="sm"
            variant={on ? 'solid' : 'ghost'}
            title={t.hint}
            onClick={() => pick(t.key)}
            style={{
              justifyContent: 'flex-start',
              textAlign: 'left',
              height: 'auto',
              padding: mobile ? '7px 11px' : '9px 11px',
              whiteSpace: mobile ? 'nowrap' : 'normal',
              flex: mobile ? '0 0 auto' : undefined,
              minWidth: 0,
              boxShadow: 'none',
              ...(on ? {} : { border: 'none', background: 'transparent' }),
            }}
          >
            <span style={{ display: 'block', minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: on ? FW.title : FW.body }}>{t.label}</span>
              {!mobile && (
                <span style={{ display: 'block', marginTop: 2, fontSize: FS.cap, color: on ? C.inverse : C.faint, fontWeight: FW.body, lineHeight: 1.4, opacity: on ? 0.85 : 1 }}>
                  {t.hint}
                </span>
              )}
            </span>
          </Btn>
        );
      })}
    </nav>
  );

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list}
        <div style={{ minWidth: 0 }}>{current?.render()}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 1fr) 3fr', gap: 12, alignItems: 'start' }}>
      {list}
      {/* minWidth 0 이 없으면 넓은 표가 그리드 칸을 밀어내 좌측 목록이 찌그러진다. */}
      <div style={{ minWidth: 0 }}>{current?.render()}</div>
    </div>
  );
}
