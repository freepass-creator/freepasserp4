/**
 * /api/sheet — 구글시트 URL → CSV 텍스트. 렌트사 시트 당겨오기(CORS 회피, 서버 fetch).
 *   GET ?url={sheetUrl}[&gid={gid}] → { ok, csv }
 *   지원: 일반 공유링크(/d/{id}/edit), 게시 CSV(/pub?output=csv), gviz. 클라이언트가 parseDelimited 로 파싱.
 *   ※ 시트는 "링크 있는 사람 보기 가능" 또는 "웹에 게시" 상태여야 함(인증 불필요).
 */
import { NextResponse } from 'next/server';
import { allowedHost } from '@/lib/net/proxy-hosts';
import {
  extractGoogleSheetGid,
  extractGoogleSheetId,
  isPublishedGoogleCsv,
  resolveGoogleSheetCsvUrl,
} from '@/lib/domain/sheet-url';
import { fetchVisibleGoogleSheetTable } from '@/lib/server/google-sheet-visible';
import { verifyAdminBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const url = (params.get('url') || '').trim();
  const gid = params.get('gid') || extractGoogleSheetGid(url);
  const visibleRowsOnly = params.get('visible') === '1';
  if (!url) return NextResponse.json({ ok: false, error: 'url 필요' }, { status: 400 });

  // 이미 게시 CSV(pub?output=csv)면 그대로, 아니면 gviz CSV 로.
  const id = extractGoogleSheetId(url);
  const isPubCsv = isPublishedGoogleCsv(url);
  if (visibleRowsOnly) {
    if (!id || !gid) return NextResponse.json({ ok: false, error: '숨김 행 제외 연동은 일반 시트 URL과 gid가 필요합니다' }, { status: 400 });
    let admin;
    try {
      admin = await verifyAdminBearer(request);
    } catch (error) {
      return NextResponse.json({ ok: false, error: `관리자 인증 서비스 오류 — ${String((error as Error).message || error)}` }, { status: 503 });
    }
    if (!admin) return NextResponse.json({ ok: false, error: '관리자 인증 필요' }, { status: 401 });
    try {
      const result = await fetchVisibleGoogleSheetTable(id, gid);
      return NextResponse.json(
        { ok: true, rows: result.rows, source: 'sheets-api-visible', title: result.title, hiddenRowCount: result.hiddenRowCount },
        { headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } },
      );
    } catch (error) {
      return NextResponse.json({ ok: false, error: String((error as Error).message || error) }, { status: 502 });
    }
  }
  // ⚠ gviz 를 쓰면 안 된다 — **행을 조용히 빠뜨린다.**
  //  gviz 는 첫 행을 헤더로 잡고 열 타입을 추론하는데, 그 과정에서 타입이 안 맞는 뒤쪽 블록을 잘라낸다.
  //  실측(2026-07-31): 아이언 42대 → 26대(출고불가 16대가 통째로 사라짐) · 손오공 37 → 33.
  //  더 나쁜 건 "안 읽힌 차"가 「시트에서 사라짐」으로 판정돼 멀쩡한 매물이 출고불가로 내려간다는 점이다.
  //  export?format=csv 는 시트를 있는 그대로 내보낸다.
  const csvUrl = resolveGoogleSheetCsvUrl(url, gid);
  if (!id && !isPubCsv) return NextResponse.json({ ok: false, error: '구글시트 URL 아님(시트 ID 못 찾음)' }, { status: 400 });
  // ⚠ SSRF 차단: isPubCsv 분기는 raw url을 그대로 fetch → 구글 호스트만 허용(내부주소·임의도메인 차단).
  if (!allowedHost(csvUrl, 'sheet')) return NextResponse.json({ ok: false, error: '허용되지 않은 호스트(구글시트만)' }, { status: 403 });

  try {
    const r = await fetch(csvUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: `시트 로드 실패 ${r.status} — 공유(링크 보기 가능)·게시 상태 확인` }, { status: 502 });
    const csv = await r.text();
    // 구글이 접근차단 시 HTML 로그인 페이지를 반환 → CSV 아님 감지.
    if (/^\s*<(!doctype|html)/i.test(csv)) return NextResponse.json({ ok: false, error: '시트 비공개 — "링크 있는 사람 보기" 또는 "웹에 게시" 로 열어주세요' }, { status: 403 });
    return NextResponse.json({ ok: true, csv, source: isPubCsv ? 'pub' : 'export' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
