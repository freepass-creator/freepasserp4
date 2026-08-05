import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
};

/** ERP4 상품은 v4/products 단독 정본이다. 레거시 상품 브리지는 다시 열지 않는다. */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    { error: 'legacy product bridge retired', source: 'v4/products' },
    { status: 410, headers: PRIVATE_RESPONSE_HEADERS },
  );
}
