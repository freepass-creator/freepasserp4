'use client';
import type { CSSProperties, ReactNode } from 'react';
import { Search, X, ChevronDown, type LucideIcon } from 'lucide-react';
import { C, FW, ICON, PILL_R, R_CARD } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';

/**
 * 가게(손님 동) 원자 — **업무동 콕핏 원자를 쓰지 않는다.**
 *
 * 사장님 2026-09-04 「검색창이고 좌측 사이드바 필터하고 **기존 거 활용하지 말고** 새로이
 * 아까 우리 얘기된 거대로 좀 설계하고」.
 *
 * 왜 갈랐나. 업무동 원자는 **하루 종일 콕핏을 보는 사람**을 위한 규격이다 — 높이 32,
 * 글자 12~13, 각진 모서리 4. 한 화면에 최대한 많이 담는 것이 이득인 곳이라 그렇게 짜여 있다.
 * 손님은 정반대다. 처음 온 사람이 **한 번 훑고 고르는** 화면이라 타깃이 크고 글자가 커야 하고,
 * 마켓이 공통으로 쓰는 둥근 모서리·넉넉한 여백이 「살 수 있는 곳」처럼 보이게 만든다.
 * 두 규격을 한 원자에 넣으면 어느 쪽도 제 치수를 못 갖는다.
 *
 * ★그래도 **색은 토큰**(`C.*`)이다. `.fp-wl` 이 채널 색으로 토큰을 뒤집으므로, 채널이 늘어도
 *   이 파일은 한 줄도 안 고친다. 하드코딩 hex 는 여기서도 금지다.
 * ★페이지가 손롤하지 않게 **여기가 규격**이다 — 화면은 이 원자를 배열만 한다.
 */

