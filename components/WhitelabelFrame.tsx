'use client';
import { useCallback, useState, type ReactNode } from 'react';
import { LogIn, Phone, SquareArrowOutUpRight, X } from 'lucide-react';
import { C, FW, ICON, R_CARD, fmtPhone } from '@/components/ui';
import { SHOP, ShopDock, ShopDockAction } from '@/components/shop/shop-ui';
import { ChannelSign, ChannelWordmark, CoBrandFreepass } from '@/components/brand-ci';
import { CORP } from '@/lib/domain/corporate-ci';
import { useSession } from '@/lib/auth-context';
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
/**
 * **담당자가 없을 때 번호에 붙는 말** — 「고객센터」가 아니라 **「상담 및 문의」**.
 *
 * 사장님 2026-09-07 「**상담 및 문의**가 나을 거야… 고객센터보다는. 아니면 문의하기 이렇게」.
 * ★「고객센터」는 «이미 산 사람이 불만을 말하는 곳»으로 읽힌다. 이 화면에 온 사람은 아직
 *   아무것도 안 샀고, 하려는 일은 **묻는 것**이다. 말이 하는 일과 맞아야 손이 간다.
 * ⚠ 한 곳에 둔다 — 웹 머리띠와 폰 둘째 줄이 «같은 말»이어야 한다. 전에는 「고객센터」와
 *   「상담·문의」로 갈려 있었다(웹만 고치면 폰에서 또 원래대로가 된다 — CLAUDE.md 절대원칙 3).
 */
const CONTACT_LABEL = '상담 및 문의';

