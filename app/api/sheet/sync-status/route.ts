import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503 });
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const snapshot = await firebaseAdminDatabase().ref('v4/system_status/sheet_daily_sync').get();
    const value = snapshot.val();
    return NextResponse.json({
      enabled: String(process.env.SHEET_DAILY_SYNC_ENABLED || '').toLowerCase() === 'true',
      schedule: '매일 02:00 KST',
      lastRun: value && typeof value === 'object' ? value : null,
    });
  } catch {
    return NextResponse.json({ error: 'sync status unavailable' }, { status: 503 });
  }
}
