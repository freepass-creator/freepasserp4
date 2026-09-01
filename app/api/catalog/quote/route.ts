import { NextResponse } from 'next/server';
import { loadGuestQuote } from '@/lib/server/guest-quote';

export const dynamic = 'force-dynamic';
const S = (v: unknown) => String(v ?? '').trim();

/**
 * 손님 공개 **상품 안내** — `/q/{code}` 가 쓴다. **인증 없이** 호출된다.
 * (경로·파일 이름의 `quote` 는 그대로 둔다 — 이미 나간 링크와 배포 경로가 걸려 있다.)
 *
 * 조회 자체는 `lib/server/guest-quote` 가 한다 — 같은 함수를 `/q/{code}` 의 `generateMetadata`
 * (카톡 미리보기)도 쓰므로 손님이 보는 값과 미리보기 값이 갈릴 수 없다.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = S(url.searchParams.get('code'));
  if (!raw) return NextResponse.json({ error: '매물 코드가 없습니다.' }, { status: 400 });

  /**
   * ⚠ **조각을 여기서 쪼개지 않는다** — `loadGuestQuote` 가 «통째로 찾고, 못 찾을 때만» 하이픈에서 가른다.
   *   미리 쪼개면 `PT-0001_181하5327` 처럼 하이픈 품은 상품키가 `PT-0001` 로 잘려 옛 링크가 죽는다(2026-08-22 실측).
   */
  try {
    const found = await loadGuestQuote(raw, S(url.searchParams.get('a')));
    if (!found) return NextResponse.json({ error: '현재 안내 가능한 상품이 아닙니다.' }, { status: 404 });
    return NextResponse.json(found, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('[catalog/quote]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '상품 안내를 불러오지 못했습니다.' }, { status: 503 });
  }
}
