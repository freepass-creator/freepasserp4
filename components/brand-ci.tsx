'use client';
import type { ReactNode } from 'react';
import { C, FW } from '@/components/ui';
import { BRAND_FONT, BRAND_WEIGHT } from '@/lib/brand';
import { CORP } from '@/lib/domain/corporate-ci';
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
 * **CI 가 없는** 것이다. 정본은 **Exo 2 두 무게 소문자 워드마크**다.
 *
 * ★★**여기 서는 것은 «법인 CI»다 — `freepass` + `mobility`**(사장님 2026-09-07 「ㅇㅇ
 *   **프리패스모빌리티**로 하자」). `lib/domain/corporate-ci.ts` 가 이미 갈라 둔 규칙 그대로다:
 *   **CI(법인)** = teamjpk · **freepassmobility** / **BI(서비스)** = 착한거래 · 렌터카매니저 · freepasserp.com.
 *   이 자리는 「이 홈페이지를 **누가 운영하는가**」이고, 푸터도 「프리패스모빌리티 주식회사가
 *   운영합니다」라고 말한다 — **대외에 나가는 이름은 법인**이다.
 * ⚠ `BRAND_MAIN`/`BRAND_SUB`(freepasserp.com)은 **서비스 브랜드**라 여기 쓰지 않는다.
 *   그건 로그인·탭 제목처럼 «우리 시스템을 쓰는 사람»이 보는 자리의 이름이다.
 * ⚠ 톤은 그대로 아주 연하게 둔다(사장님 2026-09-07 「CI 뒤에 x 랑 freepass 는 **아주 연하게**」).
 *   **꼴과 톤은 다른 이야기다** — 꼴은 정본대로, 톤만 내린다.
 * ★★**마크(체크)는 안 붙인다 — 영문 워드마크만**(사장님 2026-09-07 「프리패스는 그냥 **CI 대로
 *   영문만** 쓰면 되고」). 한 줄에 심볼이 둘(육각형 + 체크)이면 «누가 주인인지»가 흐려진다.
 *   여기 주인은 채널이고 우리는 그 옆에 «이름만» 적는다.
 *
 * ## ③ 한 군데서 그린다
 *
 * 같은 워드마크가 **머리띠 · 푸터 · 로그인** 셋에 각각 손으로 짜여 있었다. 한쪽만 고치면
 * 다른 쪽을 볼 때마다 「또 원래대로」가 된다(CLAUDE.md 절대원칙 3). 그래서 원자로 모은다.
 */

/** 대문자 캡 높이 ÷ 글자 크기 — Pretendard 실측(19/26 · 16/22 · 11/15). */
const CAP = 0.727;
/**
 * 줄상자 가운데 → 캡 밴드 가운데 (em). **음수 = 캡이 상자 가운데보다 «위»에 있다.**
 *
 * `line-height:1` 인 대문자 줄은 밑에 내려가는 획 자리를 그대로 갖고 있어서, 눈에 보이는
 * 대문자 띠가 상자 가운데보다 **위**에 앉는다. 마크를 상자 가운데에 맞추면 그만큼 내려앉아 보인다.
 *
 * ⚠⚠ 이 값을 **글꼴 지표를 «추정»해서 +0.068 로 적어 뒀다가 부호까지 틀렸다**(2026-09-07).
 *   그래서 심볼이 UNI 캡 가운데보다 **1.68px 내려가** 있었다 — 사장님 「심볼은 텍스트 uni 랑
 *   보이는 대로 상하 중간에 정렬 좀」.
 * ⇒ 추정하지 않는다. **밑선을 직접 재서** 얻은 값이다 —
 *   높이 0 짜리 `vertical-align:baseline` 상자를 글자 안에 넣으면 그 바닥이 곧 밑선이고,
 *   캡 높이는 canvas `actualBoundingBoxAscent`(실제 잉크)로 잰다.
 *   실측(fs 23) — 상자 위에서 밑선 19.0 · 캡 17.0 ⇒ 캡 중심 10.5 · 상자 중심 11.5 ⇒ **−0.0435·fs**.
 */
