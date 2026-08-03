import { NextResponse } from 'next/server';
import { verifyAdminBearer } from '@/lib/server/firebase-admin';
import { auditProductDuplicateReferences } from '@/lib/server/product-duplicate-audit';

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
    return NextResponse.json(await auditProductDuplicateReferences(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'duplicate reference audit unavailable' }, { status: 503 });
  }
}
