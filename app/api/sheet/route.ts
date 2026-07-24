/**
 * /api/sheet — 구글시트 URL → CSV 텍스트. 렌트사 시트 당겨오기(CORS 회피, 서버 fetch).
 *   GET ?url={sheetUrl}[&gid={gid}] → { ok, csv }
 *   지원: 일반 공유링크(/d/{id}/edit), 게시 CSV(/pub?output=csv), gviz. 클라이언트가 parseDelimited 로 파싱.
 *   ※ 시트는 "링크 있는 사람 보기 가능" 또는 "웹에 게시" 상태여야 함(인증 불필요).
 */
import { NextResponse } from 'next/server';
import { allowedHost } from '@/lib/net/proxy-hosts';

export const runtime = 'nodejs';

function extractSheetId(url: string): string {
  const m = url.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}
function extractGid(url: string): string {
  const m = url.match(/[?#&]gid=([0-9]+)/);
  return m ? m[1] : '';
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const url = (params.get('url') || '').trim();
  const gid = params.get('gid') || extractGid(url);
  if (!url) return NextResponse.json({ ok: false, error: 'url 필요' }, { status: 400 });

  // 이미 게시 CSV(pub?output=csv)면 그대로, 아니면 gviz CSV 로.
  const id = extractSheetId(url);
  const isPubCsv = /\/pub\b/.test(url) && /output=csv/.test(url);
  const csvUrl = isPubCsv ? url
    : id ? `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`
    : url;
  if (!id && !isPubCsv) return NextResponse.json({ ok: false, error: '구글시트 URL 아님(시트 ID 못 찾음)' }, { status: 400 });
  // ⚠ SSRF 차단: isPubCsv 분기는 raw url을 그대로 fetch → 구글 호스트만 허용(내부주소·임의도메인 차단).
  if (!allowedHost(csvUrl, 'sheet')) return NextResponse.json({ ok: false, error: '허용되지 않은 호스트(구글시트만)' }, { status: 403 });

  try {
    const r = await fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!r.ok) return NextResponse.json({ ok: false, error: `시트 로드 실패 ${r.status} — 공유(링크 보기 가능)·게시 상태 확인` }, { status: 502 });
    const csv = await r.text();
    // 구글이 접근차단 시 HTML 로그인 페이지를 반환 → CSV 아님 감지.
    if (/^\s*<(!doctype|html)/i.test(csv)) return NextResponse.json({ ok: false, error: '시트 비공개 — "링크 있는 사람 보기" 또는 "웹에 게시" 로 열어주세요' }, { status: 403 });
    return NextResponse.json({ ok: true, csv, source: isPubCsv ? 'pub' : 'gviz' }, { headers: { 'Cache-Control': 's-maxage=60' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
