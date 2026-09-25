import { NextResponse } from 'next/server';
import { WHITELABELS } from '@/lib/whitelabel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const S = (v: unknown) => String(v ?? '').trim();

/**
 * Legacy compatibility endpoint.
 *
 * White Label quick-filter configuration now has one authority: `lib/whitelabel.ts`.
 * The former Firestore `shop_quick` override allowed a second persistent UI configuration
 * to diverge from the code-defined channel contract. Reads return the canonical code value;
 * runtime writes are retired rather than silently creating another source of truth.
 */
export async function GET(request: Request) {
  const key = S(new URL(request.url).searchParams.get('wl'));
  const wl = WHITELABELS.find((item) => item.key === key);
  if (!wl) return NextResponse.json({ error: '페이지를 찾지 못했습니다' }, { status: 404 });
  return NextResponse.json({ quick: wl.quick ?? null });
}

export async function PUT(): Promise<Response> {
  return NextResponse.json(
    { error: '빠른조건은 White Label 정본 설정에서 관리합니다.' },
    { status: 410 },
  );
}
