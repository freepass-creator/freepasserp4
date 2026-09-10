/**
 * RTDB는 운영 SSOT에서 제거되었다.
 *
 * 과거 일회성 스크립트가 실수로 예전 데이터베이스를 다시 읽거나 쓰지 못하도록
 * Firebase RTDB Admin 진입점을 이 차단 모듈로 고정한다. 필요한 작업은 Firestore
 * 원자 저장소용 스크립트로 다시 작성해야 한다.
 */
throw new Error('RTDB_REMOVED: 이 스크립트는 폐기된 RTDB 경로를 사용합니다. Firestore SSOT용으로 전환한 뒤 실행하세요.');

export type Database = never;

export function getDatabase(..._args: unknown[]): never {
  throw new Error('RTDB_REMOVED: 이 스크립트는 폐기된 RTDB 경로를 사용합니다. Firestore SSOT용으로 전환한 뒤 실행하세요.');
}
