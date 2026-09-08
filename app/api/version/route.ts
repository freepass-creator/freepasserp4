import { NextResponse } from 'next/server';
import { storeHealth } from '@/lib/server/firestore-ref-shim';

/** 지금 서버가 어떤 빌드인가 — VersionWatcher 가 읽는다(빌드 때 상수로 박힘). 캐시 금지. */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      stamp: process.env.NEXT_PUBLIC_BUILD_STAMP || '', build: process.env.NEXT_PUBLIC_BUILD_NO || '', sha: process.env.NEXT_PUBLIC_BUILD_SHA || '',
      /*
       * ★★**지금 어느 원장을 읽고 있나** — 밖에서 물어볼 수 있어야 한다.
       *
       * ⚠⚠ 2026-09-08. 손님 화면이 **폐기된 RTDB** 를 읽고 있었는데 화면은 멀쩡해 보였다.
       *   숫자만 조용히 틀렸다(화면 703 · 정본 709 · 같은 차의 출고불가가 출고가능으로).
       *   폴백이 `console.error` 한 줄만 남겨서, 사장님이 「703이 맞나?」 물으실 때까지 아무도 몰랐다.
       * ⇒ 이 한 칸이면 **누구든 1초에 확인한다** — `store` 가 `firestore` 가 아니면 그 순간 사고다.
       * ★`/api/version` 에 붙인 이유 = 배포 확인하러 이미 다들 여는 곳이라, 볼 일이 있을 때 같이 보인다.
       */
      ...storeHealth(),
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
