import { NextResponse } from 'next/server';
import { runDailySheetSync } from '@/lib/server/sheet-daily-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = String(process.env.CRON_SECRET || '').trim();
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  return !!secret && token === secret;
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (String(process.env.SHEET_DAILY_SYNC_ENABLED || '').toLowerCase() !== 'true') {
    return NextResponse.json({ error: 'daily sheet sync disabled' }, { status: 503 });
  }
  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const result = await runDailySheetSync({ dryRun });
  const status = result.ok ? 200 : result.status === 'blocked' ? 409 : 500;
  return NextResponse.json(result, { status });
}

export const GET = handle;
export const POST = handle;
