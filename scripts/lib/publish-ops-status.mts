import { OPS_PIPELINE_PATH, type OpsPipelineStatus } from '../../lib/ops-status';
import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * 관제탑에 «지금 상태»를 올린다 — 자동동기(`hourly-sync.mts`)가 단계마다 부른다.
 *
 * ★★**이 함수는 절대 파이프라인을 멈추지 않는다.**
 *   자격증명이 없든, 네트워크가 죽었든, Firestore가 거부하든 **조용히 넘어간다.**
 *   상태를 못 올리는 것은 불편한 일이지만, 그것 때문에 매물 발행이 멈추면
 *   «보여 주려다 본업을 죽이는» 꼴이 된다. 관제탑은 곁다리지 본체가 아니다.
 *   (GitHub Actions 처럼 자격증명이 없는 데서도 전 구간이 그냥 돌아야 한다 —
 *    ⓪ 손오공 단계가 계정 파일 없으면 «건너뛰는» 것과 같은 원칙이다)
 *
 * ★쓰기는 **통째로 덮어쓴다**(set). 부분 갱신을 하면 지난 회차 단계가 남아
 *   이번 회차 것과 섞인다 — 관제탑이 거짓말을 하는 제일 흔한 경로다.
 */

let store: Firestore | null = null;
let tried = false;

function firestore(): Firestore | null {
  if (tried) return store;
  tried = true;
  try {
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    const hasFile = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    const emulator = String(process.env.FIRESTORE_EMULATOR_HOST || '').trim();
    const configuredProjectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
    if (!raw && !hasFile && !emulator) return null;
    const name = 'ops-status-firestore';
    let app: App | undefined = getApps().find((item) => item.name === name);
    if (!app) {
      const parsed = raw ? JSON.parse(raw) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      } : null;
      if (!emulator && configuredProjectId && parsed?.project_id && parsed.project_id !== configuredProjectId) {
        throw new Error(`Firebase 프로젝트 불일치: client=${configuredProjectId}, service=${parsed.project_id}`);
      }
      app = initializeApp(emulator ? {
        projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-freepass-path-store',
      } : {
        credential: parsed
          ? cert({
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            privateKey: String(parsed.private_key || '').replace(/\\n/g, '\n'),
          })
          : applicationDefault(),
      }, name);
    }
    if (!emulator && configuredProjectId && app.options.projectId && app.options.projectId !== configuredProjectId) {
      throw new Error(`Firebase 프로젝트 불일치: client=${configuredProjectId}, service=${app.options.projectId}`);
    }
    store = getFirestore(app);
    return store;
  } catch {
    return null;
  }
}

/** 상태 한 줄 올리기. 실패해도 아무 일 없다. */
export async function publishOpsStatus(status: OpsPipelineStatus): Promise<void> {
  try {
    const fs = firestore();
    if (!fs) return;
    const [, collection, document] = OPS_PIPELINE_PATH.split('/');
    if (!collection || !document) return;
    await fs.collection(collection).doc(document).set(status);
  } catch { /* 관제탑은 곁다리다 — 본업을 막지 않는다 */ }
}
