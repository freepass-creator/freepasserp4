import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';
import {
  INVENTORY_PUBLICATION_COLLECTION,
  INVENTORY_PUBLICATION_DOCUMENT,
  type InventoryPublication,
} from '@/lib/inventory-publication';

/**
 * **가게 머리띠가 쓰는 «지금» 두 가지 — 재고를 언제 갱신했나 · 오늘 날씨.**
 *
 * 사장님 2026-09-09 「**재고 업데이트 시간을 올려줘야지** · 언제 최근 업데이트 됐는지」
 * · 「**update 언제 시간분까지**」 · 「오늘 날짜 요일 **날씨**까지는 보여주면 좋을 거 같은데?」
 *
 * ## ⚠ 관제탑(`/api/ops/pipeline`)의 심장박동을 재고 반영 시각으로 쓰지 않는다
 *
 * 관제탑 값은 진행 중·dry-run에도 바뀌는 운영 심장박동이다. 화면에는 판매시트 재조회까지 성공한
 * `ops/inventory_publication`의 시각 하나만 준다. 단계·공급사 정보는 응답에 싣지 않는다.
 *
 * ## 갱신 시각은 «지어내지 않는다»
 *
 * 정직한 출처는 **Firestore 원자를 판매시트에 쓰고 차량번호 집합을 다시 읽어 확인한 성공 회차**다.
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
    const snap = await getFirestore(firebaseAdminApp())
      .collection(INVENTORY_PUBLICATION_COLLECTION)
      .doc(INVENTORY_PUBLICATION_DOCUMENT)
      .get();
    const v = snap.exists ? snap.data() as InventoryPublication : null;
    if (!v || typeof v !== 'object') return null;
    const ms = Number(v.publishedMs);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return { ms, at: String(v.publishedAt || '') };
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
