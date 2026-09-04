'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Phone, X } from 'lucide-react';
import { Btn, C, FS, FW, ICON, R_CARD, SH } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { hasBrand, whitelabelVars, type Whitelabel } from '@/lib/whitelabel';

/**
 * 화이트라벨 껍데기 — 손님 카탈로그를 «그 회사 사이트»로 보이게 하는 머리띠·안내 블록·푸터.
 *
 * ★노브랜드면 아무것도 안 그린다. `hasBrand(wl)` 이 false 면 children 만 그대로 통과시킨다 —
 *   그래야 도메인을 안 붙인 지금 운영 화면이 **한 픽셀도 안 바뀐다**.
 *
 * ★색은 원자에 칠하지 않는다. `.fp-wl` 스코프에서 `--brand`/`--text-link` «토큰만» 뒤집으면
 *   C.brand·C.accent 를 쓰는 원자가 전부 알아서 따라온다(globals.css `.fp-topbar .fp-onbar` 와 같은 짜임).
 *   그래서 「버튼·선택은 회사 컬러」(사장님 2026-09-04)가 화면마다 손대지 않아도 지켜진다.
 *
 * ★머리 오른쪽은 «누가 받는가»다. 공유링크(`?a=`)로 들어온 손님에게는 **담당 영업자**가,
 *   맨 주소로 들어온 손님에게는 **대표번호**가 든다. 우리(프리패스) 이름은 어디에도 안 나온다.
 */
export function WhitelabelFrame({ wl, agentName, agentPhone, children }: {
  wl: Whitelabel;
  agentName?: string;
  agentPhone?: string;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  if (!hasBrand(wl)) return <>{children}</>;

  const who = String(agentName || '').trim();
  const phone = String(agentPhone || '').trim() || wl.tel;
  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '';
  /** 폰 하단 고정독 높이 — 목록 끝이 독에 가리지 않게 본문 아래에 같은 만큼 자리를 비운다. */
  const DOCK_H = 76;

  return (
    <div className="fp-wl" style={whitelabelVars(wl) as React.CSSProperties}>
      {/*
        머리 — 웹은 「워드마크 · 담당자 · 전화 버튼」 한 줄.
        ★폰은 워드마크만 둔다. 셋을 다 넣으면 워드마크가 두 줄로 접히고 버튼이 화면 밖으로 나간다(실측).
          전화는 폰에서 «하단 고정독»이 받는다 — 엄지가 닿는 자리이기도 하다.
      */}
      <header style={{ borderBottom: `1px solid ${C.line}`, background: C.bg }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto',
          padding: mobile ? '0 16px' : '0 24px', height: mobile ? 56 : 72,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: mobile ? 7 : 9, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, letterSpacing: '-0.03em', color: C.brand }}>
              {wl.wordmark.main}
            </span>
            <span style={{ fontSize: mobile ? 12 : 15, fontWeight: FW.meta, letterSpacing: '0.15em', color: C.ink }}>
              {wl.wordmark.sub}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          {phone && !mobile ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                <span style={{ fontSize: FS.cap, color: C.faint }}>{who ? `담당 ${who}` : '고객센터'}</span>
                <span style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>
                  {phone}
                </span>
              </div>
              <Btn href={telHref} title="담당자에게 전화합니다">
                <Phone size={ICON.md} aria-hidden />전화 상담
              </Btn>
            </>
          ) : null}
        </div>
      </header>

      <WhitelabelNotice wl={wl} mobile={mobile} />

      {children}

      {/* 폰 하단 고정독 — 손님이 걸 곳은 늘 엄지 밑에 있다. 담당자 이름이 붙어야 «누구에게» 거는지 안다. */}
      {phone && mobile ? (
        <>
          <div style={{ height: DOCK_H }} aria-hidden />
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
            background: C.bg, borderTop: `1px solid ${C.line}`, boxShadow: SH.dock,
            padding: '10px 16px 14px', display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: FS.cap, color: C.faint }}>{who ? '담당' : '고객센터'}</span>
              <span style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>{who || phone}</span>
            </div>
            <Btn href={telHref} full title="담당자에게 전화합니다">
              <Phone size={ICON.md} aria-hidden />전화 상담
            </Btn>
          </div>
        </>
      ) : null}

      <footer style={{ borderTop: `1px solid ${C.line}`, marginTop: 28 }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '30px 24px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.03em', color: C.faint }}>
              {wl.wordmark.main}
            </span>
            <span style={{ fontSize: FS.cap, fontWeight: FW.meta, letterSpacing: '0.16em', color: C.faint }}>
              {wl.wordmark.sub}
            </span>
          </div>
          <div style={{ fontSize: FS.sub, color: C.faint, lineHeight: 1.9 }}>
            {wl.bizLines.map((line) => <div key={line}>{line}</div>)}
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * 검색창 «위» 안내 블록 — 상품이 무엇인지 알리고, **손님이 X 로 끈다**(사장님 2026-09-04).
 *
 * ★문구는 브랜드 정본(`wl.notice`)에서 온다 — 채널마다 홍보가 다르므로 화면에 박지 않는다.
 * ★끈 것은 그 사람 브라우저에만 남는다(localStorage). 채널별로 키가 갈려서, 한 브랜드에서 껐다고
 *   다른 브랜드의 안내까지 사라지지 않는다.
 * ⚠ 처음 그릴 때는 «보이는» 쪽이 기본이다. 안 보이는 쪽을 기본으로 두면 서버가 그린 화면과
 *   달라져 모두에게 한 번 껌뻑인다 — 껐던 사람만 한 번 깜빡이는 편이 낫다.
 */
function WhitelabelNotice({ wl, mobile }: { wl: Whitelabel; mobile: boolean }) {
  const notice = wl.notice;
  const key = `fp4_wl_notice_${wl.key}`;
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(key) === '1') setClosed(true); } catch { /* 사생활 모드 등 — 그냥 보여 준다 */ }
  }, [key]);

  if (!notice || closed) return null;

  const close = () => {
    setClosed(true);
    try { localStorage.setItem(key, '1'); } catch { /* 저장 못 해도 이번 방문은 닫힌다 */ }
  };

  return (
    <div style={{ background: C.brandSoft, borderBottom: `1px solid ${C.brandBg}` }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: mobile ? '18px 16px 16px' : '30px 24px 28px', position: 'relative' }}>
        <div style={{ fontSize: mobile ? 22 : 30, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.3, color: C.ink, paddingRight: mobile ? 34 : 44 }}>
          {notice.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: mobile ? 10 : 12 }}>
          <span style={{ fontSize: mobile ? FS.body : 15, color: C.sub, lineHeight: 1.6 }}>{notice.body}</span>
          {notice.moreLabel && notice.moreHref ? (
            <a href={notice.moreHref} style={{ fontSize: 14.5, fontWeight: FW.title, color: C.brand }}>
              {notice.moreLabel} ›
            </a>
          ) : null}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="안내 닫기"
          style={{
            position: 'absolute', right: mobile ? 10 : 18, top: mobile ? 12 : 22,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, padding: 0, borderRadius: R_CARD,
            border: 'none', background: 'transparent', color: C.mute, cursor: 'pointer',
          }}
        >
          <X size={ICON.md} aria-hidden />
        </button>
      </div>
    </div>
  );
}
