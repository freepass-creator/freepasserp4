import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import { runSheetLiveStatusSync } from '@/lib/server/sheet-live-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await verifyActiveBearer(request);
    if (!actor) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503 });
  }
  const result = await runSheetLiveStatusSync();
  const status = result.ok ? 200 : result.status === 'blocked' ? 409 : 503;
  return NextResponse.json(result, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}

