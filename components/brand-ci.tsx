'use client';
import { C, FW } from '@/components/ui';
import { BRAND_FONT, BRAND_MAIN, BRAND_MARK } from '@/lib/brand';
import type { Whitelabel } from '@/lib/whitelabel';

/**
 * **간판(CI) 원자 — 채널 이름과 우리 이름을 «CI 로» 세우는 곳은 여기 하나다.**
 *
 * 사장님 2026-09-07 「**X 하고 프리패스도 CI 있는데 그거 반영 전혀 안 했고**,
 * **유니오토모빌도 짜임새 있게 CI 구성**해줘야 함」.
 *
 * ## ① 우리가 CI 를 «지어내고» 있었다
 *
 * 채널 워드마크를 「UNI」26/700 + 「AUTOMOBILE」15/500·자간 0.15em 으로 그리고 있었다 —
 * 웹에서 흔한 «두 톤 워드마크» 꼴이다. 그런데 **그 회사의 실제 CI 는 그렇게 안 생겼다.**
 * 받은 원본(`public/brand/uni-black.png`)을 실측하면:
 *
 * | | 공식 CI | 우리가 그리던 것 |
 * |---|---|---|
 * | 크기·굵기 | **둘이 같다**(한 워드마크) | UNI 700/26 · AUTOMOBILE 500/15 |
 * | 자간 | 글자 사이 = 캡높이의 **0.24배**로 «고르게» | UNI −0.03em · AUTOMOBILE +0.15em |
 * | 전체 폭 | 캡높이의 **12.38배** | 캡높이의 8.7배 |
 *
 * ⇒ 「채널이 실제로 쓰는 마크를 쓴다. 우리가 지어내지 않는다」(`lib/whitelabel.ts`)는 규칙이
 *   **마크에만** 지켜지고 글자에는 안 지켜지고 있었다. 공식 짜임으로 맞춘다 —
 *   **한 크기 · 한 굵기 · 고른 자간**, 두 낱말 사이는 낱말 사이만큼.
 *
 * ## ② 프리패스도 CI 가 있다
 *
 * 「✕ freepass」를 **본문 서체(Pretendard) 맨글자**로 적어 놨었다. 그건 연한 게 아니라
 * **CI 가 없는** 것이다. 정본은 `lib/brand.ts` — 마크(체크)와 **Exo 2 소문자 워드마크**.
 * ⚠ 톤은 그대로 아주 연하게 둔다(사장님 2026-09-07 「CI 뒤에 x 랑 freepass 는 **아주 연하게**」).
 *   **꼴과 톤은 다른 이야기다** — 꼴은 정본대로, 톤만 내린다.
 *
 * ## ③ 한 군데서 그린다
 *
 * 같은 워드마크가 **머리띠 · 푸터 · 로그인** 셋에 각각 손으로 짜여 있었다. 한쪽만 고치면
 * 다른 쪽을 볼 때마다 「또 원래대로」가 된다(CLAUDE.md 절대원칙 3). 그래서 원자로 모은다.
 */

/** 대문자 캡 높이 ÷ 글자 크기 — Pretendard 실측(19/26 · 16/22 · 11/15). */
const CAP = 0.727;
/**
 * 줄상자 가운데 → 캡 밴드 가운데 (em).
 *
 * `line-height:1` 인 대문자 줄은 **상자 가운데보다 이만큼 밑에** 앉는다(밑으로 내려가는 획이
 * 없어서다). 마크를 상자 가운데에 맞추면 그만큼 «떠» 보인다 — 그 차이를 마크에 되먹인다.
 * (Pretendard asc 1.06 · desc 0.196 실측에서 나온 비율이라 글자 크기와 무관하다.)
 */
const CAP_NUDGE = 0.068;
/** 공식 CI 의 자간 — 글자 사이가 캡높이의 0.24배가 되는 값(실측으로 폭÷캡 = 12.38 에 맞췄다). */
const TRACK = '0.045em';

/**
 * 채널 워드마크 — **한 낱말처럼 한 span 이다.**
 * ★둘로 쪼개면 낱말 사이가 자간이 아니라 flex gap 이 되어, 글자 크기를 바꿀 때마다
 *   낱말 사이만 따로 어긋난다(전에 그랬다).
 * ★색은 부르는 쪽이 정한다 — 머리띠는 먹색, 푸터는 흐린색.
 */
