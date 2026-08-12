import { NextResponse } from 'next/server';
import { verifyAdminBearer } from '@/lib/server/firebase-admin';
import { fetchVisibleGoogleSheetTable } from '@/lib/server/google-sheet-visible';
import {
  DEFAULT_SUPPLIER_HUB_URL,
  parseHubTable,
} from '@/lib/domain/sheet-hub-sync';

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
    const spreadsheetId = (DEFAULT_SUPPLIER_HUB_URL.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || '';
    const gid = DEFAULT_SUPPLIER_HUB_URL.match(/[?&#]gid=(\d+)/)?.[1] || '0';
    const table = await fetchVisibleGoogleSheetTable(spreadsheetId, gid);
    return NextResponse.json({ rows: parseHubTable(table.rows) });
  } catch (error) {
    return NextResponse.json({ error: String((error as Error).message || error) }, { status: 502 });
  }
}
