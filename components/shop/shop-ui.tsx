'use client';
import type { CSSProperties, ReactNode } from 'react';
import { Search, X, ChevronDown, SlidersHorizontal } from 'lucide-react';
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
  /** 둥글기 — 마켓의 기본. 업무동 R(4, 각짐)과 다른 이유가 이 파일 머리말에 있다. */
  r: { chip: PILL_R, box: R_CARD, card: 12 },
  /** 글자 — 업무동 FS 는 18에서 끝나지만 손님 화면은 그 위가 필요하다. */
  fs: { hero: 30, heroM: 22, h1: 20, h2: 16, body: 14.5, sub: 13, cap: 12 },
  gap: { pane: 32, block: 22, row: 10 },
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
export function ShopSearch({ value, onChange, placeholder, onFilter, filterCount = 0 }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  /** 넘기면 오른쪽 끝에 상세 조건 버튼이 선다(폰 전용 — 웹은 왼쪽 기둥이 그 일을 한다). */
  onFilter?: () => void;
  /** 지금 걸린 조건 수. 0이면 숫자를 안 그린다(0을 보여 주면 «없다»를 굳이 말하는 꼴이다). */
  filterCount?: number;
}) {
  const mobile = useIsMobile();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: mobile ? 10 : 12,
      height: mobile ? 56 : 64, borderBottom: `2px solid ${C.ink}`,
    }}>
      <Search size={mobile ? 20 : 22} aria-hidden style={{ flex: '0 0 auto', color: C.ink }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="차량 검색"
        style={{
          flex: 1, minWidth: 0, height: '100%',
          border: 'none', outline: 'none', background: 'transparent',
          fontFamily: 'inherit', color: C.ink,
          // 모바일 16px 미만이면 iOS 가 입력칸에 확대를 건다 — 손님 화면에서 특히 티가 난다.
          fontSize: mobile ? 17 : 19, letterSpacing: '-0.02em',
        }}
      />
      {value ? (
        <ShopIconBtn onClick={() => onChange('')} label="검색어 지우기">
          <X size={ICON.lg} aria-hidden />
        </ShopIconBtn>
      ) : null}
      {onFilter ? (
        <>
          {/* 가는 세로선 — 「검색어」와 「조건」이 다른 일임을 한 획으로 말한다. */}
          <span aria-hidden style={{ width: 1, height: 22, background: C.line, flex: '0 0 auto' }} />
          <button type="button" onClick={onFilter} aria-label="상세 조건 열기" className="fp-shop-press"
            style={{
              position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, borderRadius: 999, flex: '0 0 auto',
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: filterCount ? C.brand : C.ink,
            }}>
            <SlidersHorizontal size={21} aria-hidden />
            {filterCount ? (
              // 걸린 조건 수 — 아이콘 위 작은 표식. 「조건이 살아 있다」를 안 보고도 알아야 한다.
              <span style={{
                position: 'absolute', top: 1, right: 0,
                minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: C.brand, color: C.inverse,
                fontSize: 10, fontWeight: FW.strong, fontVariantNumeric: 'tabular-nums',
              }}>{filterCount}</span>
            ) : null}
          </button>
        </>
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
 * 알약 버튼 — 가게의 «누르는 것» 기본형. 고른 것은 브랜드색 채움, 아닌 것은 테두리만.
 * 모양은 하나로 두고 **위계는 색으로만** 낸다(모양까지 갈리면 무엇이 같은 종류인지 안 보인다).
 */
export function ShopPill({ on, onClick, children, title }: {
  on?: boolean; onClick: () => void; children: ReactNode; title?: string;
}) {
  const mobile = useIsMobile();
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={!!on} className="fp-shop-press"
      style={{
        ...bare,
        height: mobile ? 40 : 36, padding: mobile ? '0 15px' : '0 14px',
        borderRadius: SHOP.r.chip, whiteSpace: 'nowrap',
        border: `1px solid ${on ? C.brand : C.line}`,
        background: on ? C.brand : 'transparent',
        color: on ? C.inverse : C.sub,
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

/** 아이콘만 있는 누름 — 닫기 등. 손가락이 닿는 최소 크기(36)를 원자가 보장한다. */
export function ShopIconBtn({ onClick, label, children }: {
  onClick: () => void; label: string; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="fp-shop-press"
      style={{ ...bare, width: 36, height: 36, borderRadius: 999, color: C.mute }}>
      {children}
    </button>
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
        ...bare, width: '100%', height: 52, borderRadius: SHOP.r.chip,
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
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
      padding: '14px 0', borderBottom: `1px solid ${C.line2}`,
    }}>
      {tokens.map((t) => (
        <span key={`${t.axis}:${t.key}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            height: 34, padding: '0 6px 0 13px', borderRadius: SHOP.r.chip,
            background: C.brandSoft, border: `1px solid ${C.brandBg}`,
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
          height: mobile ? 40 : 36, padding: '0 34px 0 14px',
          borderRadius: SHOP.r.chip, border: `1px solid ${C.line}`, background: 'transparent',
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
 * 「전체차량 N대」 — 가게의 머릿수. 조건칸 꼭대기에 선다.
 * 숫자만 브랜드색으로 크게 — 손님이 이 화면에서 가장 먼저 읽는 값이다.
 */
export function ShopCount({ value }: { value: string }) {
  const mobile = useIsMobile();
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
      <span style={{ fontSize: SHOP.fs.sub, fontWeight: 500, color: C.mute }}>전체차량</span>
      <span style={{
        fontSize: mobile ? SHOP.fs.h1 : 26, fontWeight: FW.head, color: C.brand,
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
      <ShopPill onClick={onClear}>조건 모두 지우기</ShopPill>
    </div>
  );
}

/** 더 보기 — 몇 대를 보고 있고 몇 대가 남았는지 같이 말한다(누르기 전에 알아야 누른다). */
export function ShopMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '30px 0 8px' }}>
      <button type="button" onClick={onMore} className="fp-shop-press"
        style={{
          ...bare, height: 52, padding: '0 34px', borderRadius: SHOP.r.chip,
          border: `1px solid ${C.line}`, color: C.ink,
          fontSize: SHOP.fs.body, fontWeight: 700,
        }}>
        차량 더 보기 <span style={{ color: C.mute, fontWeight: 500, marginLeft: 6 }}>{shown} / {total}</span>
      </button>
    </div>
  );
}