/** 가게 치수 — 손님 화면의 규격. 업무동 `CTRL` 과 «일부러» 다르다. */
export const SHOP = {
  /** 컨트롤 높이 — 웹 44 / 모바일 48(엄지). 업무동 md(32/40)보다 한 단 크다. */
  h: { web: 44, mobile: 48 },
  /**
   * **누르는 «영역»의 최소 크기** — 웹 36 / 모바일 44. ★**보이는 크기가 아니다.**
   *
   * 사장님 2026-09-05 ① 「모바일에서 **체크박스가 너무 작으면 선택하기가 힘드니까** 통상 규격」
   *                  ② 「**버튼이나 칩·검색창이 좀 커 보인다**. 유튜브나 다른 데 가보니까…」
   * ⚠⚠ 둘은 안 부딪힌다. 내가 ①을 듣고 **누르는 영역과 보이는 크기를 같은 것으로 보고** 알약까지
   *   44~48 로 키운 것이 ②의 정체다. 머티리얼 규격서도 **칩의 높이는 32dp**, 터치 대상은
   *   «좌우 여백으로» 48dp 를 만든다고 적는다 — 크기와 영역은 따로 잡는 값이다.
   * ★그래서 셋으로 나눈다:
   *   · `tap`  = 줄·체크처럼 **영역이 곧 크기**인 것(목록 행). 폰 44 = HIG 최소.
   *   · `pill` = 가로로 여러 개 서는 칩·고르개. 폰 38(보이는 높이) + 좌우 여백으로 영역을 번다.
   *   · `icon` = 라벨 없는 정사각 아이콘 단추. 폰 40.
   * ★**누르는 자리는 줄 «전체»**다 — 체크 네모(20)만 누를 수 있으면 그 20px 을 겨냥해야 한다.
   */
  tap: { web: 36, mobile: 44 },
  /** 칩·정렬 고르개의 **보이는 높이** — 한 줄에 나란히 서므로 둘이 같아야 한다. */
  pill: { web: 36, mobile: 38 },
  /** 라벨 없는 정사각 아이콘 단추(닫기·상세조건). 칩보다 살짝 크게 잡아 손이 쉽게 닿는다. */
  icon: { web: 36, mobile: 40 },
  /** 둥글기 — 마켓의 기본. 업무동 R(4, 각짐)과 다른 이유가 이 파일 머리말에 있다. */
  /**
   * **둥글기 사다리 — 넷뿐이다**(사장님 2026-09-05 「배지 같은 거를 동그란 알약으로 하는 게 맞나,
   * 아니면 조금 **무게감 있게 격식 있게 통일감**을 주는 게 맞나. 난 이게 제일 헷갈려」).
   *
   * | 값 | 무엇 | 왜 |
   * |---|---|---|
   * | `card` 12 | 담는 것 — 카드·사진·큰 면 | 제일 크니까 제일 둥글다 |
   * | `ctrl` 10 | 누르는 것 — 버튼·검색·조건 알약·시트·정렬 | 손이 닿는 것 |
   * | `chip` 8 | 표시 — 뱃지·칩·사진 위 신호·「n/N」 | 읽기만 하는 것 |
   * | `pill` 999 | **진짜 동그란 것만** — 색 견본 점·건수 동그라미·갤러리 화살표 | 모양 자체가 원이다 |
   *
   * ⚠ 전에는 이 화면에 둥글기가 셋(999·12·8)이 «규칙 없이» 섞여 있었다. 그래서 「알약이냐 사각이냐」가
   *   헷갈렸던 것이다 — 답은 둘 중 하나를 고르는 게 아니라 **사다리를 하나 정하는 것**이었다.
   * ★★**알약(999)을 컨트롤에 쓰지 않는다.** 이유 셋 —
   *   ㉠ 방금 정한 브랜드가 «중후·신뢰»다(깊은 남색). 알약은 소비자 앱의 가벼운 말씨라 색과 말이 어긋난다.
   *   ㉡ 알약은 «높이가 곧 둥글기»라 통일이 안 된다 — 44 짜리는 22R, 28 짜리는 14R 로 제각각 보인다.
   *   ㉢ 중고차 쪽도 각진 편이다(엔카 4 · 케이카 6~8). 값이 크고 무거운 판일수록 각이 선다.
   * ★역할이 모양으로 읽힌다 — 담는 것 > 누르는 것 > 표시 순으로 둥글기가 줄어든다.
   */
  r: { chip: 8, ctrl: 10, box: R_CARD, card: 12, pill: PILL_R },
  /**
   * 글자 — 업무동 FS 는 18에서 끝나지만 손님 화면은 그 위가 필요하다.
   *
   * ★★**body·sub·cap 은 «폰에서 한 단 올라간다»**(14.5/13/12 → 16/14/13).
   *   사다리는 `app/globals.css` 의 `.fp-wl` 변수 한 곳에 있다(그 머리말 참고) —
   *   여기서 숫자를 박으면 폰이 웹 치수를 그대로 쓰게 되어, 실측 438개 글자 중 259개가 13px 이었다.
   * ⚠ 그래서 이 셋은 **문자열(`var(...)`)**이다. 숫자를 기대하는 자리(아이콘 크기 등)에 넣지 말 것.
   */
  fs: {
    hero: 30, heroM: 22, h1: 20, h2: 16,
    body: 'var(--shop-fs-body)', sub: 'var(--shop-fs-sub)', cap: 'var(--shop-fs-cap)',
  },
  /**
   * **여백 사다리 — 4의 배수 여섯 칸.** 손으로 찍은 숫자를 쓰지 않는다.
   *
   * 사장님 2026-09-05 「**간격이랑 이런 거도 좀 짜임새 있게** 맞춰보자고」.
   * ⚠ 실측 — 가게 다섯 파일에 여백 값이 **3·4·5·6·7·8·9·10·11·12·13·14·18·20·22·26·28·30·34**
   *   열아홉 가지가 섞여 있었다. 눈으로 고를 때마다 한두 픽셀씩 다르게 찍혔기 때문이다.
   *   그러면 「여백이 뜻을 갖는」 일이 안 생긴다 — 9 와 10 은 사람 눈에 같은 간격이라,
   *   붙은 것과 떨어진 것이 «우연히» 갈린다.
   * ★그래서 칸을 여섯으로 못 박고 **뜻을 붙였다.** 고를 때 「몇 px?」이 아니라
   *   **「이 둘은 어떤 사이인가?」**를 묻는다.
   *
   * | 칸 | 값 | 뜻 |
   * |---|---|---|
   * | `tight` | 4 | **붙은 것** — 한 줄 안(아이콘↔글자) · 카드 넉 줄 사이 |
   * | `snug`  | 8 | **한 덩어리 안의 칸** — 칩 사이 · 조건 줄 사이 |
   * | `cozy`  | 12 | **덩어리의 경계** — 사진↔글 · 칩 줄 위아래 |
   * | `edge`  | 16 | **화면 가장자리** — 본문 좌우 여백 |
   * | `part`  | 24 | **다른 것들 사이** — 카드끼리 · 구역 사이 |
   * | `pane`  | 32 | **기둥 사이** — 웹 조건칸 ↔ 목록 |
   * | `wide`  | 48 | **웹 가로 구역 사이** — 넓은 화면에서만 필요한 한 칸 |
   *
   * ★16 은 «가장자리»만이다. 안쪽에서 16 을 쓰면 24(다른 것)와 12(같은 덩어리) 사이가 뭉개진다.
   * ★`wide` 는 **웹 가로**에만 쓴다. 세로로 48을 벌리면 화면이 그만큼 길어져 손해다.
   *   가로는 남는 자원이라 「이건 다른 묶음」을 여백만으로 말할 수 있다(상세 제원의 무리 나눔).
   * ★★**이 사다리는 «배치» 여백이다.** 칩 안쪽의 `2px`·`3px` 같은 값은 글자를 세우는
   *   «광학 여백»이라 여기 안 든다 — 줄과 줄, 덩어리와 덩어리 사이만 이 사다리를 탄다.
   */
  sp: { tight: 4, snug: 8, cozy: 12, edge: 16, part: 24, pane: 32, wide: 48 },
} as const;

