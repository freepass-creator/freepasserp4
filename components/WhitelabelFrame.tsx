'use client';
import { useState, type ReactNode } from 'react';
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
export function WhitelabelFrame({
  wl, agentName, agentPhone, dock = true, notice = true, headerActions, children,
}: {
  wl: Whitelabel;
  agentName?: string;
  agentPhone?: string;
  /**
   * 폰 하단 고정독을 이 껍데기가 그릴까.
   * ⚠ 상세 화면처럼 **제 하단독을 이미 가진 곳**은 `false` 로 끈다 — 안 그러면 독이 둘로 겹친다.
   */
  dock?: boolean;
  /** 안내 블록을 그릴까. 목록에서만 쓰고 상세에서는 끈다(같은 말을 두 번 하지 않는다). */
  notice?: boolean;
  /**
   * **폰 머리띠 오른쪽**에 세울 실행 — 상세의 관심·공유가 여기 든다.
   *
   * ★폰 머리띠는 왼쪽 워드마크 하나뿐이라 오른쪽이 통째로 비어 있었다. 상세에서 관심·공유가
   *   갈 데가 없어(사진 위 금지 · 하단독은 두 칸 확정 · 차번 줄은 정보 줄) 짝 없는 빈 줄을
   *   하나 만들어 쓰던 것을 여기로 올렸다(사장님 2026-09-05).
   * ★웹은 이 자리에 담당자·전화가 선다 — 그래서 **폰에서만** 그린다. 웹 상세는 제 실행줄이 있다.
   * ⚠ 목록 화면은 이 슬롯을 비워 둔다. 「이 차」가 없는 곳에서 공유·관심은 말이 안 된다.
   */
  headerActions?: ReactNode;
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
      {/*
        ★★폰에서는 머리띠를 **고정**한다(2026-09-05). 오른쪽에 공유가 들어왔기 때문이다 —
          공유는 이 사업의 퍼널이라 **상세 어디를 보고 있든** 눌릴 수 있어야 한다.
          스크롤에 딸려 올라가 버리면 대여료·조건을 다 읽고 마음먹은 순간에 그 단추가 화면에 없다.
        ⚠ 웹은 고정하지 않는다 — 데스크톱은 한눈에 더 들어오고, 머리띠(72)를 붙박아 두면
          가뜩이나 긴 상세에서 세로를 그만큼 잃는다.
        ⚠ **실행이 들어 있을 때만** 고정한다 — 목록에서는 머리띠에 워드마크뿐이라, 붙박아 두면
          긴 목록에서 56px 를 내내 잡아먹기만 하고 손님이 거기서 할 수 있는 일이 없다.
      */}
      <header style={{
        borderBottom: `1px solid ${C.line}`, background: C.bg,
        ...(mobile && headerActions ? { position: 'sticky' as const, top: 0, zIndex: 15 } : null),
      }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto',
          padding: mobile ? '0 16px' : '0 24px', height: mobile ? 56 : 72,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: mobile ? 7 : 9, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: mobile ? 22 : 26, fontWeight: FW.head, letterSpacing: '-0.03em', color: C.brand }}>
              {wl.wordmark.main}
            </span>
            <span style={{ fontSize: mobile ? 12 : 15, fontWeight: FW.meta, letterSpacing: '0.15em', color: C.ink }}>
              {wl.wordmark.sub}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          {/* 폰 머리띠 오른쪽 — 상세의 관심·공유(위 `headerActions` 참고). 목록에서는 비어 있다. */}
          {mobile ? headerActions : null}
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

      {notice ? <WhitelabelNotice wl={wl} mobile={mobile} /> : null}

      {children}

      {/* 폰 하단 고정독 — 손님이 걸 곳은 늘 엄지 밑에 있다. 담당자 이름이 붙어야 «누구에게» 거는지 안다. */}
      {phone && mobile && dock ? (
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
            <span style={{ fontSize: 18, fontWeight: FW.head, letterSpacing: '-0.03em', color: C.faint }}>
              {wl.wordmark.main}
            </span>
            <span style={{ fontSize: FS.cap, fontWeight: FW.meta, letterSpacing: '0.16em', color: C.faint }}>
              {wl.wordmark.sub}
            </span>
          </div>
          <div style={{ fontSize: FS.sub, color: C.faint, lineHeight: 1.9 }}>
            {wl.bizLines.map((line) => <div key={line}>{line}</div>)}
          </div>
          {/*
            영업자 로그인 — **푸터 맨 밑에 조용히**(사장님 2026-09-05 「그 주소로 들어가면 상품부터
            다 보이는 거라고. 거길 들어가서 영업자는 로그인을 하는 거야」).
            손님은 로그인할 일이 없으니 위로 올리지 않는다. 그렇다고 없애면 영업자가 주소를 외워
            쳐야 한다 — 사업자 표기 밑 한 줄이 그 둘을 다 만족한다(회사 사이트가 흔히 그러는 자리다).
          */}
          <a href="/login" style={{
            display: 'inline-block', marginTop: 14,
            fontSize: FS.cap, color: C.faint, textDecoration: 'none',
          }}>로그인</a>
        </div>
      </footer>
    </div>
  );
}

/**
 * 검색창 «위» 안내 블록 — 상품이 무엇인지 알리고, **손님이 X 로 끈다**(사장님 2026-09-04).
 *
 * ★문구는 브랜드 정본(`wl.notice`)에서 온다 — 채널마다 홍보가 다르므로 화면에 박지 않는다.
 * ★★**끈 것을 기억하지 않는다**(사장님 2026-09-04 「새로고침하거나 다시 오면 그거 다시 떠야지」).
 *   X 는 «지금 이 화면에서 치우는» 버튼이지 «다시는 보지 않기»가 아니다.
 *   이 자리가 회사 홍보·이벤트를 갈아 끼우는 칸이라, 한 번 껐다고 영영 안 뜨면
 *   다음에 건 홍보를 그 손님은 평생 못 본다. 그래서 localStorage 에 저장하지 않는다.
 */
function WhitelabelNotice({ wl, mobile }: { wl: Whitelabel; mobile: boolean }) {
  const notice = wl.notice;
  const [closed, setClosed] = useState(false);

  if (!notice || closed) return null;

  const close = () => setClosed(true);

  return (
    /* 면(brandSoft)이 이미 경계를 만든다 — 그 위에 선을 또 그으면 테두리가 두 겹이 된다. */
    <div style={{ background: C.brandSoft }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: mobile ? '18px 16px 16px' : '30px 24px 28px', position: 'relative' }}>
        <div style={{ fontSize: mobile ? 22 : 30, fontWeight: FW.head, letterSpacing: '-0.04em', lineHeight: 1.3, color: C.ink, paddingRight: mobile ? 34 : 44 }}>
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
