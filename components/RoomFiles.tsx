'use client';
import { useCallback, useEffect, useState } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { listMessages } from '@/lib/domain/messaging';
import { msgClock } from '@/lib/format';
import { C, R, FS, FW, ICON, CloseBtn, SCRIM } from '@/components/ui';
import { Paperclip } from 'lucide-react';

/**
 * 이 방에 첨부된 파일 목록 — 상세 옆 보조패널의 «파일» 칸.
 *
 * 첨부는 대화창에서 한다(보내기). 여기는 **모아 보는 자리**다 —
 * 계약 하나에 등록증·신분증·사업자등록증·계약서가 오가는데 대화 흐름에 흩어지면
 * 출고 직전에 못 찾는다. 저장하는 게 아니라 이미 있는 메시지를 걸러 세울 뿐이다.
 *
 * 사진은 눌러서 크게 보고, 문서는 새 탭으로 연다(같은 탭이면 작업화면을 벗어난다).
 */
export function RoomFiles({ roomId, onCount }: { roomId: string; onCount?: (n: number) => void }) {
  const [items, setItems] = useState<EntityRecord[] | undefined>(undefined);
  const [view, setView] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!roomId) { setItems([]); onCount?.(0); return; }
    const msgs = await listMessages(roomId);
    // 최신이 위 — 서류를 찾을 땐 방금 받은 것부터 본다.
    const files = msgs.filter((m) => m.image_url || m.file_url).reverse();
    setItems(files);
    onCount?.(files.length); // 칸 제목의 개수 — 같은 조회를 두 번 하지 않으려고 여기서 알린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    let alive = true;
    setItems(undefined);
    void load().catch(() => { if (alive) setItems([]); });
    // 첨부가 올라오면 messaging 이 fp:unread 를 쏜다 — 그때만 다시 읽는다(폴링 추가 없음).
    const on = () => { void load().catch(() => {}); };
    window.addEventListener('fp:unread', on);
    window.addEventListener('focus', on);
    return () => {
      alive = false;
      window.removeEventListener('fp:unread', on);
      window.removeEventListener('focus', on);
    };
  }, [load]);

  useEffect(() => {
    if (!view) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setView(null); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [view]);

  if (items === undefined) return <div style={{ padding: '10px 12px', fontSize: FS.cap, color: C.faint }}>불러오는 중…</div>;
  if (!items.length) {
    return (
      <div style={{ padding: '10px 12px', fontSize: FS.cap, color: C.faint, lineHeight: 1.5 }}>
        아직 첨부한 파일이 없습니다.
        <br />
        대화창에 끌어다 놓거나 «첨부»로 보내면 여기 모입니다.
      </div>
    );
  }

  return (
    <>
      {items.map((m) => {
        const isImg = !!m.image_url;
        const url = String(m.image_url || m.file_url || '');
        const name = String(m.file_name || (isImg ? '사진' : '파일'));
        const meta = [String(m.sender_name || ''), msgClock(m.created_at)].filter(Boolean).join(' · ');
        const rowStyle = {
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box' as const,
          padding: '5px 10px', border: 'none', borderBottom: `1px solid ${C.line2}`, background: 'none',
          cursor: 'pointer', textAlign: 'left' as const, textDecoration: 'none', color: C.ink,
        };
        const inner = (
          <>
            {isImg ? (
              <img
                src={url}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ flex: '0 0 auto', width: ICON.xl, height: ICON.xl, objectFit: 'cover', borderRadius: R, border: `1px solid ${C.line}` }}
              />
            ) : (
              <span style={{ flex: '0 0 auto', width: ICON.xl, height: ICON.xl, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: R, border: `1px solid ${C.line}`, color: C.mute }}>
                <Paperclip size={ICON.sm} aria-hidden />
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: FS.sub, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <span style={{ fontSize: FS.micro, color: C.faint, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
            </span>
          </>
        );
        return isImg ? (
          <button key={String(m._key)} type="button" className="fp-press" onClick={() => setView(url)} title={`${name} 크게보기`} style={rowStyle}>
            {inner}
          </button>
        ) : (
          <a key={String(m._key)} className="fp-press" href={url} download={name} target="_blank" rel="noreferrer" title={`${name} 열기`} style={rowStyle}>
            {inner}
          </a>
        );
      })}

      {view ? (
        <div
          onClick={() => setView(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 80, background: SCRIM.black, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <CloseBtn
            title="닫기"
            onClick={(e) => { e.stopPropagation(); setView(null); }}
            style={{
              position: 'fixed', top: 14, right: 14, width: 40, height: 40, borderRadius: '50%',
              border: 'none', background: `color-mix(in srgb, ${C.inverse} 18%, transparent)`, color: C.inverse,
            }}
          />
          <img
            src={view}
            alt=""
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: R }}
          />
        </div>
      ) : null}
    </>
  );
}
