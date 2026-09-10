/**
 * 민감필드(_private) 헬퍼 — 상업기밀(공급사 fee_rate)·PII(email 등)를
 * Firestore `partners_private` · `users_private` 컬렉션으로 분리한다.
 *
 * ★안전 계약(비타협):
 *   · 모든 read 는 "폴백 시그니처" — 호출부는 `private?.field ?? record.field ?? 기본` 으로 쓴다.
 *     private 노드가 없으면(=미마이그레이션·권한없음·no-db) null 을 돌려 본노드 값으로 폴백 → 기존과 동일 동작.
 *   · 모든 write 는 절대 throw 하지 않고 boolean(성공 여부)만 반환한다. 호출부는 이 값으로
 *     "본노드에서 뺄지"를 결정 → 규칙 미게시/no-db 단계에선 write 실패(false)로 보고 본노드에 그대로 남긴다
 *     (데이터 유실·머니 스냅샷 깨짐 방지). 규칙 게시 후에만 private 이관이 활성화.
 *   · Firebase가 설정된 경우에만 활성화한다.
 */
import { collection, doc, getDoc, getDocs, getFirestore, setDoc } from 'firebase/firestore';
import { getFirebaseApp, firebaseReady } from '@/lib/firebase/client';

type Rec = Record<string, unknown>;

const PARTNER_PRIVATE = 'partners_private';
const USER_PRIVATE = 'users_private';

/** RTDB update()/set() 는 값에 undefined 있으면 throw → 저장 직전 제거. */
const stripUndef = (o: Rec): Rec => {
  const r: Rec = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
  return r;
};

/**
 * private 노드가 실 데이터(v4 오버레이)와 같은 백엔드에 살 때만 활성.
 * rtdb 백엔드가 아니면(로컬/데모/파이어스토어) private 을 쓰지 않는다 —
 * 본노드가 단일 진실원이고 폴백이 기존 동작을 그대로 보존한다.
 */
export function privateFieldsActive(): boolean {
  return firebaseReady() && !!getFirebaseApp();
}

async function readPrivate(base: string, id: string): Promise<Rec | null> {
  if (!privateFieldsActive() || !id) return null;
  const app = getFirebaseApp();
  if (!app) return null;
  try {
    const snap = await getDoc(doc(getFirestore(app), base, id));
    const val = snap.exists() ? snap.data() : null;
    return val && typeof val === 'object' ? (val as Rec) : null;
  } catch {
    // 권한없음·네트워크 실패 → null(폴백). 머니플로우가 이 실패로 절대 깨지지 않게 한다.
    return null;
  }
}

/** 노드 전체 1회 조회(관리자 enrich 용). {} on 실패/비활성. */
async function readAllPrivate(base: string): Promise<Record<string, Rec>> {
  if (!privateFieldsActive()) return {};
  const app = getFirebaseApp();
  if (!app) return {};
  try {
    const snap = await getDocs(collection(getFirestore(app), base));
    const out: Record<string, Rec> = {};
    snap.forEach((row) => { out[row.id] = row.data() as Rec; });
    return out;
  } catch {
    return {};
  }
}

async function writePrivate(base: string, id: string, fields: Rec): Promise<boolean> {
  if (!privateFieldsActive() || !id) return false;
  const app = getFirebaseApp();
  if (!app) return false;
  const patch = stripUndef(fields);
  if (!Object.keys(patch).length) return false;
  try {
    await setDoc(doc(getFirestore(app), base, id), patch, { merge: true });
    return true;
  } catch {
    // 규칙 미게시·권한·네트워크 실패 → false. 호출부는 본노드에 값을 유지(유실 방지).
    return false;
  }
}

/** 공급사 민감필드(fee_rate 등) 읽기 — 없으면 null(본노드 폴백). */
export function readPartnerPrivate(code: string): Promise<Rec | null> {
  return readPrivate(PARTNER_PRIVATE, String(code || ''));
}
/** 회원 민감필드(email 등) 읽기 — 없으면 null(본노드 폴백). */
export function readUserPrivate(uid: string): Promise<Rec | null> {
  return readPrivate(USER_PRIVATE, String(uid || ''));
}
/** 공급사 민감필드 저장 — 성공 true / 비활성·실패 false(본노드 유지 신호). */
export function writePartnerPrivate(code: string, fields: Rec): Promise<boolean> {
  return writePrivate(PARTNER_PRIVATE, String(code || ''), fields);
}
/** 회원 민감필드 저장 — 성공 true / 비활성·실패 false(본노드 유지 신호). */
export function writeUserPrivate(uid: string, fields: Rec): Promise<boolean> {
  return writePrivate(USER_PRIVATE, String(uid || ''), fields);
}
/** 전 공급사 private 1회 조회(관리자 회원관리 enrich). */
export function readAllPartnersPrivate(): Promise<Record<string, Rec>> {
  return readAllPrivate(PARTNER_PRIVATE);
}
/** 전 회원 private 1회 조회(관리자 회원관리 enrich). */
export function readAllUsersPrivate(): Promise<Record<string, Rec>> {
  return readAllPrivate(USER_PRIVATE);
}
