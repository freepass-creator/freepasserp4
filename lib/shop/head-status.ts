'use client';
import { useEffect, useState } from 'react';

/**
 * **가게 머리띠의 «지금» 값** — 재고 갱신 시각 · 오늘 날씨.
 *
 * 사장님 2026-09-09 「재고 업데이트 시간을 올려줘야지 · 언제 최근 업데이트 됐는지」
 * · 「update 언제 시간분까지」 · 「오늘 날짜 요일 날씨까지는 보여주면 좋을 거 같은데?」
 *
 * ★**왜 화면에 필요한가** — 영업자가 손님에게 「지금 출고 가능합니다」라고 말하려면
 *   그 정보가 «언제 것»인지 알아야 한다. 시각이 없으면 매번 「이거 최신 맞나」를 의심하고,
 *   손님이 「어제 것 아니냐」고 물으면 댈 근거가 없다.
 * ★값은 한 곳에서 물어온다(`/api/shop/status`) — 화면마다 따로 부르면 같은 값이 갈린다.
 */
export type ShopHeadStatus = {
  /** 재고를 마지막으로 갱신한 시각(ms). **없으면 `null`** — 오늘 날짜로 대신 채우지 않는다. */
  updatedMs: number | null;
  /** 오늘 날씨 — 곁다리라 없을 수 있다. */
  weather: { temp: number; text: string } | null;
};

const EMPTY: ShopHeadStatus = { updatedMs: null, weather: null };

/**
 * **한 화면에서 한 번만 물어본다** — 머리띠(날씨·시각)와 목록 줄(갱신 시각)이 같은 값을 쓴다.
 * ★둘이 각자 부르면 같은 답을 두 번 받아 오고, 새로고침 때마다 요청이 배로 는다.
 * ⚠ 60초가 지나면 다시 묻는다 — 값이 분 단위라 그보다 촘촘할 이유가 없다.
 */
let cached: { at: number; value: ShopHeadStatus } | null = null;
const FRESH_MS = 60_000;

/**
 * ★**서버에서 안 부른다.** 첫 그림(SSR)은 값 없이 그리고, 브라우저가 붙은 뒤 채운다 —
 *   재고 목록이 이 값을 기다릴 이유가 없다(곁다리가 본 화면을 붙잡으면 안 된다).
 * ⚠ 실패하면 조용히 비운다. 날씨가 안 와서 가게가 비면 그건 사고다.
 */
export function useShopHeadStatus(): ShopHeadStatus {
  const [s, setS] = useState<ShopHeadStatus>(EMPTY);
  useEffect(() => {
    let alive = true;
    if (cached && Date.now() - cached.at < FRESH_MS) { setS(cached.value); return () => { alive = false; }; }
    (async () => {
      try {
        const res = await fetch('/api/shop/status');
        if (!res.ok) return;
        const j = await res.json() as { updated?: { ms?: number } | null; weather?: { temp?: number; text?: string } | null };
        if (!alive) return;
        const ms = Number(j?.updated?.ms);
        const temp = Number(j?.weather?.temp);
        const value: ShopHeadStatus = {
          updatedMs: Number.isFinite(ms) && ms > 0 ? ms : null,
          weather: Number.isFinite(temp) ? { temp, text: String(j?.weather?.text || '') } : null,
        };
        cached = { at: Date.now(), value };
        setS(value);
      } catch { /* 곁다리다 — 조용히 비운다 */ }
    })();
    return () => { alive = false; };
  }, []);
  return s;
}

/**
 * **오늘 — 「9. 9.(화)」.** 한국 시간으로 못박아 잰다.
 * ⚠ 서버는 UTC 라 새벽에 «어제»를 그린다. 그러면 내려간 HTML 과 화면이 다른 날을 말한다.
 */
export function todayLabelKo(now = new Date()): string {
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const day = ['일', '월', '화', '수', '목', '금', '토'][kst.getDay()];
  return `${kst.getMonth() + 1}. ${kst.getDate()}.(${day})`;
}

/**
 * **갱신 시각 — 「9. 11. 04:15」. 날짜와 시각을 «늘» 같이 적는다.**
 *
 * ★★사장님 2026-09-10 「업데이트는 **날짜 시간이 있어야** 되는데 … **모바일하고 웹에 날짜
 *   시간이 안 들어가도 상관이 없나?** 들어가는 게 맞는 거 같긴 하거든」. 맞다.
 *
 * ⚠⚠ **전에는 «오늘이면 시각만» 보여 줬다**(「04:15」). 근거는 「바로 옆에 오늘 날짜가 이미
 *   서 있으니 같은 말을 두 번 하지 않는다」였는데, 그 근거가 **폰에서는 성립하지 않는다** —
 *   폰 머리띠에는 날짜·날씨가 아예 없다(웹에만 있다). 그래서 폰 손님은 「04:15」만 보고
 *   **오늘인지 그저께인지 알 길이 없었다.**
 * ★웹에서 날짜가 한 번 더 나오는 것은 «중복»이 아니다 — 머리띠의 날짜는 «오늘»이고 이건
 *   «재고가 언제 것인가»다. 서로 다른 것을 말하는데 한쪽이 날짜를 빌려 쓰면 그게 오해다.
 * ★해가 바뀌어도 연도는 안 붙인다 — 매일 도는 연동이라 「작년 것」이 뜰 일이 없고,
 *   그런 일이 생기면 그건 표기가 아니라 **파이프라인이 멈춘 것**이라 다른 데서 잡아야 한다.
 */
export function updatedLabelKo(ms: number): string {
  const d = new Date(ms);
  const t = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return `${t.getMonth() + 1}. ${t.getDate()}. ${hhmm}`;
}

/**
 * **지금 시각 — «실시간»으로 돈다**(사장님 2026-09-09 「오늘 날짜, 시간, 날씨 이거를
 * **실시간으로** 좀 보여달라는 거지」).
 *
 * ★**첫 그림에는 안 그린다.** 서버가 그린 시각과 브라우저 시각이 다르면 React 가
 *   「안 맞는다」고 경고하고 화면이 한 번 튄다(hydration). 그래서 `null` 로 시작해
 *   브라우저가 붙은 뒤 채운다 — 시계는 손님 쪽 시각이 맞다.
 * ★**분마다** 갱신한다. 초까지 보여 주지 않으므로 초마다 다시 그릴 이유가 없다 —
 *   1초 타이머는 배터리만 먹는다.
 * ⚠ 다음 «정각(분)»에 맞춰 첫 박을 놓는다. 그냥 60초 간격으로 돌면 표시가 최대 59초 늦는다.
 */
export function useNowKst(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    let timer: ReturnType<typeof setInterval> | null = null;
    const first = setTimeout(() => {
      setNow(new Date());
      timer = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { clearTimeout(first); if (timer) clearInterval(timer); };
  }, []);
  return now;
}

/**
 * **지금 — 「9. 9.(수) 13:05」.** 한국 시간으로 못박아 잰다.
 * ★날짜와 시각이 «한 줄»이다 — 이 자리가 말하는 것은 「지금」 하나다.
 */
export function nowLabelKo(now: Date): string {
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const day = ['일', '월', '화', '수', '목', '금', '토'][kst.getDay()];
  const hh = String(kst.getHours()).padStart(2, '0');
  const mm = String(kst.getMinutes()).padStart(2, '0');
  return `${kst.getMonth() + 1}. ${kst.getDate()}.(${day}) ${hh}:${mm}`;
}