/* ── 검색 ────────────────────────────────────────────────────────────────
 * **밑줄 한 줄**이다(사장님 2026-09-04 「검색창은 밑줄 형태로 깔끔하게 가는게 멋있어 보이던데
 * 그게 트렌드 같음」). 상자로 감싸면 조건칸의 네모들과 섞여 검색이 조건의 하나로 보인다.
 * 검색은 조건보다 «먼저 오는 것»이라 혼자 다른 모양이어야 한다.
 *
 * ★★오른쪽 끝에 **상세 조건 버튼**이 붙는다(사장님 2026-09-04 「모바일에서 그 검색창에 필터
 *   버튼 만들어가지고 그거 누르면 상세 필터는 나오게끔 해줘야 돼」).
 *   폰에는 왼쪽 기둥(조건칸)이 없어서 축 아홉으로 가는 문이 어딘가에는 있어야 하는데,
 *   **검색줄이 그 문의 제자리**다 — 「찾는다」는 행동이 시작되는 곳이라 손이 이미 거기 있다.
 *   알약 줄에 두면 조건 칩들과 같은 무게로 보여 「이것도 조건 하나」로 읽힌다.
 */
export function ShopSearch({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: SHOP.sp.cozy,
      /*
       * 웹 전용 «머리 검색» — 밑줄 하나로 선다. 폰은 이 줄을 안 쓴다(머리띠 안에서 튀어나온다 —
       * `ShopTopSearch` 머리말). 목록 위에 늘 깔아 두면 첫 화면에서 그만큼 상품이 밀린다.
       */
      height: 60, borderBottom: `2px solid ${C.ink}`,
    }}>
      <Search size={21} aria-hidden style={{ flex: '0 0 auto', color: C.ink }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="차량 검색"
        style={{
          flex: 1, minWidth: 0, height: '100%',
          border: 'none', outline: 'none', background: 'transparent',
          fontFamily: 'inherit', color: C.ink,
          fontSize: 18, letterSpacing: '-0.02em',
        }}
      />
      {value ? (
        <ShopIconBtn onClick={() => onChange('')} label="검색어 지우기">
          <X size={ICON.lg} aria-hidden />
        </ShopIconBtn>
      ) : null}
    </div>
  );
}

/** 테두리·바탕 없는 누름 — 아이콘/글자 버튼의 바닥. 같은 값을 다섯 군데 적지 않으려고 둔다. */
const bare: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'inherit', padding: 0,
};

