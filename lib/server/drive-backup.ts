import 'server-only';

export type DriveBackupKind = 'product' | 'contract';

export type DriveBackupConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootFolderId: string;
};

type DriveFile = {
  id: string;
  name?: string;
  webViewLink?: string;
};

export function getDriveBackupConfig(): DriveBackupConfig | null {
  const config: DriveBackupConfig = {
    clientId: String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim(),
    refreshToken: String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim(),
    rootFolderId: String(process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || '').trim(),
  };
  return Object.values(config).every(Boolean) ? config : null;
}

export function safeDriveName(value: string, fallback = 'file'): string {
  const clean = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return clean || fallback;
}

export function driveScopeLabel(kind: DriveBackupKind): string {
  return kind === 'product' ? '상품' : '계약';
}

function driveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveJson<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message || `Google Drive API ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function getDriveAccessToken(config: DriveBackupConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const result = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || `Google OAuth ${response.status}`);
  }
  return result.access_token;
}

export async function ensureDriveFolder(accessToken: string, parentId: string, name: string): Promise<string> {
  const q = [
    `'${driveQueryLiteral(parentId)}' in parents`,
    `name = '${driveQueryLiteral(name)}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    'trashed = false',
  ].join(' and ');
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    pageSize: '1',
    spaces: 'drive',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });
  const found = await driveJson<{ files?: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    accessToken,
  );
  if (found.files?.[0]?.id) return found.files[0].id;

  const created = await driveJson<DriveFile>(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name',
    accessToken,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    },
  );
  if (!created.id) throw new Error('Google Drive 백업 폴더를 만들지 못했습니다');
  return created.id;
}

export async function findDriveFile(accessToken: string, parentId: string, name: string): Promise<DriveFile | null> {
  const q = [
    `'${driveQueryLiteral(parentId)}' in parents`,
    `name = '${driveQueryLiteral(name)}'`,
    'trashed = false',
  ].join(' and ');
  const params = new URLSearchParams({
    q, fields: 'files(id,name,webViewLink)', pageSize: '1', spaces: 'drive',
    includeItemsFromAllDrives: 'true', supportsAllDrives: 'true',
  });
  const found = await driveJson<{ files?: DriveFile[] }>(`https://www.googleapis.com/drive/v3/files?${params}`, accessToken);
  return found.files?.[0] || null;
}

export async function uploadRemoteDrivePhoto(input: {
  accessToken: string;
  parentId: string;
  name: string;
  sourceUrl: string;
  appProperties?: Record<string, string>;
}): Promise<DriveFile & { existed?: boolean }> {
  const existing = await findDriveFile(input.accessToken, input.parentId, input.name);
  if (existing) return { ...existing, existed: true };
  const source = await fetch(input.sourceUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FreepassERP/4.0)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!source.ok) throw new Error(`사진 원본 HTTP ${source.status}`);
  const bytes = await source.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new Error('사진 원본 크기 제한 초과');
  const boundary = `fp4_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = {
    name: safeDriveName(input.name), parents: [input.parentId],
    appProperties: { source: 'freepasserp4-photo-sync', ...(input.appProperties || {}) },
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${source.headers.get('content-type') || 'image/jpeg'}\r\n\r\n`, bytes,
    `\r\n--${boundary}--`,
  ]);
  return driveJson<DriveFile>(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink',
    input.accessToken,
    { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body },
  );
}

export async function uploadDriveBackup(input: {
  config: DriveBackupConfig;
  kind: DriveBackupKind;
  entityId: string;
  storagePath: string;
  uploaderUid: string;
  file: File;
}): Promise<DriveFile> {
  const accessToken = await getDriveAccessToken(input.config);
  const scopeFolder = await ensureDriveFolder(accessToken, input.config.rootFolderId, driveScopeLabel(input.kind));
  const entityFolder = await ensureDriveFolder(accessToken, scopeFolder, safeDriveName(input.entityId, 'unknown'));
  const boundary = `fp4_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date();
  const metadata = {
    name: `${now.toISOString().replace(/[:.]/g, '-')}_${safeDriveName(input.file.name)}`,
    parents: [entityFolder],
    appProperties: {
      source: 'freepasserp4',
      kind: input.kind,
      entity_id: input.entityId.slice(0, 120),
      storage_path: input.storagePath.slice(0, 400),
      uploader_uid: input.uploaderUid.slice(0, 128),
    },
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${input.file.type || 'application/octet-stream'}\r\n\r\n`,
    await input.file.arrayBuffer(),
    `\r\n--${boundary}--`,
  ]);
  const result = await driveJson<DriveFile>(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink',
    accessToken,
    {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!result.id) throw new Error('Google Drive 백업 파일 ID가 없습니다');
  return result;
}
