'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ConsultPanel } from '@/components/ConsultPanel';
import { BottomSheet } from '@/components/BottomSheet';
import { C, IconBtn, ICON, SH, ctrlPadX } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { ensureConsultRoom, type ConsultApp } from '@/lib/domain/deal';
import { MessageCircle } from 'lucide-react';

/** 상담을 열 수 없을 때 패널에 그대로 보여줄 문구. 빈 화면을 남기지 않는다. */
const BLOCK_NOTE: Record<string, { text: string; variant: 'info' | 'warning' }> = {
  signin: { text: '로그인하면 상담을 시작할 수 있습니다.', variant: 'info' },
  pending: { text: '가입 승인 후 상담을 이용할 수 있습니다.', variant: 'warning' },
  provider: { text: '이 상담은 «계약문의»에서 확인·답변하실 수 있습니다.', variant: 'info' },
  failed: { text: '상담방을 열지 못했습니다. 잠시 후 다시 시도해 주세요.', variant: 'warning' },
};

/**
 * 견적기 iframe(왼쪽) + 상담 패널(오른쪽 320 / 모바일 하단시트).
 * children = EmbeddedApp. 견적기 안에 erp4 를 다시 iframe 하지 말 것.
 * 진입 시 ensureConsultRoom → roomId 를 ConsultPanel 에 전달.
 *   영업자·관리자 모두 상담방을 연다(3자 구조). 공급사 본인만 열지 않는다.
 */
export function ConsultLayout({
  app,
  children,
}: {
  app: ConsultApp;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [block, setBlock] = useState<string | null>(null);
  const pad = ctrlPadX(mobile);

  useEffect(() => {
    let cancelled = false;
    setRoomId(null); setBlock(null);
    (async () => {
      try {
        const r = await ensureConsultRoom(app);
        if (cancelled) return;
        if (typeof r === 'string') setRoomId(r);
        else setBlock(r.reason);            // signin / pending / provider
      } catch (e) {
        console.error('상담방 보장 실패:', e);
        if (!cancelled) setBlock('failed');
      }
    })();
    return () => { cancelled = true; };
  }, [app]);

  const panel = (
    <ConsultPanel
      app={app}
      roomId={roomId}
      fill={!!mobile}
      note={block ? BLOCK_NOTE[block] : null}
      // 모바일 시트에서만 헤더(이전) — 데스크탑은 패널이 상시 노출이라 돌아갈 곳이 없다
      onBack={mobile ? () => setSheetOpen(false) : undefined}
    />
  );

  if (mobile) {
    return (
      <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
        {/* ⚠ 시트가 열린 동안에는 감춘다 — 안 그러면 이 버튼이 시트 위에 남아
            채팅 입력행의 «전송» 버튼을 덮는다(2026-08-06 실측). */}
        {!sheetOpen && (
          <IconBtn
            title="상담"
            onClick={() => setSheetOpen(true)}
            style={{
              position: 'fixed',
              right: pad,
              bottom: `calc(var(--fp-bar-h, 56px) + ${pad}px)`,
              zIndex: 30,
              background: C.brand,
              color: C.inverse,
              border: `1px solid ${C.brand}`,
              boxShadow: SH.dock,
            }}
          >
            <MessageCircle size={ICON.lg} aria-hidden />
          </IconBtn>
        )}
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="상담"
          footer="std"
          pad={false}
          maxHeight="min(86vh, 720px)"
          fixedHeight
        >
          <div style={{ height: 'min(78vh, 640px)', minHeight: 360, display: 'flex', flexDirection: 'column' }}>
            {panel}
          </div>
        </BottomSheet>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
      <div style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      {panel}
    </div>
  );
}
