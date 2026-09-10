'use client';
/** Firestore client profile and partner readers. */
import { getFirebaseApp } from './client';
import { collection, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore';

export async function readUserProfile(uid: string): Promise<Record<string, unknown> | null> {
  const app = getFirebaseApp();
  if (!app || !uid) return null;
  const snap = await getDoc(doc(getFirestore(app), 'user', uid));
  return snap.exists() ? snap.data() as Record<string, unknown> : null;
}

/** 공급사 맵 { code → partner }. */
export async function readPartnersMap(): Promise<Record<string, Record<string, unknown>>> {
  const app = getFirebaseApp();
  if (!app) return {};
  const snap = await getDocs(collection(getFirestore(app), 'partner'));
  const out: Record<string, Record<string, unknown>> = {};
  snap.forEach((d) => { out[d.id] = d.data() as Record<string, unknown>; });
  return out;
}
