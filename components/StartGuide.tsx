'use client';

import { useEffect, useState } from 'react';
import { Modal, Btn, C, FS, FW, R } from '@/components/ui';
import { startGuideFor, startGuideSeenKey } from '@/lib/domain/onboarding';

/**
 * 시작안내 — 첫 로그인 1회, 이후엔 필요할 때만.
 *
 * 전에는 범용 확인창(`confirmDialog`)을 빌려 한 문장을 띄웠다. 좁은 확인 박스에
 * 두 문장을 `\n` 으로 밀어 넣어 줄이 어색하게 끊겼다 — 안내는 확인창이 아니다.
 * 여기서는 문장을 단계로 쪼개 «개행 자체를 없앤다». 줄바꿈은 폭이 정하게 둔다.
 *
 * B2B 화면이라 조밀하게 간다 — 큰 히어로·삽화 없이 번호와 한 줄 설명만.
 */
export function StartGuide({
  role, open, onClose,
}: {
  role: string | null | undefined;
  open: boolean;
  onClose: (dontShowAgain: boolean) => void;
}) {
  const g = startGuideFor(role);
  if (!open) return null;

  return (
    <Modal
      open={open}
      title="시작안내"
      meta={g.headline}
      width={520}
      onClose={() => onClose(false)}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <Btn size="sm" variant="ghost" onClick={() => onClose(false)}>나중에</Btn>
          <Btn size="sm" onClick={() => onClose(true)}>다시 안 보기</Btn>
        </div>
      }
    >
      <ol style={{ listStyle: 'none', margin: 0, padding: '4px 0', display: 'grid', gap: 2 }}>
        {g.steps.map((s, i) => (
          <li
            key={s.title}
            style={{
              display: 'grid', gridTemplateColumns: '22px 1fr', gap: 10,
              alignItems: 'start', padding: '8px 12px',
              background: i % 2 ? C.zebra : undefined,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 22, height: 22, borderRadius: R, background: C.brand, color: C.inverse,
                fontSize: FS.cap, fontWeight: FW.head, display: 'grid', placeItems: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {i + 1}
            </span>
            <span style={{ minWidth: 0 }}>
              <b style={{ fontSize: FS.body, fontWeight: FW.title, color: C.ink }}>{s.title}</b>
              <span style={{ display: 'block', marginTop: 2, fontSize: FS.sub, lineHeight: 1.6, color: C.mute }}>
                {s.desc}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {g.footer ? (
        <div style={{ padding: '10px 12px 2px', fontSize: FS.cap, color: C.faint, borderTop: `1px solid ${C.line2}`, marginTop: 6 }}>
          {g.footer}
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * 첫 로그인 1회 자동 노출 — 역할이 정해진 뒤에 뜬다.
 * 역할을 모른 채 띄우면 영업자 안내가 공급사에게 가는 사고가 난다.
 */
export function useStartGuide(role: string | null | undefined, ready: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || !role) return;
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(startGuideSeenKey(role))) return;
    setOpen(true);
  }, [ready, role]);

  const close = (dontShowAgain: boolean) => {
    setOpen(false);
    if (dontShowAgain && typeof window !== 'undefined' && role) {
      localStorage.setItem(startGuideSeenKey(role), '1');
    }
  };

  return { open, close, show: () => setOpen(true) };
}
