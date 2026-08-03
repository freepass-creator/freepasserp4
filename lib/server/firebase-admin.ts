import 'server-only';

import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase, type Database } from 'firebase-admin/database';

const APP_NAME = 'freepass-server';

function serviceAccount(): ServiceAccount {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 미설정');
  const parsed = JSON.parse(raw) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 형식이 올바르지 않습니다.');
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, '\n'),
  };
}

export function firebaseAdminApp(): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;
  const databaseURL = String(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').trim();
  if (!databaseURL) throw new Error('NEXT_PUBLIC_FIREBASE_DATABASE_URL 미설정');
  return initializeApp({ credential: cert(serviceAccount()), databaseURL }, APP_NAME);
}

export function firebaseAdminDatabase(): Database {
  return getDatabase(firebaseAdminApp());
}

export async function verifyAdminBearer(request: Request): Promise<{ uid: string } | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!token) return null;
  try {
    const decoded = await getAuth(firebaseAdminApp()).verifyIdToken(token);
    const snapshot = await firebaseAdminDatabase().ref(`users/${decoded.uid}`).get();
    const profile = snapshot.val() as {
      role?: string;
      status?: string;
      is_active?: boolean | string;
    } | null;
    if (!profile || profile.role !== 'admin') return null;
    if (['pending', 'deleted', 'rejected'].includes(String(profile.status || ''))) return null;
    if (profile.is_active === false || profile.is_active === '아니오') return null;
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}
