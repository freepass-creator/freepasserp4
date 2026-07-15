// Firebase 클라이언트 — v5/v4 공유 프로젝트(jpkerp) RTDB + Auth. v6는 읽기전용으로 연결.
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getAuth, type Auth } from 'firebase/auth';

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** 실데이터 루트. v4는 root 직접(prefix 없음). v5 네임스페이스는 'v5'. 현재 실데이터=v4 root. */
export const DATA_ROOT = '';

export function firebaseReady(): boolean { return !!cfg.apiKey; }

export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseReady()) return null;
  return getApps().length ? getApp() : initializeApp(cfg);
}
export function getRtdb(): Database | null { const a = getFirebaseApp(); return a ? getDatabase(a) : null; }
export function getAuthClient(): Auth | null { const a = getFirebaseApp(); return a ? getAuth(a) : null; }

/** RTDB 노드 경로(루트 프리픽스 적용). */
export function dataPath(...parts: string[]): string {
  return [DATA_ROOT, ...parts].filter(Boolean).join('/');
}
