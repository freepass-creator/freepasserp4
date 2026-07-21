'use client';
import { useEffect, useState } from 'react';
import { C, R, Btn } from '@/components/ui';

// 전역 토스트 + 확인 다이얼로그 프리미티브(erp3 showToast/customConfirm 이식).
// 어디서든 toast('저장됨','ok') / await confirmDialog({message:'삭제할까요?', danger:true}). <Toaster/>는 layout에 1회 마운트.
export type ToastType = 'info' | 'ok' | 'error';
type Toast = { id: number; msg: string; type: ToastType };
type ConfirmReq = { id: number; title?: string; message: string; danger?: boolean; okLabel?: string; resolve: (b: boolean) => void };

let _id = 0;
export function toast(msg: string, type: ToastType = 'info') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fp:toast', { detail: { id: ++_id, msg, type } }));
}
export function confirmDialog(opts: { title?: string; message: string; danger?: boolean; okLabel?: string }): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent('fp:confirm', { detail: { id: ++_id, resolve, ...opts } })));
}

const BG: Record<ToastType, string> = { info: C.brand, ok: C.ok, error: C.danger };

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    const onToast = (e: Event) => { const t = (e as CustomEvent).detail as Toast; setToasts((a) => [...a, t]); setTimeout(() => setToasts((a) => a.filter((x) => x.id !== t.id)), t.type === 'error' ? 4000 : 2400); };
    const onConfirm = (e: Event) => setConfirm((e as CustomEvent).detail as ConfirmReq);
    window.addEventListener('fp:toast', onToast); window.addEventListener('fp:confirm', onConfirm);
    return () => { window.removeEventListener('fp:toast', onToast); window.removeEventListener('fp:confirm', onConfirm); };
  }, []);
  const close = (ok: boolean) => { if (confirm) { confirm.resolve(ok); setConfirm(null); } };
  useEffect(() => {
    if (!confirm) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); else if (e.key === 'Enter') close(true); };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
    // eslint-disable-next-line
  }, [confirm]);

  return (<>
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 84, zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none', padding: '0 12px' }}>
      {toasts.map((t) => (
        <div key={t.id} role="status" style={{ pointerEvents: 'auto', maxWidth: 'min(92vw, 440px)', padding: '10px 16px', borderRadius: R, fontSize: 13, fontWeight: 600, color: '#fff', background: BG[t.type], boxShadow: '0 6px 22px rgba(0,0,0,0.22)', whiteSpace: 'pre-wrap', textAlign: 'center' }}>{t.msg}</div>
      ))}
    </div>
    {confirm && (
      <div onClick={() => close(false)} style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(15,23,42,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360, width: '100%', background: C.taupeBg, borderRadius: 12, padding: '18px 18px 14px', boxShadow: '0 24px 60px rgba(0,0,0,0.28)' }}>
          {confirm.title && <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6, color: C.ink }}>{confirm.title}</div>}
          <div style={{ fontSize: 13.5, color: C.mute, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{confirm.message}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Btn variant="ghost" onClick={() => close(false)}>취소</Btn>
            <Btn
              variant={confirm.danger ? 'danger' : 'solid'}
              onClick={() => close(true)}
              style={confirm.danger ? { background: C.danger, borderColor: C.danger, color: '#fff' } : undefined}
            >{confirm.okLabel || '확인'}</Btn>
          </div>
        </div>
      </div>
    )}
  </>);
}
