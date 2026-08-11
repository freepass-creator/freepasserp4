import { NextResponse } from 'next/server';
import { runPhotoDriveSync } from '@/lib/server/photo-drive-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = String(process.env.CRON_SECRET || '').trim();
  return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (String(process.env.PHOTO_DRIVE_SYNC_ENABLED || '').toLowerCase() !== 'true') {
    return NextResponse.json({ error: 'photo drive sync disabled' }, { status: 503 });
  }
  const url = new URL(request.url);
  try {
    const result = await runPhotoDriveSync({
      origin: url.origin,
      limit: Number(url.searchParams.get('limit') || 2),
      reset: url.searchParams.get('reset') === '1',
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[photo-drive-sync]', error);
    return NextResponse.json({ error: String((error as Error)?.message || error) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
