import { NextResponse } from 'next/server';
import { firestoreAdminRef } from '@/lib/server/firestore-ref-shim';
import { OPS_PIPELINE_PATH, type OpsPipelineStatus } from '@/lib/ops-status';

/**
 * **가게 머리띠가 쓰는 «지금» 두 가지 — 재고를 언제 갱신했나 · 오늘 날씨.**
 *
 * 사장님 2026-09-09 「**재고 업데이트 시간을 올려줘야지** · 언제 최근 업데이트 됐는지」
 * · 「**update 언제 시간분까지**」 · 「오늘 날짜 요일 **날씨**까지는 보여주면 좋을 거 같은데?」
 *
 * ## ⚠ 관제탑(`/api/ops/pipeline`)을 손님에게 열지 않는다
 *
 * 같은 문서를 읽지만 **거기는 관리자 전용**이다 — 단계 요약에 **공급사 이름·시트 이름**이 실려서
 * 손님에게 열면 우리 공급사 명단이 통째로 새는 길이 된다.
 * ⇒ 여기서는 **시각 하나만** 뽑아서 준다. 가리는 게 아니라 «안 주는» 것이다
 *   (집 규격 — 손님 응답에 실어 놓고 화면에서 감추면 개발자도구 한 번이면 끝난다).
 *
 * ## 갱신 시각은 «지어내지 않는다»
 *
 * 재고 원자에는 「언제 갱신됐나」가 없다(2026-09-09 실측 — 손님 명단에도, 역할표에도 없다).
 * 정직한 출처는 **자동동기가 회차를 닫은 시각**뿐이라 그것을 쓴다.
 * ⚠ 값이 없으면 `null` 을 준다. 「오늘 날짜」로 대신 채우지 않는다 — 그건 사실이 아니고,
 *   화면이 「방금 갱신됨」처럼 읽히면 영업자가 그걸 믿고 손님에게 말한다.
 *
 * ## 날씨는 «곁다리»다
 *
 * 외부(Open-Meteo · 키 없이 무료)에서 받아 온다. 실패하면 조용히 `null` — 날씨 때문에
 * 재고 화면이 느려지거나 비면 안 된다. 그래서 둘을 **따로** 받고 각자 실패한다.
 */
export const runtime = 'nodejs';
/* 손님 화면이 60초마다 물어도 부담이 없게 — 값이 분 단위라 그보다 촘촘할 이유가 없다. */
export const revalidate = 0;

/** 우리 사무실(서울 강서구 양천로) — 날씨는 «우리가 있는 곳» 기준이다. */
const LAT = 37.55;
const LON = 126.85;

/**
 * WMO 날씨 코드 → 한 마디.
 * ★코드를 그대로 보여주지 않는다 — 「61」은 사람이 못 읽는다.
 * ★말은 짧게. 머리띠 한 줄에 날짜·요일과 같이 서므로 길면 줄이 접힌다.
 */
function weatherText(code: number): string {
  if (code === 0) return '맑음';
  if (code <= 2) return '구름 조금';
  if (code === 3) return '흐림';
  if (code === 45 || code === 48) return '안개';
  if (code >= 51 && code <= 57) return '이슬비';
  if (code >= 61 && code <= 67) return '비';
  if (code >= 71 && code <= 77) return '눈';
  if (code >= 80 && code <= 82) return '소나기';
  if (code >= 85 && code <= 86) return '눈';
  if (code >= 95) return '뇌우';
  return '';
}

async function loadUpdated(): Promise<{ ms: number; at: string } | null> {
  try {
    const snap = await firestoreAdminRef().ref(OPS_PIPELINE_PATH).get();
    const v = snap.val() as OpsPipelineStatus | null;
    if (!v || typeof v !== 'object') return null;
    const ms = Number(v.updatedMs);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return { ms, at: String(v.updatedAt || '') };
  } catch { return null; }
}

async function loadWeather(): Promise<{ temp: number; text: string } | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
      + '&current=temperature_2m,weather_code&timezone=Asia%2FSeoul';
    /* ★짧게 끊는다 — 곁다리가 본 화면을 붙잡고 있으면 안 된다. */
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), next: { revalidate: 600 } });
    if (!res.ok) return null;
    const j = await res.json() as { current?: { temperature_2m?: number; weather_code?: number } };
    const temp = Number(j?.current?.temperature_2m);
    const code = Number(j?.current?.weather_code);
    if (!Number.isFinite(temp)) return null;
    return { temp: Math.round(temp), text: weatherText(Number.isFinite(code) ? code : -1) };
  } catch { return null; }
}

export async function GET(): Promise<Response> {
  /* ★둘을 나란히 받는다 — 한쪽이 느려도 다른 쪽을 기다리게 하지 않는다. */
  const [updated, weather] = await Promise.all([loadUpdated(), loadWeather()]);
  return NextResponse.json(
    { updated, weather },
    /* 분 단위 값이라 1분 캐시로 충분하다 — 손님이 몰려도 원본을 한 번만 읽는다. */
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
  );
}