export function WhitelabelFrame({
  wl, agentName, agentPhone, attr, wlPreview, dock = true, notice = true,
  headerLead, headerActions, children,
}: {
  wl: Whitelabel;
  agentName?: string;
  agentPhone?: string;
  /**
   * **담당 귀속 코드**(`?a=`) — 간판이 «물고 갈» 값.
   *
   * ★★담당은 이제 **주소에만** 산다(`lib/shop/attribution` — 사장님 2026-09-07 「그냥 링크를
   *   정해주자」). 기억해 두는 곳이 없어졌으므로, 간판이 이 값을 안 물고 가면 **손님이 로고를
   *   누른 순간 담당이 사라진다.**
   * ⚠ 사장님 2026-09-07 「**간판 누르면 종료가 아니고**」 — 간판은 「홈으로」지 「끝」이 아니다.
   *   로고 한 번 눌렀다고 영업자가 손님을 잃으면 안 된다.
   */
  attr?: string;
  /**
   * 채널 미리보기 꼬리표(`?wl=`) — 도메인이 붙기 전까지 «어느 가게»인지를 들고 다니는 값.
   * ⚠ 안 물고 가면 간판을 누른 순간 **노브랜드 프리패스 목록**이 뜬다 — 눌렀더니 남의 사이트다.
   *   (「목록으로」가 2026-09-05 에 같은 사고를 냈고 거기는 이미 고쳐져 있었다. 간판만 남아 있었다.)
   */
  wlPreview?: string;
  /**
   * 폰 하단 고정독을 이 껍데기가 그릴까.
   * ⚠ 상세 화면처럼 **제 하단독을 이미 가진 곳**은 `false` 로 끈다 — 안 그러면 독이 둘로 겹친다.
   */
  dock?: boolean;
  /** 안내 블록을 그릴까. 목록에서만 쓰고 상세에서는 끈다(같은 말을 두 번 하지 않는다). */
  notice?: boolean;
  /**
   * **폰 머리띠 왼쪽**을 이것으로 «갈아 끼운다» — 채널 워드마크 대신.
   *
   * ★★상세는 **채널 간판을 거는 자리가 아니라 「이 상품」의 화면**이다(사장님 2026-09-05
   *   「상세페이지 갔을 때는 «유니오토모빌» 나오면 안 되고, 그냥 **상품 상세 페이지**라는 게
   *   나오고 거기에 그 버튼이 있으면 돼 … 그냥 **맨 위에 차량번호**가 있든지」).
   *   폰에서 머리띠는 «고정»이라 스크롤 내내 남는다 — 거기가 채널 이름이면 화면 절반을 내려가는
   *   동안 **지금 무슨 차를 보고 있는지**를 말해 주는 자리를 간판이 잡고 있는 꼴이다.
   * ★목록은 반대다 — 거기서는 「어느 가게인가」가 맞는 말이라 워드마크 그대로다.
   * ⚠ 웹은 갈아 끼우지 않는다. 웹 머리띠는 «사이트 머리»(간판 + 담당자 + 전화)이고,
   *   고정도 아니라 상세를 가리지 않는다. 폰만 앱처럼 «이 화면의 이름»을 든다.
   */
  headerLead?: ReactNode;
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
  /*
   * ★머리띠의 «실제 높이»를 CSS 변수로 흘린다 — 붙박이가 됐으므로 그 밑에 서는 것들
   *   (목록의 검색줄)이 그만큼 내려가야 한다. 숫자를 손으로 적으면 머리띠가 한 줄 늘어난 날
   *   검색줄이 그 뒤로 숨는다(2026-09-07).
   */
  /*
   * **채널의 첫 화면 주소** — 간판을 눌렀을 때 갈 곳.
   * ★도메인이 붙었으면 `/`(그 도메인의 첫 화면이 곧 목록이다 — 미들웨어가 `/shop` 으로 다시 쓴다).
   *   아직이면 표에 적힌 채널 주소(`sitePath`). 둘 다 없으면 `/shop`.
   *
   * ★★**떨구는 것과 물고 가는 것을 가른다.**
   *   · 떨군다 = **조건·검색어**(`?rent=`·`?dep=`·`?q=`…). 그게 「처음 방문한 상태」다.
   *   · 물고 간다 = **담당(`a`) · 채널(`wl`)**. 이 둘은 조건이 아니라 «누구의/어느 가게»다.
   *   ⚠ 사장님 2026-09-07 「**간판 누르면 종료가 아니고**」. 담당은 이제 주소에만 살아서
   *     (`lib/shop/attribution`), 여기서 떨구면 로고 한 번에 영업자가 손님을 잃는다.
   */
  const homeHref = (() => {
    const q = new URLSearchParams();
    if (attr) q.set('a', attr);
    if (wlPreview) q.set('wl', wlPreview);
    const tail = q.toString() ? `?${q}` : '';
    if (typeof window !== 'undefined'
      && wl.hosts.some((h) => h.toLowerCase() === window.location.hostname.toLowerCase())) return `/${tail}`;
    return `${wl.sitePath || '/shop'}${tail}`;
  })();

  const headRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    /* ⚠ 변수는 «공통 조상»(.fp-wl)에 건다 — 머리띠 제 자신에 걸면 형제(검색줄)가 못 받는다. */
    const set = () => {
      const h = `${Math.round(el.getBoundingClientRect().height)}px`;
      (el.closest('.fp-wl') as HTMLElement | null)?.style.setProperty('--fp-wl-head-h', h);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
  }, []);
  if (!hasBrand(wl)) return <>{children}</>;

  const who = String(agentName || '').trim();
  const phone = String(agentPhone || '').trim() || wl.tel;
  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '';
  /*
   * ★번호는 «읽는 값»이라 서식을 입힌다 — `01049943330` 은 사람이 못 읽는다.
   * ⚠⚠ **이미 하이픈이 있으면 그대로 둔다**(2026-09-07 실측으로 잡았다).
   *   `fmtPhone` 은 휴대폰(10~11자리) 규칙이라 **대표번호 `1800-6454`(8자리)를
   *   `180-064-54` 로 망가뜨렸다.** 원천이 이미 사람이 읽을 꼴로 준 값은 손대지 않는다.
   */
  const phoneText = phone.includes('-') ? phone : fmtPhone(phone);
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
      <header ref={headRef} style={{
        borderBottom: `1px solid ${C.line}`, background: C.bg,
        /*
         * ★폰 머리띠는 **고정**이다 — 오른쪽에 검색·조건·공유가 들어와 있어서,
         *   목록을 한참 내려간 손님이 맨 위로 되돌아가지 않아도 조건을 다시 건다.
         * ⚠ 웹은 고정하지 않는다 — 머리띠(72)를 붙박으면 긴 상세에서 세로를 그만큼 잃는다.
         * ⚠ 머리띠에 «할 일»이 없으면(실행도 검색도 없는 화면) 고정하지 않는다 — 56px 를
         *   내내 잡아먹기만 한다.
         */
        /*
         * ★★**웹도 고정한다**(사장님 2026-09-07 「웹페이지 틀고정 되는 거도 고려해줘봐 ·
         *   **상세페이지도 틀고정** 하는 거 있어야 하고」).
         *   ⚠ 여기 「웹은 고정하지 않는다 — 세로를 잃는다」고 적혀 있었다. 그 판단을 물린다:
         *     상세는 7화면짜리라 손님이 대여료·조건을 다 읽고 «마음먹은 순간»에 전화 단추가
         *     화면에 없다. 머리띠에 **담당자 이름과 전화 상담**이 들어 있으므로 붙박이가 맞다.
         *   ★목록에서도 채널 이름이 늘 보인다 — 도메인을 붙이면 「자기네 사이트」로 읽혀야 한다.
         */
        position: 'sticky' as const, top: 0, zIndex: 15,
      }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto',
          /*
           * ★★**폰은 CI 를 왼쪽에 «타이트하게» 붙인다**(사장님 2026-09-05 「유니오토모빌 CI 가
           *   좌측에 좀 **타이트하게** 잘 붙게끔 … **유튜브 모바일**을 한번 봐봐」).
           *   유튜브·인스타·당근이 다 그렇다 — 간판은 화면 모서리에 가깝게 붙고, 오른쪽 아이콘은
           *   제 누름영역(40)이 이미 여백을 갖고 있어 바깥 패딩을 더 줄 이유가 없다.
           * ⇒ 왼쪽 12 · 오른쪽 6(아이콘의 40 정사각이 나머지를 만든다). 본문은 16 그대로다.
           */
          padding: mobile ? '0 4px 0 12px' : '0 24px', height: mobile ? 56 : 72,
          display: 'flex', alignItems: 'center', gap: mobile ? 4 : 12,
        }}>
          {/* 폰 상세는 간판 대신 «이 화면의 이름»을 든다(위 `headerLead` 참고). 웹·목록은 워드마크. */}
          {mobile && headerLead ? headerLead : (
            /*
             * ★**마크 + 글자**다(사장님 2026-09-05 로고·명함 전달). 마크만 그림이고 이름은 글자다 —
             *   워드마크까지 그림으로 넣으면 배율마다 글자가 뭉개진다.
             * ★글자는 **먹색**이다. 로고가 검정이라 「UNI」만 브랜드색으로 칠하면 로고와 색이 갈린다
             *   (전에는 파랑이었다). 브랜드색은 «누르는 것»에만 쓴다.
             */
            /*
             * ★★**간판을 누르면 «처음 방문한 상태»로 돌아간다**(사장님 2026-09-07 「상단 이거 버튼
             *   누르면 첫 페이지 새로 나와야 하고 **자동으로 다 리셋**되고 처음 방문한 상태로」).
             *   ⚠ `Link` 가 아니라 **`<a>`** 다 — 클라이언트 이동은 조건·검색어·스크롤을 들고 간다.
             *     통째로 새로 여는 것이 「처음 방문」의 정확한 뜻이다.
             *   ★주소는 «채널의 첫 화면»이다 — 도메인이 붙었으면 `/`, 아직이면 채널 주소(`sitePath`).
             *     조건(`?rent=`·`?dep=`…)은 안 달고 간다. 그게 리셋이다.
             * ★★**하나의 브랜드처럼 붙인다**(같은 날 「유니오토모빌 CI 도 **간격 잘 맞춰서 하나
             *   브랜드인 것처럼**」) — 마크와 글자가 «한 덩어리»고, 그 뒤 «✕ freepass» 만 한 단
             *   떼어 놓는다. 붙은 것은 한 이름으로, 뗀 것은 «동반»으로 읽힌다.
             */
            <a href={homeHref} aria-label={`${wl.name} 첫 화면으로`} style={{
              display: 'flex', alignItems: 'center',
              whiteSpace: 'nowrap', textDecoration: 'none', color: 'inherit',
            }}>
              {/*
                간판 짜임(마크 높이·자간·세로 맞춤)은 원자가 안다 — `components/brand-ci`.

                ★★**«채널 ✕ freepass» 동반 표기**(사장님 2026-09-07 「**유니오토모빌 X freepass**
                  이렇게 해줘야 함 홈페이지는」). 이 홈페이지는 채널의 얼굴이지만 **우리가 만들어
                  주는 것**이라, 만든 쪽을 숨기지 않고 «옆에» 적는다.
                ⚠ 이건 업무동 규칙(「브랜드 표식은 안 세운다」)과 «다른 자리»다 — 그건 공급사·영업자가
                  같이 쓰는 콕핏 얘기고, 여기는 손님에게 나가는 «채널 홈페이지»다.
                ★크기·색으로 위계를 준다 — 채널 이름이 주인이고 우리 이름은 그 «옆에 작게» 선다.

                ⚠⚠ **간판의 «형제»로 두지 않는다 — 워드마크와 «같은 밑선 줄» 안에 넣는다**
                  (사장님 2026-09-07 「**협업한다는 뜻**인데 저거 정렬이 저렇게 안 되나」).
                  밖에 형제로 두면 마크까지 포함한 덩어리에 «가운데 정렬»로 붙어 **밑선이 3px 떠
                  있었다**(실측 UNI 43.5 · ✕ freepass 40.5). ✕ 는 「A ✕ B」로 두 이름을 잇는
                  기호다 — 두 이름이 한 줄에 서지 않으면 그 뜻이 안 산다.
                  사이는 원자가 한 단 더 뗀다(`ChannelWordmark.after`).
              */}
              <ChannelSign wl={wl} fs={mobile ? 17 : 23} gap={mobile ? 8 : 10}
                after={<CoBrandFreepass fs={mobile ? 11 : 13} gap={mobile ? 9 : 12} />} />
            </a>
          )}
          <div style={{ flex: 1 }} />
          {/* 폰 머리띠 오른쪽 — 상세의 관심·공유(위 `headerActions` 참고). 목록에서는 비어 있다. */}
          {mobile ? headerActions : null}
          {phone && !mobile ? (
            /*
             * ★★**웹은 «누르는 것»이 아니다 — 번호를 읽고 손님이 제 전화기로 건다**
             *   (사장님 2026-09-07 「**웹은 누르는 거 아니고** 그냥 고객센터 1800-6454 로 가면 되고」).
             *   ⚠ 여기 「전화 상담」 파란 단추가 서 있었다. 데스크톱에서 `tel:` 단추는 눌러도
             *     대개 아무 일도 안 나거나 낯선 앱이 뜬다 — **아무 일도 안 하는 단추**가 머리띠에서
             *     제일 센 자리(파란 면)를 잡고 있었던 것이다.
             *   ⇒ 단추를 걷고 글자만 남긴다. 폰은 반대다 — 거기서 번호는 눌러서 걸리므로
             *     `tel:` 을 걸어 둔다(아래 둘째 줄 · 담당자가 있으면 하단독).
             */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: SHOP.sp.tight }}>
              <span style={{ fontSize: SHOP.fs.cap, color: C.faint }}>{who ? `담당 ${who}` : CONTACT_LABEL}</span>
              {/* ★번호는 «읽는 값»이라 서식을 입힌다 — 01049943330 은 사람이 못 읽는다(집 원자 `fmtPhone`). */}
              <span style={{ fontSize: SHOP.fs.body, fontWeight: FW.title, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>
                {phoneText}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {notice ? <WhitelabelNotice wl={wl} mobile={mobile} /> : null}

      {children}

      {/* 폰 하단 고정독 — 손님이 걸 곳은 늘 엄지 밑에 있다. 담당자 이름이 붙어야 «누구에게» 거는지 안다. */}
      {/* ★독은 원자다(`ShopDock`) — 상세·조건 시트와 «같은 것»을 쓴다(2026-09-06 검수).
          전에는 여기만 자리 잡는 높이(76)와 버튼 높이(48)를 손으로 적어, 상세(54)·시트(52)와
          치수가 갈렸고 아이폰 안전영역도 안 봤다. */}
      {/*
        ★★**폰에서 연락처는 «하단»이다 — 담당자가 있든 없든**(사장님 2026-09-07
          「야 **모바일에서는 상담문의가 하단에 있어야** 하는데…」).
          ⚠ 이 자리에 「담당자가 있을 때만 독을 세운다」고 적혀 있었다. 그 판단을 물린다.
            대표번호를 머리띠 «둘째 줄»에 글자로 얹어 뒀는데, 그러면 —
            ㉠ 머리가 두 줄이 되어 붙박이 머리띠가 그만큼 목록을 먹고,
            ㉡ 정작 **엄지가 닿는 자리**에는 걸 곳이 없다. 폰에서 전화는 엄지 밑에 있어야 한다.
          ⇒ 담당자 유무와 무관하게 **하단 고정독** 하나로 모은다. 머리띠 둘째 줄은 걷었다.
        ★★**다만 «누구에게» 거느냐로 꼴이 갈린다**(사장님 2026-09-07 「대표번호만 나오면 되고
          **버튼 눌러서 전화하는 거는 필요없지**」) —
          · **담당자 있음** = 그 사람에게 거는 것이라 이름 + 「전화 상담」 **단추**.
          · **담당자 없음** = 누구에게 거는지 없는 단추는 세우지 않는다. **번호를 글자로** 크게 둔다
            (폰에서 번호는 원래 눌러서 걸리므로 `tel:` 만 걸고 모양은 글자 그대로).
      */}
      {!who && phone && mobile && dock ? (
        <ShopDock fixed>
          <a href={telHref} style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: SHOP.sp.snug,
            width: '100%', textDecoration: 'none', whiteSpace: 'nowrap',
          }}>
            <span style={{ fontSize: SHOP.fs.cap, color: C.faint }}>{CONTACT_LABEL}</span>
            {/* ★번호는 «읽는 값»이라 서식을 입힌다(집 원자 `fmtPhone`). */}
            <span style={{
              fontSize: SHOP.fs.lead, fontWeight: FW.head, color: C.ink,
              fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
            }}>{phoneText}</span>
          </a>
        </ShopDock>
      ) : null}
      {who && phone && mobile && dock ? (
        <ShopDock fixed sideWidth="auto" side={(
          <div style={{ display: 'flex', flexDirection: 'column', gap: SHOP.sp.tight, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: SHOP.fs.cap, color: C.faint }}>{who ? '담당' : '고객센터'}</span>
            <span style={{ fontSize: SHOP.fs.body, fontWeight: FW.title, color: C.ink }}>{who || phoneText}</span>
          </div>
        )}>
          <ShopDockAction href={telHref} label="담당자에게 전화합니다">
            <Phone size={ICON.md} aria-hidden />전화 상담
          </ShopDockAction>
        </ShopDock>
      ) : null}

      <footer style={{ borderTop: `1px solid ${C.line}`, marginTop: 24 }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px 32px' }}>
          {/* ★푸터도 «같은 CI» 다 — 머리띠와 짜임이 다르면 한 화면에 두 얼굴이 된다. 톤만 흐리게. */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: SHOP.sp.cozy }}>
            <ChannelWordmark wl={wl} fs={18} color={C.faint} />
          </div>
          <div style={{ fontSize: SHOP.fs.sub, color: C.faint, lineHeight: 1.9 }}>
            {/*
              ⚠⚠ **「[미확인]」이 손님에게 그대로 나가고 있었다** — 2026-09-07 운영 실측
                「인천시 서구 봉오재3로 90 · **통신판매업신고 [미확인]**」.
              ★표에서 모르는 값을 `[대괄호]` 로 두는 것은 **우리끼리 쓰는 표시**다(「지어내지 않는다」).
                그런데 그 표시가 «손님 화면»까지 흘러나가면, 못 채운 칸이 있다고 광고하는 꼴이다.
              ⇒ 화면에서는 **대괄호가 든 조각만 뺀다.** 표는 그대로 둔다 —
                값이 들어오는 날 저절로 다시 나온다(표만 고치면 되고 코드는 안 건드린다).
              ★조각 단위로 뺀다 — 줄째 빼면 주소까지 같이 사라진다(위 줄이 「주소 · 신고번호」다).
            */}
            {wl.bizLines.map((line) => {
              const shown = line.split('·').map((x) => x.trim())
                .filter((x) => x && !/\[[^\]]*\]/.test(x)).join(' · ');
              return shown ? <div key={line}>{shown}</div> : null;
            })}
            {/*
              ★★**운영 주체를 밝힌다**(사장님 2026-09-07 「하단에는 **프리패스모빌리티가 운영을
                해주고 있다**고 해야 하고」). 계약·정산은 채널이 하고 **판을 굴리는 것은 우리**다 —
                손님이 「이 사이트 누가 만들었나」를 물을 때 답이 화면에 있어야 한다.
              ★머리띠의 «✕ freepass» 와 짝이다 — 위에서 한 번 보이고 아래에서 한 번 밝힌다.
            */}
            {/*
              ★★**한 단 진하게 — 이 줄은 «읽히라고» 있는 것이다**(사장님 2026-09-07
                「이 홈페이지는 **어디가 운영한다고 알려줘야지**」 — 이미 있는데 안 보이셨다).
              ⚠ 사업자 표기와 같은 `faint` 로 흘려 두니 «법으로 적어 두는 잔글씨»에 묻혔다.
                이건 잔글씨가 아니라 **손님이 「누구랑 거래하나」를 아는 줄**이다.
              ★그렇다고 크게 키우지는 않는다 — 글자 크기는 그대로(`sub`)고 색만 한 단 올린다.
                간판의 주인은 채널이고 우리는 «운영»이라고만 밝히는 자리다.
            */}
            <div style={{ marginTop: SHOP.sp.cozy, color: C.mute }}>
              이 홈페이지는 <strong style={{ fontWeight: FW.title, color: C.ink }}>{CORP.name}</strong>가 운영합니다.
            </div>
          </div>
          {/*
            영업자·직원 로그인 — **푸터 맨 밑에 조용히**(사장님 2026-09-05 「그 주소로 들어가면 상품부터
            다 보이는 거라고. 거길 들어가서 영업자는 로그인을 하는 거야」).
            손님은 로그인할 일이 없으니 위로 올리지 않는다. 그렇다고 없애면 영업자가 주소를 외워
            쳐야 한다 — 사업자 표기 밑 한 줄이 그 둘을 다 만족한다(회사 사이트가 흔히 그러는 자리다).

            ★★**조용한 것과 «못 찾는» 것은 다르다**(사장님 2026-09-07 「직원들 로그인할 수 있게 하는
              **버튼이 있어야 하는데**」 — 이미 있는데 못 보셨다).
            ⚠ 실측 — 「로그인」 넉 자, 12px, `C.faint`, 상자 31×18. 글자만 있어 **누를 것으로 안 읽혔고**,
              말도 「로그인」이라 손님은 「내 계정이 있나?」로, 직원은 제 것인지 모르고 지나쳤다.
            ⇒ 셋을 고친다. 조용함은 그대로 두고 «찾을 수 있게»만 한다:
              ㉠ 말 — 「**담당자 로그인**」. 손님은 제 것이 아님을 알고 지나가고, 직원은 제 것임을 안다.
              ㉡ 모양 — 옅은 테두리 + 아이콘. 글자만이면 링크인 줄 모른다. 색은 여전히 `faint` 다.
              ㉢ 로그인돼 있으면 **「업무 화면으로」**. 영업자가 손님 화면을 보다가 돌아갈 길이 없어
                 주소를 쳐야 했다. 같은 자리에서 말만 바뀐다.
            ★크기는 안 키운다 — 손님 화면의 주인공은 차다. 이 줄이 커지면 그 순간 우리 사정이 앞선다.
          */}
          <StaffLink />
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
      {/* ⚠ 폰 여백을 한 단 줄였다(사장님 2026-09-05 「간격이 너무 막 멀게 떨어져 있거나」) —
           이 블록이 폰 첫 화면에서 상품 앞에 서는 마지막 덩어리라, 여기서 번 세로가 곧 카드다. */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: mobile ? '12px 16px 12px' : '24px 24px 24px', position: 'relative' }}>
        <div style={{ fontSize: SHOP.fs.h1, fontWeight: FW.head, letterSpacing: '-0.04em', lineHeight: 1.3, color: C.ink, paddingRight: mobile ? 34 : 44 }}>
          {notice.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          <span style={{ fontSize: SHOP.fs.body, color: C.sub, lineHeight: 1.6 }}>{notice.body}</span>
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
            /* ★폰 44 — 손가락 규격(HIG 44 · 머티리얼 48). 32 는 그 밑이라 X 를 몇 번 헛누른다. */
            width: mobile ? 44 : 32, height: mobile ? 44 : 32, padding: 0, borderRadius: R_CARD,
            border: 'none', background: 'transparent', color: C.mute, cursor: 'pointer',
          }}
        >
          <X size={ICON.md} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * 담당자(영업자·직원)만 쓰는 한 줄 — 손님 화면의 **맨 밑, 제일 조용한 자리**.
 * ★로그인 전이면 「담당자 로그인」, 뒤면 「업무 화면으로」. 자리는 그대로고 말만 바뀐다.
 * ★가는 곳은 `/finder`(상품찾기) — 역할과 무관하게 누구나 들어가는 층이라 여기서 갈리지 않는다.
 */
function StaffLink() {
  const session = useSession();
  const inside = !!session;
  return (
    <a
      href={inside ? '/finder' : '/login'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: SHOP.sp.tight,
        marginTop: SHOP.sp.edge, padding: '6px 10px',
        border: `1px solid ${C.line}`, borderRadius: SHOP.r.chip,
        fontSize: SHOP.fs.cap, color: C.faint, textDecoration: 'none',
      }}
    >
      {inside
        ? <><SquareArrowOutUpRight size={13} aria-hidden />업무 화면으로</>
        : <><LogIn size={13} aria-hidden />담당자 로그인</>}
    </a>
  );
}
