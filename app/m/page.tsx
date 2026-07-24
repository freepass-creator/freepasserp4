'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MOBILE_BP } from '@/lib/use-mobile';
import { Btn } from '@/components/ui';
import { C, FS, FW } from '@/components/ui/tokens';

/**
 * `/m` — 모바일 미리보기(디바이스 프리뷰).
 *
 * 데스크톱에서 앱을 실제 폰 폭 iframe으로 감싸 보여준다. iframe 안은 뷰포트 폭이 진짜 폰(≈390)
 * 이라 JS(innerWidth·matchMedia)와 CSS(@media)가 **둘 다** 모바일로 걸린다 → 폰 화면과 픽셀 동일.
 * 포털(Toaster·모달·독)도 iframe 문서 body로 렌더돼 프레임 밖으로 새지 않는다.
 * 프레임 안에서 그대로 클릭·수정·탐색(/m/{code} 상세 포함)까지 된다.
 *
 * 실제 폰(좁은 뷰포트)에선 프레임이 무의미 → 앱 홈으로 보낸다.
 * ?to=/members 처럼 특정 경로를 바로 미리볼 수 있다.
 */
const DEVICES = [
  { key: 'an', label: '안드로이드', w: 360, h: 800 },
  { key: 'ip', label: 'iPhone', w: 390, h: 844 },
  { key: 'mx', label: 'Max', w: 430, h: 932 },
] as const;
type Device = (typeof DEVICES)[number];

function setMobileCookie(v: '0' | '1') {
  try { document.cookie = `fp_m=${v};path=/;max-age=31536000;SameSite=Lax`; } catch { /* */ }
}

export default function MobilePreview() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [dev, setDev] = useState<Device>(DEVICES[1]); // 기본 iPhone 390
  const [nonce, setNonce] = useState(0); // iframe 강제 리로드
  const [src, setSrc] = useState('/');
  const [path, setPath] = useState('/'); // 프레임 내부 현재 경로(표시용)
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    // 실제 폰이면 프레임 무의미 → 진짜 앱으로.
    if (window.innerWidth < MOBILE_BP) { router.replace('/'); return; }
    // ?to= 로 특정 경로 미리보기.
    const to = new URLSearchParams(location.search).get('to');
    const initial = to && to.startsWith('/') && !to.startsWith('/m') ? to : '/';
    setSrc(initial);
    setPath(initial);
    // iframe 첫 SSR을 모바일로 확정(공유 쿠키) → 내부 웹→모바일 깜빡임 방지.
    setMobileCookie('1');
    setMounted(true);
    // 이탈 시 부모(데스크톱) 쿠키 원복 — SPA 나갈 때 오염 정리.
    return () => setMobileCookie(window.innerWidth < MOBILE_BP ? '1' : '0');
  }, [router]);

  // 현재 내부 위치 그대로 리로드(동일 출처) — 이동해 둔 곳을 잃지 않는다. 실패 시 key 리마운트.
  const reload = useCallback(() => {
    try { iframeRef.current?.contentWindow?.location.reload(); }
    catch { setNonce((n) => n + 1); }
  }, []);
  const home = useCallback(() => {
    setSrc('/'); setPath('/'); setNonce((n) => n + 1);
  }, []);
  // 프레임 로드마다 내부 경로 읽기(동일 출처).
  const onLoad = useCallback(() => {
    try {
      const w = iframeRef.current?.contentWindow;
      if (w) setPath(w.location.pathname + w.location.search);
    } catch { /* cross-origin 아님(동일 출처) — 무시 */ }
  }, []);

  // 마운트 전(SSR·첫 클라)엔 빈 배경만 — 하이드레이션 일치.
  if (!mounted) return <div style={{ minHeight: '60vh' }} />;

  const frameH = `min(${dev.h}px, calc(100dvh - 168px))`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        padding: '18px 16px 40px',
        minHeight: 'calc(100dvh - var(--topbar-h, 56px))',
        boxSizing: 'border-box',
      }}
    >
      {/* ── 상단 컨트롤 바 ── */}
      <div
        style={{
          width: '100%', maxWidth: 620, display: 'flex', alignItems: 'center',
          flexWrap: 'wrap', gap: 10, justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>
            모바일 미리보기
          </div>
          <div style={{ fontSize: FS.cap, color: C.faint }}>
            폰 폭으로 실제 화면 그대로 · 프레임 안에서 수정·탐색 가능
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {DEVICES.map((d) => (
            <Btn
              key={d.key}
              size="sm"
              variant={d.key === dev.key ? 'solid' : 'ghost'}
              onClick={() => setDev(d)}
            >
              {d.label}
            </Btn>
          ))}
          <Btn size="sm" variant="ghost" onClick={reload} title="프레임 새로고침">↻</Btn>
          <Btn size="sm" variant="ghost" onClick={() => router.push('/')}>데스크톱으로</Btn>
        </div>
      </div>

      {/* ── 주소 표시(내부 현재 경로) ── */}
      <div
        style={{
          width: dev.w, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', borderRadius: 999, background: C.taupeBg,
          border: `1px solid ${C.line}`, boxSizing: 'border-box',
        }}
      >
        <button
          onClick={home}
          title="프레임 홈"
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: C.mute, fontSize: FS.body, lineHeight: 1, padding: 0,
          }}
        >⌂</button>
        <div
          style={{
            flex: 1, minWidth: 0, fontSize: FS.cap, color: C.mute,
            fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >{path}</div>
        <span style={{ fontSize: FS.micro, color: C.faint }}>{dev.w}×{dev.h}</span>
      </div>

      {/* ── 디바이스 프레임(물리 폰: 항상 검정 베젤, 테마 무관) ── */}
      <div
        style={{
          position: 'relative',
          width: dev.w + 20, // 베젤 10px×2
          maxWidth: '100%',
          padding: 10,
          borderRadius: 48,
          background: '#0b0b0f',
          boxShadow: '0 24px 60px -20px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04) inset',
          boxSizing: 'border-box',
        }}
      >
        {/* 노치/스피커 힌트 */}
        <div
          style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            width: 96, height: 6, borderRadius: 999, background: 'rgba(255,255,255,.14)',
            zIndex: 2, pointerEvents: 'none',
          }}
        />
        <iframe
          key={`${src}#${nonce}`}
          ref={iframeRef}
          src={src}
          onLoad={onLoad}
          title="모바일 미리보기"
          style={{
            display: 'block',
            width: dev.w,
            maxWidth: '100%',
            height: frameH,
            border: 'none',
            borderRadius: 38,
            background: C.bg,
            colorScheme: 'normal',
          }}
        />
      </div>

      <div style={{ fontSize: FS.micro, color: C.faint, textAlign: 'center', maxWidth: 420 }}>
        프레임 안은 실제 모바일 뷰포트({dev.w}px)입니다. 데스크톱에서 폰과 동일하게 보여요.
      </div>
    </div>
  );
}
