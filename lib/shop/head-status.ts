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
 * ★**서버에서 안 부른다.** 첫 그림(SSR)은 값 없이 그리고, 브라우저가 붙은 뒤 채운다 —
 *   재고 목록이 이 값을 기다릴 이유가 없다(곁다리가 본 화면을 붙잡으면 안 된다).
 * ⚠ 실패하면 조용히 비운다. 날씨가 안 와서 가게가 비면 그건 사고다.
 */
export function useShopHeadStatus(): ShopHeadStatus {
  const [s, setS] = useState<ShopHeadStatus>(EMPTY);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/shop/status');
        if (!res.ok) return;
        const j = await res.json() as { updated?: { ms?: number } | null; weather?: { temp?: number; text?: string } | null };
        if (!alive) return;
        const ms = Number(j?.updated?.ms);
        const temp = Number(j?.weather?.temp);
        setS({
          updatedMs: Number.isFinite(ms) && ms > 0 ? ms : null,
          weather: Number.isFinite(temp) ? { temp, text: String(j?.weather?.text || '') } : null,
        });
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
 * **갱신 시각 — 「14:23」.** 시·분까지(사장님 「update 언제 시간분까지」).
 * ★날짜는 안 붙인다 — 바로 옆에 오늘 날짜가 이미 서 있다. 같은 말을 두 번 하지 않는다.
 * ⚠ **오늘이 아니면 날짜를 붙인다.** 어제 회차가 마지막이면 「14:23」만 보여 주는 것은
 *   거짓말에 가깝다 — 그때는 「9. 8. 14:23」으로 «언제»를 분명히 한다.
 */
export function updatedLabelKo(ms: number, now = new Date()): string {
  const toKst = (d: Date) => new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
  const t = toKst(new Date(ms));
  const n = toKst(now);
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const sameDay = t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate();
  return sameDay ? hhmm : `${t.getMonth() + 1}. ${t.getDate()}. ${hhmm}`;
}