const CAP_NUDGE = -0.0435;
/**
 * **심볼의 «보이는» 가운데 보정** — 잉크 무게중심이 상자 가운데보다 이만큼 «밑»에 있다.
 *
 * 사장님 2026-09-07 「심볼은 텍스트 uni 랑 **보이는 대로** 상하 중간에 정렬 좀 해 주고」.
 * ⚠ 상자(bounding box) 가운데를 맞추는 것과 «보이는» 가운데를 맞추는 것은 다르다. 이 육각형은
 *   위가 두 봉우리로 갈라지고 아래가 넓어서, 잉크의 절반이 아래쪽에 더 쏠려 있다
 *   (실측 위 51,748 · 아래 62,901 · 무게중심이 상자 중심보다 **3.53% 아래**).
 *   그래서 상자를 정확히 맞추면 눈에는 심볼이 **살짝 내려앉아** 보인다.
 * ⇒ 그만큼 **올린다**. 숫자는 그림에서 «잰» 값이지 손으로 고른 값이 아니다 —
 *   마크가 바뀌면 다시 재서 이 상수를 고친다.
 */
const MARK_OPTICAL = 0.0353;
/** 워드마크 앞 글자(주) 자간 — 굵고 크므로 살짝 조인다. */
const TRACK_MAIN = '-0.02em';
/** 뒤 글자(보조) 자간 — 작을수록 벌려야 «이름»으로 읽힌다. */
const TRACK_SUB = '0.16em';

/**
 * **자간이 «마지막 글자 뒤»에 남기는 여백을 되돌린다.**
 *
 * 사장님 2026-09-07 「**간격을 잘 맞춰야 함**」.
 * ⚠ CSS `letter-spacing` 은 글자 «사이»가 아니라 **글자마다 뒤에** 붙는다. 그래서 자간을 준 낱말은
 *   보이는 끝보다 상자가 그만큼 넓다 — `AUTOMOBILE`(0.16em · 14px)은 **2.24px**.
 *   그 상태로 flex `gap: 16` 을 주면 눈에는 **18.24** 로 보인다. 적어 둔 숫자와 보이는 간격이 갈린다.
 * ⇒ 자간을 준 낱말에는 같은 값의 «음수 오른쪽 여백»을 얹는다. 그러면 **적은 숫자 = 보이는 간격**이다.
 */
const trackFix = (track: string) => ({ marginRight: `-${track}` });

/**
 * 채널 워드마크 — **앞 글자가 «주», 뒤 글자가 «보조»다.**
 *
 * 사장님 2026-09-07 「**오토모빌 영문은 보조격으로 쓰는 거잖아**」.
 *
 * ⚠⚠ 2026-09-07 오전에 내가 이걸 «같은 크기·같은 굵기»로 바꿨다. 받은 원본
 *   (`public/brand/uni-black.png`)이 **세로 적층 로고**라 거기서는 둘이 같은 크기였고,
 *   그걸 그대로 가로로 눕힌 것이다. 그건 **적층 로고의 규칙을 가로 간판에 잘못 옮긴 것**이었다 —
 *   가로 한 줄에서는 「UNI」가 이름이고 「AUTOMOBILE」은 업종을 밝히는 보조다.
 * ★위계는 **크기와 굵기와 자간**으로 준다. 색은 둘 다 먹색이다 — 로고가 검정이라
 *   한쪽만 색을 달리하면 로고와 색이 갈린다.
 * ★둘은 **밑선(baseline)을 맞춘다.** 가운데를 맞추면 보조가 붕 뜬다.
 *
 * ## 짜임은 둘이다 — 그 회사 CI 가 정한다(`wl.wordmark.kind`)
 *
 * | | `split`(기본) | `lockup` |
 * |---|---|---|
 * | 누구 | 유니오토모빌 — 앞이 이름, 뒤가 **보조격** | 프리패스모빌리티 — **한 낱말 두 무게** |
 * | 크기 | 뒤가 0.59배 | 둘이 같다 |
 * | 사이 | 낱말 사이만큼 뗀다 | **안 뗀다**(한 낱말) |
 * | 서체 | 본문 서체 | **CI 서체**(Exo 2 · `lib/brand`) |
 *
 * ⚠ 짜임을 잘못 고르면 「연하게 그린 CI」가 아니라 **CI 가 아닌 것**이 된다 —
 *   2026-09-07 에 우리 이름을 본문 서체 맨글자로 적어 놓고 CI 를 반영했다고 여겼던 그 일이다.
 */
