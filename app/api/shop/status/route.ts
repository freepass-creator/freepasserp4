import { NextResponse } from 'next/server';
import { firestorePathStore } from '@/lib/server/firestore-path-store';
import { OPS_PIPELINE_PATH, type OpsPipelineStatus } from '@/lib/ops-status';
import { readErp5StockFreshness } from '@/lib/server/whitelabel-erp5-catalog';

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

/** 재고를 채우는 «날마다 도는» 연동이 회차를 닫는 자리(`lib/server/sheet-daily-sync`). */
const DAILY_SYNC_PATH = 'v4/system_status/sheet_daily_sync';

/** 한국 시각으로 「9. 11. 03:22」 — 화면이 쓰는 꼴 그대로. */
function stampKo(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * **재고를 마지막으로 갱신한 시각 — «성공한 회차»만 센다.**
 *
 * ★★사장님 2026-09-10 「마지막 연동일이 **9월 4일**로 나오는데 저거 실제 연동일로 바꿔야 되거든?
 *   저 연동일이 모든 데 뿌려진 건데 **왜 저거만 9월 4일**로 나오냐는 거야」.
 *
 * ⚠⚠ **엉뚱한 기록을 읽고 있었다.** 실측 2026-09-11:
 * ```
 *   v4/system_status/sheet_daily_sync   09-11 03:22   completed   ← 재고를 «실제로» 채우는 연동
 *   v4/system_status/sheet_live_status  09-06 11:56   failed
 *   v4/ops/pipeline                     09-04 21:38   ok:false    ← 가게가 읽던 것
 * ```
 *   `ops/pipeline` 은 **손으로 돌리는 시간별 파이프라인**이라 9/4 이후 안 돌았고, 그마저
 *   실패로 끝나 있었다. 그런데 날마다 도는 시트 연동은 **오늘 새벽에도 정상으로 끝났다.**
 *   ⇒ 손님은 「재고가 엿새 묵었다」고 읽었지만 실제 재고는 그날 것이었다.
 *
 * ★그래서 **둘을 다 보고 «성공한 것 중 가장 최근»을 준다.** 어느 쪽이 돌든 시각이 살아 있고,
 *   나중에 파이프라인이 하나 더 늘어도 이 목록에 한 줄만 보태면 된다.
 * ⚠ **실패한 회차는 안 센다.** 「마지막 연동일」은 「마지막으로 «시도»한 날」이 아니라
 *   「재고가 «언제 것»인가」다 — 실패한 회차를 세면 그 답이 거짓이 된다.
 * ⚠ 하나도 성공한 게 없으면 `null` — 오늘 날짜로 대신 채우지 않는다(위 머리말).
 *
 * ## ★★★2026-09-17 — 출처를 «원자»로 옮긴다. 상태 기록을 더 늘리지 않는다
 *
 *   사장님 「여기서 역으로 한번 그쪽으로 파봐」.
 *
 * ⚠⚠ **또 어긋나 있었다.** 화면은 「9. 14. 02:01」인데 원자를 전수로 세어 보니 절반이
 *   **그날 아침(09-17 09:53)** 것이었다 — **80시간이 틀렸다**
 *   (`scripts/diag-erp5-atom-freshness.mts` · 운영 1,615대).
 *   ```
 *   화면이 읽던 시각  = erp4 파이어스토어  sheet_daily_sync · ops/pipeline
 *                         ↑ 채우는 것: Vercel cron /api/sheet/sync-daily
 *   화면이 그리는 재고 = erp5 파이어스토어  products
 *                         ↑ 채우는 것: .github/workflows/erp5-ssot-refresh.yml
 *   ```
 *   **둘은 서로 모른다.** 그래서 재고가 오늘 아침 것이어도 시각은 나흘 전을 가리켰다.
 *
 * ⚠ 아래 2026-09-10 의 고침이 **왜 다시 어긋났나** — 그때 나는 출처를 «바꾸지» 않고 «하나 더
 *   늘렸다»(`ops/pipeline` 에 `sheet_daily_sync` 를 보탬). 늘리는 고침은 원장이 옮겨 가면
 *   같은 자리에서 또 깨진다. **하나 더 보태는 것으로는 이 종류가 안 끝난다.**
 *
 * ⇒ **재고를 그리는 그 데이터에게 직접 묻는다**(`readErp5StockFreshness`). 수집기가 차 한 대를
 *   쓸 때마다 `_direct_ingest_at`·`_var_polled_at` 을 같이 찍어 둔다. 화면이 그리는 바로 그
 *   원자가 스스로 나이를 말하므로 **엉뚱한 파이프라인을 가리킬 방법이 없다.**
 * ★아래 둘은 **못 물어봤을 때의 뒷문**으로만 남긴다(전환 스위치 OFF·색인 없음·읽기 실패).
 *   ⚠⚠ **`max()` 로 섞지 않는다.** 섞으면 «더 최근인 엉뚱한 기록»이 묵은 재고를 가려 준다 —
 *     그게 방금 고친 그 버그다. 원자가 답하면 **원자만** 쓴다.
 *
 * ## 아래는 2026-09-10 의 기록 — 왜 그때 그렇게 고쳤는지 남겨 둔다
 *
 * ⚠ 한때 여기서 두 원장을 다 읽었다. 연동이 RTDB 에만 적고 파이어스토어 사본이 9/5 에 멈춰 있어
 *   화면이 엿새 묵은 날짜를 보여 줬기 때문이다. **그건 읽는 쪽에서 때울 일이 아니었다** —
 *   ⇒ **적는 쪽**(`lib/server/sheet-daily-sync` 의 `writeRun`)이 파이어스토어에도 남기도록 고쳤다.
 */
async function loadUpdated(): Promise<{ ms: number; at: string } | null> {
  const pick = async (path: string, read: (v: Record<string, unknown>) => number): Promise<number> => {
    try {
      const v = (await firestorePathStore().ref(path).get()).val() as Record<string, unknown> | null;
      if (!v || typeof v !== 'object') return 0;
      const ms = read(v);
      return Number.isFinite(ms) && ms > 0 ? ms : 0;
    } catch { return 0; }
  };

  /* ★★먼저 «화면이 그리는 그 원자»에게 묻는다 — 답이 있으면 그것만 쓴다(머리말 ⇒). */
  const atom = await readErp5StockFreshness().catch(() => 0);
  if (atom > 0) return { ms: atom, at: stampKo(atom) };

  /*
   * 뒷문 — 원자가 답을 못 줬을 때만이다(전환 스위치 OFF·색인 없음·읽기 실패).
   * ⚠ 위 값과 `max()` 로 섞지 않는다. 섞으면 엉뚱한 기록이 묵은 재고를 가려 준다.
   */
  const [daily, ops] = await Promise.all([
    pick(DAILY_SYNC_PATH, (v) => (String(v.status) === 'completed' ? Number(v.finished_at) : 0)),
    pick(OPS_PIPELINE_PATH, (v) => {
      const s = v as unknown as OpsPipelineStatus;
      /* `ok === false` 는 «실패로 끝난 회차»다. 아직 도는 중(`running`)이면 아직 갱신이 아니다. */
      return s.ok === false || s.running ? 0 : Number(s.updatedMs);
    }),
  ]);

  const ms = Math.max(daily, ops);
  if (!ms) return null;
  return { ms, at: stampKo(ms) };
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
