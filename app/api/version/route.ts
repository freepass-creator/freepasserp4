import { NextResponse } from 'next/server';

/** 지금 서버가 어떤 빌드인가 — VersionWatcher 가 읽는다(빌드 때 상수로 박힘). 캐시 금지. */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { stamp: process.env.NEXT_PUBLIC_BUILD_STAMP || '', build: process.env.NEXT_PUBLIC_BUILD_NO || '', sha: process.env.NEXT_PUBLIC_BUILD_SHA || '' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