export function ChannelWordmark({ wl, fs, color = C.ink, after }: {
  wl: Whitelabel; fs: number; color?: string;
  /**
   * 뒤에 «같은 줄»로 붙는 것 — 동반 표기(`CoBrandFreepass`)가 여기 든다.
   *
   * ★★**왜 밖이 아니라 안인가**(사장님 2026-09-07 「**협업한다는 뜻**인데 저거 정렬이 저렇게 안 되나」).
   *   밖에 형제로 두면 그 줄은 «가운데 정렬»로 붙어 **밑선이 3px 떠 있었다** — 한 줄로 안 읽힌다.
   *   ✕ 는 「A ✕ B」로 두 이름을 잇는 기호다. 두 이름이 같은 줄에 서지 않으면 그 뜻이 안 산다.
   * ⇒ 워드마크와 **한 밑선 줄** 안에 넣는다. 대신 사이는 한 단 더 뗀다(붙은 것 ↔ 뗀 것).
   */
  after?: ReactNode;
}) {
  const sub = wl.wordmark.sub.trim();
  return (
    /*
      ⚠⚠ **두 겹이다.** 바깥은 `gap: 0` 이고 안쪽 낱말 줄만 `gap` 을 갖는다.
        한 겹으로 두면 바깥 `gap` 이 동반 표기의 왼쪽 여백에 **더해져** ✕ 좌우가 갈린다
        (실측 왼쪽 20 · 오른쪽 12). 동반 표기는 제 여백을 스스로 갖는다(`CoBrandFreepass`).
    */
    <span style={{
      display: 'inline-flex', alignItems: 'baseline',
      lineHeight: 1, color, whiteSpace: 'nowrap',
    }}>
      {wl.wordmark.kind === 'lockup' ? (
        /*
          ★★**한 낱말 두 무게** — 프리패스 CI 의 짜임이다(`freepass`600 + `mobility`300, Exo 2 소문자).
            사장님 2026-09-07 「프리패스도 CI 있는데 그거 반영 전혀 안 했고」 ·
            「프리패스는 그냥 **CI 대로 영문만** 쓰면 되고」.
          ⚠ 여기 `gap` 을 주면 안 된다 — **한 낱말**이다. 유니오토식 `split`(이름 + 보조격)으로
            그리면 사이가 벌어지고 뒤 낱말이 작아져, 그건 우리 CI 가 아니라 남의 짜임이다.
          ★무게·서체는 명함·CI 센터가 정의한 값(`lib/brand`)을 그대로 쓴다 — 여기서 고르지 않는다.
          ★동반 표기(`CoBrandFreepass`)가 이미 «같은 규칙»으로 우리 이름을 그린다. 두 곳이
            갈리지 않게 짜임을 여기 한 번 더 적는 것이 아니라, **같은 상수**를 본다.
        */
        <span style={{
          fontFamily: BRAND_FONT, fontSize: fs, letterSpacing: '-0.04em',
          textTransform: 'lowercase', lineHeight: 1,
        }}>
          <span style={{ fontWeight: BRAND_WEIGHT.main }}>{wl.wordmark.main}</span>
          <span style={{ fontWeight: BRAND_WEIGHT.sub }}>{sub}</span>
        </span>
      ) : (
        <span style={{
          display: 'inline-flex', alignItems: 'baseline', gap: Math.round(fs * 0.36),
        }}>
          <span style={{
            fontSize: fs, fontWeight: FW.head, letterSpacing: TRACK_MAIN, lineHeight: 1,
            ...trackFix(TRACK_MAIN),
          }}>
            {wl.wordmark.main}
          </span>
          {sub ? (
            <span style={{
              fontSize: Math.round(fs * 0.59), fontWeight: FW.meta, letterSpacing: TRACK_SUB, lineHeight: 1,
              ...trackFix(TRACK_SUB),
            }}>{sub}</span>
          ) : null}
        </span>
      )}
      {/*
        ★★**동반 표기는 제 «앞뒤 여백»을 스스로 갖는다** — 여기서 더 얹지 않는다.
          ✕ 는 두 이름을 잇는 기호라 **좌우가 같아야** 「A ✕ B」로 읽힌다.
      */}
      {after}
    </span>
  );
}

