import { OPS_PIPELINE_PATH, type OpsPipelineStatus } from '../../lib/ops-status';

/**
 * 관제탑에 «지금 상태»를 올린다 — 자동동기(`hourly-sync.mts`)가 단계마다 부른다.
 *
 * ★★**이 함수는 절대 파이프라인을 멈추지 않는다.**
 *   자격증명이 없든, 네트워크가 죽었든, RTDB 가 거부하든 **조용히 넘어간다.**
 *   상태를 못 올리는 것은 불편한 일이지만, 그것 때문에 매물 발행이 멈추면
 *   «보여 주려다 본업을 죽이는» 꼴이 된다. 관제탑은 곁다리지 본체가 아니다.
 *   (GitHub Actions 처럼 자격증명이 없는 데서도 전 구간이 그냥 돌아야 한다 —
 *    ⓪ 손오공 단계가 계정 파일 없으면 «건너뛰는» 것과 같은 원칙이다)
 *
 * ★쓰기는 **통째로 덮어쓴다**(set). 부분 갱신을 하면 지난 회차 단계가 남아
 *   이번 회차 것과 섞인다 — 관제탑이 거짓말을 하는 제일 흔한 경로다.
 */

let db: import('firebase-admin/database').Database | null = null;
let tried = false;

async function database() {
  if (tried) return db;
  tried = true;
  try {
    const { initializeApp, cert, getApps, applicationDefault } = await import('firebase-admin/app');
    const { getDatabase } = await import('firebase-admin/database');
    const url = String(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').trim();
    if (!url) return null;
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    const hasFile = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    if (!raw && !hasFile) return null;   // 자격증명이 없다 — 조용히 포기한다
    const name = 'ops-status';
    const existing = getApps().find((a) => a.name === name);
    if (existing) { db = getDatabase(existing); return db; }
    const parsed = raw ? JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string } : null;
    const app = initializeApp({
      credential: parsed
        ? cert({ projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey: String(parsed.private_key || '').replace(/\\n/g, '\n') })
        : applicationDefault(),
      databaseURL: url,
    }, name);
    db = getDatabase(app);
    return db;
  } catch {
    return null;   // 무슨 일이 있어도 파이프라인은 계속 간다
  }
}

/** 상태 한 줄 올리기. 실패해도 아무 일 없다. */
export async function publishOpsStatus(status: OpsPipelineStatus): Promise<void> {
  try {
    const d = await database();
    if (!d) return;
    await d.ref(OPS_PIPELINE_PATH).set(status);
  } catch { /* 관제탑은 곁다리다 — 본업을 막지 않는다 */ }
}
