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

/**
 * 업로더 확인은 서버 공통 인증 게이트 `verifyActiveBearer` 하나만 쓴다.
 *
 * ★이 라우트에는 자체 게이트가 있었고 「승인 대기」 검사가 `if (dbUrl)` 안에 들어 있었다.
 *   RTDB URL 환경변수가 비면 검사가 통째로 건너뛰어져, 가입만 하고 승인받지 않은 계정이
 *   드라이브 업로드를 통과했다(fail-open). RTDB는 2026-09-14 폐기라 그 조건이 실제로 성립했다.
 *   ⇒ 상태를 «확인하지 못하면 거부»한다. 검사를 조건문으로 감싸지 마라.
 *
 * 구성·서비스 장애는 verifyActiveBearer가 던지므로 여기서 삼키지 않고 503으로 올린다.
 * (장애를 null로 눌러 401을 주면 다음 사람이 다시 fail-open을 만들기 쉽다.)
 */
type AuthOutcome =
  | { ok: true; uid: string }
  | { ok: false; status: 401 | 503 };

async function authorizeUploader(req: NextRequest): Promise<AuthOutcome> {
  try {
    const actor = await verifyActiveBearer(req);
    if (!actor) return { ok: false, status: 401 };
    return { ok: true, uid: actor.uid };
  } catch (error) {
    console.error('[drive-backup] auth gate unavailable:', error);
    return { ok: false, status: 503 };
  }
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
  const auth = await authorizeUploader(req);
  if (!auth.ok) {
    return auth.status === 503
      ? NextResponse.json(
        { code: 'AUTH_GATE_UNAVAILABLE', error: '사용자 상태를 확인할 수 없어 업로드를 거부했습니다' },
        { status: 503 },
      )
      : NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  }
  const user = { uid: auth.uid };

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
