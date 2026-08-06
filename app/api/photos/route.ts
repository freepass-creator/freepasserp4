/**
 * /api/photos — 공급사 사진 «링크»를 실제 이미지 URL 목록으로 푼다.
 *   GET ?url={공급사 링크}[&size=1200] → { ok, urls, count, source }
 *
 * 매물의 `photo_link` 는 드라이브 폴더 주소이거나 상세페이지라 `<img src>` 에 못 넣는다.
 * 화면이 필요할 때 여기로 물어본다 — 동기화 때 미리 풀지 않는다. 1,200여 대를 저장 시점에
 * 외부 요청으로 풀면 동기화가 끝나지 않고, 링크가 바뀌면 저장값이 낡는다.
 *
 * 허용 호스트 밖 주소는 `lib/server/photo-extract` 가 거절한다 — 서버가 임의 URL 을 대신
 * 가져오는 통로(SSRF)를 열지 않기 위해서다.
 */
import { NextResponse } from 'next/server';
import { extractPhotoUrls } from '@/lib/server/photo-extract';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const url = (params.get('url') || '').trim();
  const size = Math.min(Math.max(Number(params.get('size')) || 1200, 200), 2000);
  if (!url) return NextResponse.json({ ok: false, error: 'url 필요' }, { status: 400 });

  try {
    const result = await extractPhotoUrls(url, size);
    return NextResponse.json(
      { ok: true, urls: result.urls, count: result.urls.length, source: result.source },
      // 링크당 결과는 잘 안 바뀐다. 짧게 캐시해 목록 스크롤마다 외부를 때리지 않게 한다.
      { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: String((error as Error).message || error) }, { status: 502 });
  }
}