/**
 * 조건 칩 — 가게의 «누르는 것» 기본형.
 *
 * ★★**선으로 가두지 않고 «면»으로 말한다**(사장님 2026-09-05 「유튜브 보니까 퀵필터가 약간
 *   **회색 배경에 텍스트**가 들어갔는데 우리도 그렇게 할까? **박스로 가두는 거는 조금 촌스러워** 보이고」).
 *   맞다. 테두리 칩은 한 줄에 여럿 서면 **가는 선이 대여섯 줄** 그어진 꼴이라 목록보다 칩이 시끄럽다.
 *   면으로 두면 선이 하나도 안 늘고, 켜짐/꺼짐이 «색의 진하기»라는 한 가지 축으로만 갈린다.
 * ★그래서 위계는 **면의 진하기**다 — 꺼짐 = 옅은 회색 면, 켜짐 = 브랜드 남색 면.
 *   모양(높이·둥글기)은 둘이 똑같다. 모양까지 갈리면 무엇이 같은 종류인지 안 보인다.
 * ⚠ 이 규칙은 칩만의 것이 아니다 — 정렬 고르개·「차량 더 보기」·공유·하단독 「이전」까지
 *   **가게의 «비주요» 누름은 전부 회색 면**이다. 하나만 테두리로 남으면 그것만 촌스러워 보인다.
 */
export function ShopPill({ on, onClick, children, title }: {
  on?: boolean; onClick: () => void; children: ReactNode; title?: string;
}) {
  const mobile = useIsMobile();
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={!!on} className="fp-shop-press fp-shop-fill"
      style={{
        ...bare,
        /*
         * ★★**「44/48」은 «눌리는 영역»이지 «보이는 크기»가 아니다**(사장님 2026-09-05
         *   「버튼·칩이 좀 커 보인다」 — 맞다. 내가 둘을 같은 것으로 보고 키웠다).
         *   머티리얼 규격서도 칩의 **높이는 32dp**, 터치 대상은 «여백으로» 48dp 를 만든다고 적는다.
         *   유튜브·플레이스토어의 필터 칩도 32~36 이다. 44 짜리 알약은 그 판에서 확실히 크다.
         * ⇒ 보이는 높이는 **38**(폰)로 내리고, 좌우 여백을 넉넉히 둬 실제 누를 면적을 지킨다.
         *   가로로 여러 개가 서는 줄이라 높이보다 «폭»이 헛누름을 더 잘 막는다.
         */
        height: mobile ? SHOP.pill.mobile : SHOP.pill.web,
        padding: mobile ? `0 ${SHOP.sp.edge}px` : `0 ${SHOP.sp.cozy}px`,
        borderRadius: SHOP.r.ctrl, whiteSpace: 'nowrap',
        /* 테두리 없음(`bare`) — 면으로만 말한다. 머리말 참고. */
        background: on ? C.brand : C.head,
        /* 꺼짐도 «진한 글자»다 — 면이 이미 배경에서 떼어 놓았으므로 흐리게 할 이유가 없다. */
        color: on ? C.inverse : C.ink,
        fontSize: mobile ? SHOP.fs.body : SHOP.fs.sub,
        fontWeight: on ? 700 : 500,
      }}>{children}</button>
  );
}

/**
 * 글자만 있는 누름 — 「초기화」·「해제」. 테두리를 주면 조건 버튼과 같은 무게로 읽혀,
 * 조건을 «고르는 것»과 «지우는 것»이 구분되지 않는다. 그래서 밑줄 없는 흐린 글자로만 둔다.
 */
export function ShopTextBtn({ onClick, children, tone = 'mute' }: {
  onClick: () => void; children: ReactNode; tone?: 'mute' | 'faint';
}) {
  return (
    <button type="button" onClick={onClick} className="fp-shop-press"
      style={{ ...bare, fontSize: SHOP.fs.cap, color: tone === 'faint' ? C.faint : C.mute }}>
      {children}
    </button>
  );
}