/**
 * 채널 간판 = **마크 + 워드마크 한 덩어리.**
 *
 * ★**마크 높이는 «앞 글자의 캡 높이»에 매단다**(1.5배) — 글자 크기가 바뀌면 마크가 따라온다.
 *   전에는 마크 28 · 캡 19 라 마크가 글자를 **위로 6.2 · 아래로 2.8** 삐져나와 있었다.
 * ★★**세로는 «앞 글자(UNI)의 캡 밴드»에 맞춘다**(사장님 2026-09-07 「심볼은 텍스트 **uni 랑**
 *   보이는 대로 상하 중간에 정렬」). 뒤 글자는 보조라 기준이 아니다 — 워드마크 전체 높이에
 *   맞추면 보조가 커질수록 심볼이 밀린다.
 * ⚠ «글자의 중심»은 줄상자 가운데가 **아니다** — 대문자뿐이라 밑으로 내려가는 획이 없어 둘이
 *   어긋난다(`CAP_NUDGE`). 거기에 심볼 제 무게중심 보정(`MARK_OPTICAL`)을 더해 «보이는» 가운데를 맞춘다.
 */
export function ChannelSign({ wl, fs, gap, after }: {
  wl: Whitelabel; fs: number; gap: number;
  /** 워드마크 «뒤»에 같은 밑선으로 붙는 것 — 동반 표기(위 `ChannelWordmark.after`). */
  after?: ReactNode;
}) {
  const markH = Math.round(fs * CAP * 1.5);
  /* 캡 밴드로 내리고(+) · 심볼 무게가 아래로 쏠린 만큼 올린다(−). 둘 다 «잰» 값이다. */
  const shift = fs * CAP_NUDGE - markH * MARK_OPTICAL;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap }}>
      {wl.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- 채널마다 다른 마크라 정적 최적화 대상이 아니다.
        <img src={wl.logo.src} alt={wl.logo.alt} style={{
          height: markH, width: 'auto', display: 'block',
          /* ⚠ `margin` 이 아니라 `transform` — 여백을 주면 줄상자가 같이 커져 옆의 글자가 밀린다. */
          transform: `translateY(${shift.toFixed(2)}px)`,
        }} />
      ) : null}
      <ChannelWordmark wl={wl} fs={fs} after={after} />
    </span>
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
export function CoBrandFreepass({ fs, gap }: {
  fs: number;
  /**
   * **✕ 의 좌우 여백 — 한 값이다.**
   *
   * 사장님 2026-09-07 「간격을 잘 맞춰야 함」.
   * ⚠ 전에는 왼쪽 16 · 오른쪽 5 였다. ✕ 는 두 이름을 «잇는» 기호인데 한쪽에만 붙어 있으면
   *   「A ✕B」로 읽혀 잇는 뜻이 죽는다. **좌우를 같은 값으로** 준다.
   * ★이 값이 워드마크 «안쪽» 사이보다 커야 간판과 동반 표기가 한 단 갈린다.
   */
  gap: number;
}) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap, marginLeft: gap,
      opacity: 0.55, color: C.faint, whiteSpace: 'nowrap',
    }}>
      <span aria-hidden style={{ fontSize: Math.round(fs * 0.85), fontWeight: FW.meta, lineHeight: 1 }}>✕</span>
      {/*
        ★★**CI 정본 그대로** — `freepass`(600) + `erp.com`(300), **Exo 2 소문자 한 낱말**
          (사장님 2026-09-07 「**프리패스 CI 있잖아 그거 그대로 잘 반영**해달라고」).
          명함·CI센터(`ci_center/index.html`)가 워드마크를 «두 무게»로 정의한다 —
          앞은 굵게(이름) 뒤는 가늘게(무엇). 앞부분만 쓰면 그건 CI 의 절반이다.
        ⚠ 둘 사이는 **붙인다.** 한 낱말이라 flex gap 을 주면 안 된다 —
          그래서 이 안쪽만 `gap: 0` 짜리 제 줄로 감싼다.
        ★본문 서체(Pretendard)로 적으면 그건 CI 가 아니라 그냥 글자다.
      */}
      <span style={{
        fontFamily: BRAND_FONT, fontSize: fs, letterSpacing: '-0.04em',
        textTransform: 'lowercase', lineHeight: 1,
      }}>
        <span style={{ fontWeight: BRAND_WEIGHT.main }}>{CORP.markMain}</span>
        <span style={{ fontWeight: BRAND_WEIGHT.sub }}>{CORP.markSub}</span>
      </span>
    </span>
  );
}
