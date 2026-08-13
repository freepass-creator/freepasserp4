import { NextResponse } from 'next/server';
import { runDailySheetSync } from '@/lib/server/sheet-daily-sync';
import { verifyAdminBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function cronAuthorized(request: Request): boolean {
  const secret = String(process.env.CRON_SECRET || '').trim();
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  return !!secret && token === secret;
}

async function handle(request: Request): Promise<Response> {
  const cron = cronAuthorized(request);
  let admin = false;
  if (!cron) {
    try { admin = Boolean(await verifyAdminBearer(request)); }
    catch { return NextResponse.json({ error: 'server auth unavailable' }, { status: 503 }); }
  }
  if (!cron && !admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (cron && String(process.env.SHEET_DAILY_SYNC_ENABLED || '').toLowerCase() !== 'true') {
    return NextResponse.json({ error: 'daily sheet sync disabled' }, { status: 503 });
  }
  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  let providerCodes: string[] = [];
  if (admin && request.method === 'POST') {
    const body = await request.json().catch(() => ({})) as { providerCodes?: unknown };
    if (Array.isArray(body.providerCodes)) {
      providerCodes = body.providerCodes.map(String).map((code) => code.trim()).filter(Boolean).slice(0, 30);
    }
  }
  const result = await runDailySheetSync({ dryRun, providerCodes });
  const status = result.ok ? 200 : result.status === 'blocked' ? 409 : 500;
  return NextResponse.json(result, { status });
}

export const GET = handle;
export const POST = handle;
