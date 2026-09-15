// 독립 tsx 운영 스크립트가 Next의 server-only 모듈을 안전하게 불러오게 한다.
import './server-only-shim.cjs';
import type { AdminRef } from '../../lib/server/firestore-path-store';

const { firebaseAdminStore } = await import('../../lib/server/firebase-admin');

/**
 * 옛 경로형 호출(`ref(path)`)을 Firestore 컬렉션/문서로 보내는 호환 진입점.
 * 인자는 과거 getDatabase(app) 호출과의 호환을 위해 받되 저장소 선택에는 쓰지 않는다.
 */
export function getDatabase(..._args: unknown[]): AdminRef {
  return firebaseAdminStore();
}

export type Database = AdminRef;
