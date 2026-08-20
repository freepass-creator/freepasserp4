'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Smartphone } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { actor, getRole } from '@/lib/domain/deal';
import { guestShareUrl } from '@/lib/domain/product-share';
import { vehicleName } from '@/lib/domain/product';
import { copyText } from '@/lib/clipboard';
import { toast } from '@/components/Toaster';
import { Btn, Modal, C, FS, FW, ICON, R } from '@/components/ui';

/** 손님 폰 화면 프레임 폭·높이 — 일반 폰 논리 해상도(390×780). 스크롤은 프레임 안에서. */
const FRAME_W = 390;
const FRAME_H = 720;

/**
 * **「손님 화면」 미리보기 — 영업자가 손님에게 보낼 /q 링크를 폰 프레임으로 미리 본다 + 링크 복사.**
 *
 * ★왜(사장님 2026-08-18 · Gemini 「DriveDirect PRO」 샘플의 「손님 모바일 화면 미리보기」 반영):
 *   지금도 「손님 전달」이 링크를 복사하지만, 영업자는 손님이 **무엇을 보게 되는지** 확인할 데가 없었다.
 *   같은 출처의 /q 를 iframe 으로 띄운다(귀속 ?a= 포함 · /q 는 공개면이라 로그인 없이 뜬다). 새 데이터·새 화면 없음.
 * ⚠ 웹에서만 — 모바일은 링크를 그냥 열면 그게 손님 화면이다.
 * ⚠ 하단독(sticky/transform) 안에서 쓰이므로 모달은 body 로 포털한다 — 안 그러면 fixed 가 독 안에 갇혀 안 보인다.
 */
export function CustomerPreviewButton({ p, full }: { p: EntityRecord; full?: boolean }) {
  const [open, setOpen] = useState(false);
  const a = actor(getRole());
  const url = guestShareUrl(p, a.code || a.uid);
  const copy = () => { void copyText(url).then((ok) => toast(ok ? '손님용 매물 링크 복사됨' : '링크를 복사하지 못했습니다', ok ? 'ok' : 'error')); };
  return (
    <>
      <Btn title="손님 화면 미리보기" variant="ghost" size={full ? 'md' : 'sm'} full={full} onClick={() => setOpen(true)}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: full ? 6 : 5 }}>
          <Smartphone size={ICON.md} aria-hidden />
          {full ? '손님 화면으로 보기' : '손님 화면'}
        </span>
      </Btn>
      {open && typeof document !== 'undefined' && createPortal(
        <Modal
          title="손님 화면 미리보기"
          meta={<span style={{ fontSize: FS.cap, color: C.mute }}>{vehicleName(p)} · 손님이 링크를 열면 이렇게 보입니다</span>}
          onClose={() => setOpen(false)}
          width={FRAME_W + 96}
          footer={(
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%' }}>
              <span style={{ fontSize: FS.cap, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{url}</span>
              <span style={{ display: 'inline-flex', gap: 6, flex: '0 0 auto' }}>
                <Btn size="sm" variant="ghost" onClick={copy}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Copy size={ICON.sm} aria-hidden />링크 복사</span></Btn>
                <Btn size="sm" onClick={() => setOpen(false)}>닫기</Btn>
              </span>
            </div>
          )}
        >
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
            <div style={{
              width: FRAME_W, height: FRAME_H, boxSizing: 'content-box',
              border: `8px solid ${C.ink}`, borderRadius: R * 6, overflow: 'hidden', background: C.bg,
            }}>
              <iframe title="손님 화면" src={url} style={{ width: '100%', height: '100%', border: 0, display: 'block', background: C.bg }} />
            </div>
          </div>
          <div style={{ fontSize: FS.cap, color: C.faint, textAlign: 'center', padding: '4px 0 8px', fontWeight: FW.meta }}>실제 손님 화면과 같은 주소(/q)입니다 · 로그인 없이 열립니다</div>
        </Modal>,
        document.body,
      )}
    </>
  );
}
