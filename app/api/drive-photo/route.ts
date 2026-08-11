import { NextResponse } from 'next/server';
import { getDriveAccessToken, getDriveBackupConfig } from '@/lib/server/drive-backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[a-zA-Z0-9_-]{10,100}$/.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const config = getDriveBackupConfig();
  if (!config) return NextResponse.json({ error: 'drive disabled' }, { status: 503 });
  try {
    const token = await getDriveAccessToken(config);
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=mimeType,appProperties&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    );
    if (!metadataResponse.ok) return NextResponse.json({ error: 'photo unavailable' }, { status: 404 });
    const metadata = (await metadataResponse.json()) as {
      mimeType?: string;
      appProperties?: Record<string, string>;
    };
    if (
      !metadata.mimeType?.startsWith('image/') ||
      metadata.appProperties?.source !== 'freepasserp4-photo-sync'
    ) {
      return NextResponse.json({ error: 'photo unavailable' }, { status: 404 });
    }
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok || !response.body) return NextResponse.json({ error: 'photo unavailable' }, { status: response.status || 502 });
    return new Response(response.body, {
      headers: {
        'content-type': response.headers.get('content-type') || 'image/jpeg',
        'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error('[drive-photo]', error);
    return NextResponse.json({ error: 'photo unavailable' }, { status: 502 });
  }
}
