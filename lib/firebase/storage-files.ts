'use client';

import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  type UploadMetadata,
} from 'firebase/storage';
import { getAuthClient, getStorageClient } from './client';
import { getCompanyId } from '@/lib/tenant';

export type ManagedFileKind = 'product' | 'contract' | 'chat';
export type DriveBackupStatus = 'saved' | 'disabled' | 'failed' | 'skipped';

export type ManagedFile = {
  url: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  file_type: string;
  uploaded_at: number;
  uploaded_by_uid: string;
  drive_backup_status: DriveBackupStatus;
  drive_file_id?: string;
  drive_web_view_link?: string;
};

export type ManagedFileContext = {
  kind: ManagedFileKind;
  entityId: string;
  backupToDrive?: boolean;
};

const FILE_LIMITS: Record<ManagedFileKind, number> = {
  product: 3 * 1024 * 1024,
  contract: 4 * 1024 * 1024,
  chat: 3 * 1024 * 1024,
};

function safeSegment(value: string, fallback: string): string {
  const clean = String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return clean || fallback;
}

function uploadId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${Date.now()}_${random.slice(0, 20)}`;
}

async function backupToDrive(
  file: File,
  context: ManagedFileContext,
  storagePath: string,
): Promise<Pick<ManagedFile, 'drive_backup_status' | 'drive_file_id' | 'drive_web_view_link'>> {
  if (!context.backupToDrive || context.kind === 'chat') {
    return { drive_backup_status: 'skipped' };
  }
  const user = getAuthClient()?.currentUser;
  if (!user) return { drive_backup_status: 'failed' };
  try {
    const body = new FormData();
    body.set('file', file);
    body.set('kind', context.kind);
    body.set('entityId', context.entityId);
    body.set('storagePath', storagePath);
    const response = await fetch('/api/drive-backup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      body,
    });
    const result = await response.json().catch(() => ({})) as {
      code?: string;
      fileId?: string;
      webViewLink?: string;
    };
    if (response.status === 503 && result.code === 'DRIVE_BACKUP_DISABLED') {
      return { drive_backup_status: 'disabled' };
    }
    if (!response.ok || !result.fileId) return { drive_backup_status: 'failed' };
    return {
      drive_backup_status: 'saved',
      drive_file_id: result.fileId,
      drive_web_view_link: result.webViewLink,
    };
  } catch {
    return { drive_backup_status: 'failed' };
  }
}

export async function uploadManagedFile(file: File, context: ManagedFileContext): Promise<ManagedFile> {
  const storage = getStorageClient();
  const user = getAuthClient()?.currentUser;
  if (!storage) throw new Error('Firebase Storage가 설정되지 않았습니다');
  if (!user) throw new Error('파일 업로드는 로그인이 필요합니다');
  const limit = FILE_LIMITS[context.kind];
  if (file.size > limit) throw new Error(`${Math.round(limit / (1024 * 1024))}MB 초과 파일은 업로드할 수 없습니다`);
  if (!context.entityId.trim()) throw new Error('파일 귀속 코드가 없습니다');

  const companyId = safeSegment(getCompanyId(), 'freepass');
  const entityId = safeSegment(context.entityId, 'unknown');
  const fileName = safeSegment(file.name, 'file');
  const storagePath = `erp/${companyId}/${context.kind}/${entityId}/${user.uid}/${uploadId()}_${fileName}`;
  const metadata: UploadMetadata = {
    contentType: file.type || 'application/octet-stream',
    customMetadata: {
      companyId,
      kind: context.kind,
      entityId,
      uploaderUid: user.uid,
      originalName: file.name.slice(0, 180),
    },
  };
  const uploaded = await uploadBytes(ref(storage, storagePath), file, metadata);
  const url = await getDownloadURL(uploaded.ref);
  const drive = await backupToDrive(file, context, storagePath);
  return {
    url,
    storage_path: storagePath,
    file_name: file.name,
    file_size: file.size,
    file_type: file.type || 'application/octet-stream',
    uploaded_at: Date.now(),
    uploaded_by_uid: user.uid,
    ...drive,
  };
}

/** Drive 백업은 보존하고 서비스 원본(Storage)만 삭제한다. 레거시 data URL·외부 URL은 무시. */
export async function deleteManagedFile(pathOrUrl: string): Promise<void> {
  const value = String(pathOrUrl || '');
  if (!value || value.startsWith('data:')) return;
  if (
    /^https?:\/\//i.test(value)
    && !/firebasestorage\.googleapis\.com|firebasestorage\.app/i.test(value)
  ) return;
  const storage = getStorageClient();
  if (!storage) throw new Error('Firebase Storage가 설정되지 않았습니다');
  await deleteObject(ref(storage, value));
}