export function ChannelWordmark({ wl, fs, color = C.ink }: { wl: Whitelabel; fs: number; color?: string }) {
  return (
    <span style={{
      fontSize: fs, fontWeight: FW.head, letterSpacing: TRACK, lineHeight: 1, color,
      whiteSpace: 'nowrap',
    }}>
      {`${wl.wordmark.main} ${wl.wordmark.sub}`.trim()}
    </span>
  );
}

/**
 * 채널 간판 = **마크 + 워드마크 한 덩어리.**
 *
 * ★**마크 높이는 «캡 높이»에 매단다**(1.5배) — 글자 크기가 바뀌면 마크가 따라온다.
 *   전에는 마크 28 · 캡 19 라 마크가 글자를 **위로 6.2 · 아래로 2.8** 삐져나와 있었다.
 * ★세로는 **캡 밴드 가운데**에 맞춘다(`CAP_NUDGE`).
 */
export function ChannelSign({ wl, fs, gap }: { wl: Whitelabel; fs: number; gap: number }) {
  const cap = fs * CAP;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap }}>
      {wl.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- 채널마다 다른 마크라 정적 최적화 대상이 아니다.
        <img src={wl.logo.src} alt={wl.logo.alt} style={{
          height: Math.round(cap * 1.5), width: 'auto', display: 'block',
          /* ⚠ `margin` 이 아니라 `transform` — 여백을 주면 줄상자가 같이 커져 옆의 글자가 밀린다. */
          transform: `translateY(${(fs * CAP_NUDGE).toFixed(2)}px)`,
        }} />
      ) : null}
      <ChannelWordmark wl={wl} fs={fs} />
    </span>
  );
}

/**
 * 프리패스 마크 — `public/icon.svg`(브라우저·PWA 아이콘)와 **같은 좌표**(`lib/brand.ts`).
 * ★판은 `currentColor` 다 — 부르는 쪽의 색을 그대로 입는다. 동반 표기 자리에서는 연회색이 되고,
 *   제 색으로 써야 하는 자리가 생기면 `color` 만 주면 된다. 남색을 여기 박지 않는다.
 * ★체크는 **바탕색으로 도려낸다** — 판 위에 흰 체크라는 아이콘의 꼴 그대로다.
 */
export function FreepassMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${BRAND_MARK.box} ${BRAND_MARK.box}`}
      aria-hidden style={{ display: 'block', flex: '0 0 auto' }}>
      <rect width={BRAND_MARK.box} height={BRAND_MARK.box} rx={BRAND_MARK.rx} fill="currentColor" />
      <path d={BRAND_MARK.check} fill="none" stroke={C.bg} strokeWidth={BRAND_MARK.checkWidth}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * **«✕ freepass» 동반 표기** — 채널 간판 옆에 «작게, 연하게».
 *
 * 사장님 2026-09-07 「**유니오토모빌 X freepass** 이렇게 해줘야 함 홈페이지는」 ·
 * 「CI 뒤에 x 랑 freepass 는 **아주 연하게**」.
 * ★이 홈페이지는 채널의 얼굴이지만 **우리가 만들어 주는 것**이라, 만든 쪽을 숨기지 않고 옆에 적는다.
 * ⚠ 업무동 규칙(「브랜드 표식은 안 세운다」)과 **다른 자리**다 — 그건 공급사·영업자가 같이 쓰는
 *   콕핏 얘기고, 여기는 손님에게 나가는 채널 홈페이지다.
 */
export function CoBrandFreepass({ fs, gap }: { fs: number; gap: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap,
      opacity: 0.55, color: C.faint, whiteSpace: 'nowrap',
    }}>
      <span aria-hidden style={{ fontSize: fs - 1, fontWeight: FW.meta, lineHeight: 1 }}>✕</span>
      <FreepassMark size={Math.round(fs * CAP * 1.5)} />
      {/* ★Exo 2 600 소문자 — 명함 CI 다. 본문 서체로 적으면 그건 CI 가 아니라 그냥 글자다. */}
      <span style={{
        fontFamily: BRAND_FONT, fontSize: fs, fontWeight: 600,
        letterSpacing: '-0.04em', textTransform: 'lowercase', lineHeight: 1,
      }}>{BRAND_MAIN}</span>
    </span>
  );
}
