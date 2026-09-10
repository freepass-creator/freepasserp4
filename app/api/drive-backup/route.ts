import { NextRequest, NextResponse } from 'next/server';
import {
  getDriveBackupConfig,
  safeDriveName,
  uploadDriveBackup,
  type DriveBackupKind,
} from '@/lib/server/drive-backup';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_KINDS = new Set<DriveBackupKind>(['product', 'contract']);

async function verifyFirebaseUser(req: NextRequest): Promise<{ uid: string } | null> {
  const user = await verifyActiveBearer(req);
  return user ? { uid: user.uid } : null;
}

export async function GET() {
  return NextResponse.json({ enabled: !!getDriveBackupConfig() });
}

export async function POST(req: NextRequest) {
  const config = getDriveBackupConfig();
  if (!config) {
    return NextResponse.json(
      { code: 'DRIVE_BACKUP_DISABLED', error: 'Google Drive 백업 환경변수가 설정되지 않았습니다' },
      { status: 503 },
    );
  }
  const user = await verifyFirebaseUser(req);
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: '잘못된 multipart 요청입니다' }, { status: 400 });
  }
  const file = form.get('file');
  const kind = String(form.get('kind') || '') as DriveBackupKind;
  const rawEntityId = String(form.get('entityId') || '').trim();
  const entityId = safeDriveName(rawEntityId, '');
  const storagePath = String(form.get('storagePath') || '').slice(0, 500);
  const storageParts = storagePath.split('/');
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ error: '백업할 파일이 없습니다' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '10MB 초과 파일은 Drive 백업할 수 없습니다' }, { status: 413 });
  }
  if (
    !ALLOWED_KINDS.has(kind)
    || !entityId
    || storageParts.length !== 6
    || storageParts[0] !== 'erp'
    || storageParts[2] !== kind
    || storageParts[4] !== user.uid
    || !storageParts[3]
    || !storageParts[5]
  ) {
    return NextResponse.json({ error: '백업 귀속 정보가 올바르지 않습니다' }, { status: 400 });
  }

  try {
    const saved = await uploadDriveBackup({
      config,
      kind,
      entityId,
      storagePath,
      uploaderUid: user.uid,
      file,
    });
    return NextResponse.json({
      ok: true,
      fileId: saved.id,
      name: saved.name,
      webViewLink: saved.webViewLink,
    });
  } catch (error) {
    console.error('[drive-backup] upload failed:', error);
    return NextResponse.json(
      { error: 'Google Drive 백업에 실패했습니다' },
      { status: 502 },
    );
  }
}
