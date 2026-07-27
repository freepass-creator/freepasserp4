import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const KINDS = new Set(['products', 'settlements']);

function isLocalRequest(request: Request): boolean {
  const host = String(request.headers.get('host') || '').toLowerCase();
  return host === 'localhost:4004'
    || host === '127.0.0.1:4004'
    || host === '[::1]:4004';
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' || !isLocalRequest(request)) {
    return NextResponse.json({ ok: false, error: '로컬 개발 서버에서만 사용할 수 있습니다.' }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      kind?: string;
      backup?: { exportedAt?: string };
    };
    const kind = String(body.kind || '');
    if (!KINDS.has(kind) || !body.backup || typeof body.backup !== 'object') {
      return NextResponse.json({ ok: false, error: '백업 요청 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    const exportedAt = String(body.backup.exportedAt || new Date().toISOString());
    const stamp = exportedAt.replace(/[^0-9A-Za-z-]/g, '-');
    const filename = `freepasserp-${kind}-backup-${stamp}.json`;
    const backupDir = path.resolve(process.cwd(), 'tmp', 'migration-backups');
    const targetPath = path.resolve(backupDir, filename);
    if (!targetPath.startsWith(`${backupDir}${path.sep}`)) {
      throw new Error('안전하지 않은 백업 경로입니다.');
    }

    const serialized = JSON.stringify(body.backup, null, 2);
    const temporaryPath = `${targetPath}.tmp`;
    await mkdir(backupDir, { recursive: true });
    await writeFile(temporaryPath, serialized, 'utf8');
    await rename(temporaryPath, targetPath);

    return NextResponse.json({
      ok: true,
      path: path.relative(process.cwd(), targetPath).replaceAll(path.sep, '/'),
      bytes: Buffer.byteLength(serialized, 'utf8'),
      sha256: createHash('sha256').update(serialized).digest('hex').toUpperCase(),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: String((error as Error).message || error),
    }, { status: 500 });
  }
}