/**
 * 아이콘만 있는 누름 — 닫기·검색·조건. 손가락이 닿는 최소 크기를 원자가 보장한다(`SHOP.icon`).
 *
 * `count` 를 주면 아이콘 위에 **작은 숫자 표식**이 붙는다(걸린 조건 수). 0 이면 안 그린다 —
 * 0 을 보여 주는 것은 「없다」를 굳이 말하는 꼴이다.
 */
export function ShopIconBtn({ onClick, label, tone = 'mute', count, children }: {
  onClick: () => void; label: string; tone?: 'mute' | 'ink'; count?: number; children: ReactNode;
}) {
  const mobile = useIsMobile();
  const size = mobile ? SHOP.icon.mobile : SHOP.icon.web;
  return (
    <button type="button" onClick={onClick} aria-label={label} className="fp-shop-press"
      style={{
        ...bare, position: 'relative', width: size, height: size,
        borderRadius: SHOP.r.ctrl, color: count ? C.brand : tone === 'ink' ? C.ink : C.mute,
      }}>
      {children}
      {count ? (
        <span style={{
          position: 'absolute', top: 1, right: 0,
          minWidth: 17, height: 17, padding: '0 4px', borderRadius: SHOP.r.pill,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: C.brand, color: C.inverse,
          fontSize: 10, fontWeight: FW.strong, fontVariantNumeric: 'tabular-nums',
        }}>{count}</span>
      ) : null}
    </button>
  );
}

/**
 * **돋보기를 누르면 «퀵필터 칩 줄 위»로 나오는 검색칸** — 유튜브 모바일과 같은 짜임.
 *
 * 사장님 2026-09-05 「유튜브 모바일 **우측 상단에 돋보기를 누르면** 우리 원래 있던 그 **퀵필터 칩**
 * 있잖아. **그 위에 검색창이 나온다고. 거기서 검색을 하는 거**라고」.
 *
 * ★자리가 왜 여기인가 — 머리띠는 **간판(CI)의 자리**다. 거기를 검색칸이 덮으면 손님이 어느
 *   가게에 있는지가 검색하는 동안 사라진다. 돋보기는 «부르는 단추»고, 나오는 칸은 **일이 벌어지는
 *   본문**에 선다. 그래야 검색칸 → 칩 → 목록이 위에서 아래로 한 흐름으로 읽힌다.
 * ★평소에는 없다 — 목록 위에 검색줄을 늘 깔아 두면 폰 첫 화면에서 그만큼 상품이 밀린다.
 *   손님이 이 화면에 오는 이유는 「차를 본다」이지 「검색한다」가 아니다.
 * ★★**검색어가 있으면 안 접힌다.** 접혀서 칸이 사라지면 손님은 지금 목록이 왜 줄었는지
 *   화면에서 못 읽는다 — 「대수가 두 군데서 세어진다」와 같은 종류의 사고다.
 *   그래서 ✕ 는 **검색어를 지우고 접는다** — 둘은 한 동작이다.
 * ★칩 줄과 «한 덩어리»로 붙어 다닌다(`.fp-shop-stick` 안) — 목록을 내려가도 같이 따라온다.
 * ⚠ 자동 포커스를 «켠다» — 돋보기를 누른 사람은 칠 준비가 된 사람이고, 여기는 칸 하나뿐이라
 *   키보드가 가릴 조건 패널이 없다.
 */
export function ShopRevealSearch({ value, onChange, onClose, placeholder }: {
  value: string; onChange: (v: string) => void; onClose: () => void; placeholder?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SHOP.sp.tight, paddingTop: SHOP.sp.cozy }}>
      <div style={{
        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: SHOP.sp.snug,
        /* 칩과 같은 회색 «면» — 테두리를 두르지 않는다(가게 공통 · `ShopPill` 머리말). */
        height: 44, background: C.head, borderRadius: SHOP.r.ctrl, padding: `0 ${SHOP.sp.cozy}px`,
      }}>
        <Search size={19} aria-hidden style={{ flex: '0 0 auto', color: C.mute }} />
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label="차량 검색"
          style={{
            flex: 1, minWidth: 0, height: '100%',
            background: 'transparent', border: 'none', outline: 'none',
            fontFamily: 'inherit', color: C.ink,
            /* ★16 «고정» — 그 밑이면 iOS 가 화면을 확대한다. 사다리를 내려도 여기는 못 내린다. */
            fontSize: 16, letterSpacing: '-0.02em',
          }}
        />
      </div>
      {/* ✕ = 지우고 접는다(위 머리말). 칸 «안»에 넣으면 「지우기」인지 「닫기」인지 갈리지 않는다. */}
      <ShopIconBtn onClick={onClose} label="검색 닫기">
        <X size={ICON.lg} aria-hidden />
      </ShopIconBtn>
    </div>
  );
}

