'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Smartphone } from 'lucide-react';
import { Badge, Btn, ButtonLabel, C, FS, FW, ICON, Modal, R, SH } from '@/components/ui';

/**
 * **「손님 화면 따라보기」 — 관리자가 손님이 볼 화면을 보면서 전화로 안내한다**(사장님 2026-08-20
 * 「손님한테 날아가는 화면을 팝업·오버레이로 미리 볼 수 없나? 다음 다음 다음 자동으로 되게끔 관리자가 보면서 말해줄 수 있게」).
 *
 * ★어떻게
 *   같은 출처의 고객 링크를 `?preview=1` 로 폰 프레임 iframe 에 띄운다. 미리보기라 서버는 읽기만 하고(peek)
 *   열람 기록·제출이 남지 않는다 — 손님이 실제로 여는 것과 구분된다.
 *   단계 이동은 **postMessage** 로 시킨다(`fp-esign-preview`). iframe 안을 직접 뒤지지 않는다 —
 *   선택자에 기대면 고객 화면을 고칠 때마다 미리보기가 조용히 깨진다.
 *   고객 화면은 현재 단계를 `fp-esign-preview-state` 로 되돌려 주고, 여기 「3/9 본인확인」과 버튼 상태가 그걸 따른다.
 *
 * ★자동 넘김 — 「다음 다음 다음」을 손으로 누르지 않아도 되게 4초 간격으로 넘긴다. 말하다 멈추려면 일시정지.
 * ⚠ 하단독(sticky/transform) 안에서도 뜨도록 Modal(포털)을 쓴다.
 */
const FRAME_W = 390;
const FRAME_H = 720;
const AUTO_MS = 4000;

export type PreviewState = { index: number; total: number; title: string };

export function EsignCustomerWalkthrough({ url, customerName, onClose }: {
  url: string;
  customerName?: string;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  /**
   * ★고객 링크를 **지금 이 창의 출처**로 옮겨 띄운다(경로·쿼리만 가져온다).
   *   링크에 박힌 host 가 지금 보는 host 와 다르면(예: 저장된 링크는 localhost, 관리자는 127.0.0.1 · 배포 도메인이 여럿)
   *   iframe 이 다른 출처가 되어 postMessage 가 통째로 막히고 「다음」이 먹지 않는다 — 2026-08-20 실측.
   *   토큰만 같으면 같은 화면이므로 출처만 우리 쪽으로 맞춘다.
   */
  const frameUrl = useMemo(() => {
    try {
      const parsed = new URL(url, window.location.origin);
      return `${window.location.origin}${parsed.pathname}${parsed.search}`;
    } catch { return url; }
  }, [url]);
  const [state, setState] = useState<PreviewState | null>(null);
  const [auto, setAuto] = useState(false);
  const [ready, setReady] = useState(false);

  /** 고객 화면이 알려 주는 현재 단계. 같은 출처만 받는다. */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; index?: number; total?: number; title?: string } | null;
      if (!data || data.type !== 'fp-esign-preview-state') return;
      setReady(true);
      setState({ index: Number(data.index) || 0, total: Number(data.total) || 0, title: String(data.title || '') });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const send = useCallback((action: 'next' | 'prev' | 'first') => {
    frameRef.current?.contentWindow?.postMessage({ type: 'fp-esign-preview', action }, window.location.origin);
  }, []);

  const atEnd = !!state && state.total > 0 && state.index >= state.total - 1;
  const atStart = !state || state.index <= 0;

  /** 자동 넘김 — 마지막 장에서 스스로 멈춘다(되감아 돌지 않는다: 손님과 통화 중에 화면이 튀면 안 된다). */
  useEffect(() => {
    if (!auto) return undefined;
    if (atEnd) { setAuto(false); return undefined; }
    const timer = window.setInterval(() => send('next'), AUTO_MS);
    return () => window.clearInterval(timer);
  }, [auto, atEnd, send]);

  const stepLabel = state && state.total
    ? `${state.index + 1} / ${state.total}${state.title ? ` · ${state.title}` : ''}`
    : '불러오는 중…';

  return (
    <Modal open onClose={onClose} title={`손님 화면 따라보기${customerName ? ` · ${customerName}` : ''}`} width={FRAME_W + 72}>
      <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'stretch', flexWrap: 'wrap' }}>
          <Badge tone="blue" variant="quiet">{stepLabel}</Badge>
          <span style={{ fontSize: FS.micro, color: C.faint }}>미리보기 — 열람·제출로 기록되지 않습니다</span>
        </div>
        <div style={{
          width: FRAME_W, height: FRAME_H, borderRadius: R, overflow: 'hidden',
          border: `8px solid ${C.ink}`, background: C.bg, boxShadow: SH.modal,
        }}>
          <iframe
            ref={frameRef}
            src={frameUrl}
            title="손님 화면 미리보기"
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'stretch' }}>
          <Btn title="이전 단계" variant="ghost" size="sm" disabled={atStart} onClick={() => { setAuto(false); send('prev'); }}>
            <ButtonLabel icon={<ChevronLeft size={ICON.md} aria-hidden />}>이전</ButtonLabel>
          </Btn>
          <Btn
            title={auto ? '자동 넘김 멈춤' : '4초마다 다음 장으로'}
            variant={auto ? 'danger' : 'ghost'}
            size="sm"
            disabled={!ready || atEnd}
            onClick={() => setAuto((on) => !on)}
          >
            <ButtonLabel icon={auto ? <Pause size={ICON.md} aria-hidden /> : <Play size={ICON.md} aria-hidden />}>
              {auto ? '멈춤' : '자동 넘김'}
            </ButtonLabel>
          </Btn>
          <span style={{ flex: 1 }} />
          <Btn title="다음 단계" size="sm" disabled={atEnd} onClick={() => { setAuto(false); send('next'); }}>
            <ButtonLabel icon={<ChevronRight size={ICON.md} aria-hidden />}>다음</ButtonLabel>
          </Btn>
        </div>
        {atEnd ? (
          <div style={{ alignSelf: 'stretch', fontSize: FS.sub, color: C.mute }}>
            마지막 장입니다. 손님은 여기서 서명하고 제출합니다.{' '}
            <Btn size="sm" variant="ghost" onClick={() => { setAuto(false); send('first'); }}>처음부터</Btn>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** 칸 4·목록에서 여는 버튼 — 링크가 있어야(발행된 계약) 손님 화면이 있다. */
export function EsignCustomerWalkthroughButton({ url, customerName, full }: {
  url: string;
  customerName?: string;
  full?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!url) return null;
  return (
    <>
      <Btn title="손님이 볼 화면을 보면서 전화로 안내" variant="ghost" full={full} onClick={() => setOpen(true)}>
        <ButtonLabel icon={<Smartphone size={ICON.md} aria-hidden />}>손님 화면 따라보기</ButtonLabel>
      </Btn>
      {open ? <EsignCustomerWalkthrough url={url} customerName={customerName} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