/**
 * 꽉 채운 주요 버튼 — 폰 조건 시트의 「N대 보기」처럼 «이 화면의 결론»인 자리.
 * 높이 52 는 엄지로 누르는 마지막 버튼의 치수다(업무동 md 40 은 콕핏 규격이라 여기선 작다).
 */
export function ShopPrimary({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="fp-shop-press"
      style={{
        ...bare, width: '100%', height: 52, borderRadius: SHOP.r.ctrl,
        background: C.brand, color: C.inverse,
        fontSize: SHOP.fs.body, fontWeight: 700,
      }}>{children}</button>
  );
}

/**
 * 「적용한 조건」 줄 — **마켓이면 반드시 있는 것.**
 *
 * 조건을 넷 걸어 놓고 목록이 3대가 되면, 손님은 «무엇 때문에» 줄었는지 알아야 한다.
 * 왼쪽 기둥을 위아래로 훑어 켜진 것을 찾게 만들면 대부분 그냥 나간다.
 * 그래서 걸린 조건을 목록 «바로 위»에 늘어놓고, 하나씩 떼어 낼 수 있게 한다.
 * ★토큰에는 축 이름을 붙인다(「제조사 기아」) — 「기아」만 있으면 그게 제조사인지 모델인지 모른다.
 */
export function ShopTokens({ tokens, onRemove, onClear }: {
  tokens: { axis: string; key: string; label: string; axisLabel: string }[];
  onRemove: (axis: string, key: string) => void;
  onClear: () => void;
}) {
  if (!tokens.length) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: SHOP.sp.snug,
      padding: `${SHOP.sp.cozy}px 0 ${SHOP.sp.tight}px`,
    }}>
      {tokens.map((t) => (
        <span key={`${t.axis}:${t.key}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: SHOP.sp.snug,
            height: 34, padding: `0 ${SHOP.sp.tight}px 0 ${SHOP.sp.cozy}px`, borderRadius: SHOP.r.chip,
            /* 걸린 조건은 «브랜드 틴트 면» — 회색 칩(고르는 것)과 색으로 갈린다. 테두리는 안 두른다. */
            background: C.brandBg,
            fontSize: SHOP.fs.sub, color: C.ink, fontWeight: 600,
          }}>
          <span style={{ color: C.mute, fontWeight: 500 }}>{t.axisLabel}</span>
          {t.label}
          <button type="button" onClick={() => onRemove(t.axis, t.key)}
            aria-label={`${t.axisLabel} ${t.label} 조건 빼기`}
            style={{ ...bare, width: 22, height: 22, borderRadius: SHOP.r.chip, color: C.mute }}>
            <X size={ICON.sm} aria-hidden />
          </button>{/* 토큰 안의 × 는 22 — 원자 ShopIconBtn(36)을 쓰면 알약이 그만큼 커진다 */}
        </span>
      ))}
      <ShopTextBtn onClick={onClear}>조건 모두 지우기</ShopTextBtn>
    </div>
  );
}

/**
 * 정렬 — 드롭다운이다(사장님 2026-09-04 「낮은대여료순 높은대여료순 이거는 드랍다운으로
 * 해야하고, 종류도 좀 더 있어야하고」). 칩으로 늘리면 다섯 개가 한 줄을 다 먹어 목록을 밀어낸다.
 * ★네이티브 `select` 를 쓴다 — 폰에서 OS 고유의 고르개가 뜨는 편이 손님에게 훨씬 익숙하다.
 */
export function ShopSort({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: readonly { key: string; label: string }[];
}) {
  const mobile = useIsMobile();
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="정렬"
        style={{
          appearance: 'none', WebkitAppearance: 'none',
          /* 정렬 고르개도 칩과 같은 치수(`SHOP.pill`) — 한 줄에 나란히 서므로 높이가 달라 보이면 안 된다. */
          height: mobile ? SHOP.pill.mobile : SHOP.pill.web, padding: '0 34px 0 14px',
          /* 칩과 같은 «면» — 한 화면에서 칩만 면이고 고르개만 테두리면 그 줄이 어긋나 보인다. */
          borderRadius: SHOP.r.ctrl, border: 'none', background: C.head,
          fontFamily: 'inherit', fontSize: mobile ? SHOP.fs.body : SHOP.fs.sub,
          color: C.ink, fontWeight: 600, cursor: 'pointer',
        }}>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <ChevronDown size={ICON.md} aria-hidden
        style={{ position: 'absolute', right: 11, pointerEvents: 'none', color: C.mute }} />
    </div>
  );
}

/**
 * 대수 — 이 화면에서 손님이 가장 먼저 읽는 숫자.
 *
 * ★★**조건이 걸리면 «남은 수»를 말한다**(2026-09-05 실측 사고). 전에는 늘 「전체차량 716대」였다 —
 *   조건을 넷 걸어 3대만 남아도 머리는 716 이었다. 웹은 오른쪽에 「N대 중 1–M」이 따로 있어 덜했지만,
 *   **폰은 이게 유일한 건수**라 손님이 「조건을 더 걸어야 하나 풀어야 하나」를 판단할 근거가 화면에 없었다.
 * ★말도 같이 바꾼다 — 조건이 걸린 채 「전체차량 3대」라고 하면 그건 재고가 3대라는 뜻이 된다.
 */
export function ShopCount({ value, filtered }: { value: string; filtered?: boolean }) {
  const mobile = useIsMobile();
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
      <span style={{ fontSize: SHOP.fs.sub, fontWeight: 500, color: C.mute }}>
        {filtered ? '조건에 맞는 차량' : '전체차량'}
      </span>
      <span style={{
        fontSize: mobile ? SHOP.fs.h1 : 26, fontWeight: 800, color: C.brand,
        letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
      <span style={{ fontSize: SHOP.fs.sub, fontWeight: 700 }}>대</span>
    </div>
  );
}

/**
 * 조건에 맞는 차가 없을 때 — **막다른 길을 만들지 않는다.**
 * 「없습니다」로 끝내면 손님이 할 수 있는 게 뒤로가기뿐이다. 나가는 문(조건 지우기)을 같이 준다.
 */
export function ShopEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div style={{ padding: '72px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: SHOP.fs.h2, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
        조건에 맞는 차량이 없습니다
      </div>
      <div style={{ fontSize: SHOP.fs.body, color: C.mute, lineHeight: 1.7, marginBottom: 20 }}>
        조건을 조금 넓히면 비슷한 차량을 찾을 수 있습니다.<br />
        원하시는 차량이 없으면 담당자에게 문의해 주세요.
      </div>
      {/*
        ★**검색어까지** 지운다(2026-09-05 검토). 위 토큰 줄의 「조건 모두 지우기」는 축만 푼다 —
          검색어를 쳐서 0건이 된 손님은 그걸 눌러도 여전히 0건이라 «막다른 길»이 그대로다.
          여기는 그 마지막 문이라 검색어까지 같이 지운다. 그래서 토큰 줄과 중복이 아니다.
      */}
      <ShopPill onClick={onClear}>처음부터 다시 찾기</ShopPill>
    </div>
  );
}

/** 더 보기 — 몇 대를 보고 있고 몇 대가 남았는지 같이 말한다(누르기 전에 알아야 누른다). */
export function ShopMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: `${SHOP.sp.part}px 0 ${SHOP.sp.snug}px` }}>
      <button type="button" onClick={onMore} className="fp-shop-press"
        style={{
          ...bare, height: 52, padding: '0 34px', borderRadius: SHOP.r.ctrl,
          /* 목록 끝의 «비주요» 누름 — 칩과 같은 회색 면. 테두리 상자로 두면 여기만 촌스럽다. */
          background: C.head, color: C.ink,
          fontSize: SHOP.fs.body, fontWeight: 700,
        }}>
        차량 더 보기 <span style={{ color: C.mute, fontWeight: 500, marginLeft: 6 }}>{shown} / {total}</span>
      </button>
    </div>
  );
}

/* ── 표시 칩 ─────────────────────────────────────────────────────────────
 * **목록 카드와 상세가 «같은 물건»을 쓴다**(사장님 2026-09-05 「목록 페이지하고 전체 구성
 * 한번 맞춰보자. **상세 페이지에 맞는 자연스러운 화면인지, 일체감이 있는지**」).
 *
 * ⚠⚠ 같은 값(무심사·분납가능·만21세·경력무관)이 **두 화면에서 다른 모양**이었다 —
 *   목록 카드는 **테두리 두른 박스 뱃지**, 상세는 아이콘 + 글자. 손님은 같은 차를 보다가
 *   화면이 바뀌면 「다른 표시인가」를 한 번 생각한다.
 *   집 규칙도 목록 쪽이 틀린 편이었다 — 사장님 2026-08-28·08-30 「**박스 뱃지 쓰지 말고
 *   아이콘 텍스트로, 모든 곳에서**」. 손님 카드가 그 「모든 곳」에서 빠져 있었다.
 * ⇒ 두 얼굴을 여기 한 곳에 두고 양쪽이 부른다. 새로 그리지 않는다.
 */
export type ShopMark = {
  text: string;
  icon: LucideIcon;
  /** 좋은 소식(초록) — 출고가능·즉시출고·무심사. */
  good?: boolean;
  /** 손님이 «해야 할 일»(흐린 회색) — 소득확인·신용조회. 혜택 색을 주면 서류가 혜택으로 보인다. */
  ask?: boolean;
};

/**
 * **신원 칩** — 출고상태 · 상품구분. 「이 차가 지금 어떤 물건인가」를 통보하는 값이다.
 * 연한 «면» 위 작은 글자(딱지). **테두리는 두르지 않는다** — 테두리가 붙는 순간 그게 박스 뱃지다.
 */
export function StateChip({ mark, fs = SHOP.fs.cap }: { mark: ShopMark; fs?: number | string }) {
  const Icon = mark.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '5px 10px', borderRadius: SHOP.r.chip,
      background: mark.good ? C.okBg : C.zebra,
      color: mark.good ? C.ok : C.mute,
      fontSize: fs, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      <Icon size={13} aria-hidden />{mark.text}
    </span>
  );
}

/**
 * **조건 칩** — 심사 · 우대조건. 「**내가 되나**」의 답이라 성격이 아주 다르다.
 *
 * ★**면을 안 깐다 — 아이콘 + 글자만.** 면이 없으면 신원 딱지와 한눈에 갈리고, 글자를 진하게
 *   세울 수 있어 **오히려 더 또렷하다** — 회색 면에 회색 글자로 눕히면 셀링포인트가 딱지로 보인다.
 * ★**색은 아이콘에만**, 글자는 먹색(집 규칙 · `DESIGN_CONFIRMED_LIST_CARD` §카드).
 */
export function PerkMark({ mark, fs = SHOP.fs.sub, size = 15 }: {
  mark: ShopMark; fs?: number | string; size?: number;
}) {
  const Icon = mark.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: SHOP.sp.tight,
      color: C.ink, fontSize: fs, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      <Icon size={size} aria-hidden style={{ color: mark.good ? C.ok : mark.ask ? C.faint : C.brand }} />
      {mark.text}
    </span>
  );
}

/** 조건 칩 줄 — 사이를 넉넉히 벌린다(붙여 놓으면 다시 «칩 줄»로 보인다). */
export function PerkMarks({ marks, fs, size, columnGap = SHOP.sp.edge }: {
  marks: ShopMark[]; fs?: number | string; size?: number; columnGap?: number;
}) {
  if (!marks.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap, rowGap: SHOP.sp.snug }}>
      {marks.map((m) => <PerkMark key={m.text} mark={m} fs={fs} size={size} />)}
    </div>
  );
}
