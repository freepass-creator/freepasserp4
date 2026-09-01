/**
 * 배포 스크립트 공통 문맥 — 「어느 프로젝트에 쏘는가」를 한 곳에서만 정한다.
 *
 * 규칙 게시는 되돌리기가 비싸다. 그런데 DB URL·서비스계정 경로가 스크립트마다
 * 복붙돼 있으면 **한 스크립트만 다른 인스턴스를 보게 되는 날**이 온다.
 * 그 사고는 조용해서 «규칙을 올렸는데 안 바뀌네» 로만 보인다. 그래서 여기 하나만 둔다.
 */
import { readFileSync } from 'node:fs';

/** ★ freepasserp3 인스턴스는 asia-southeast1 이다. 기본 .firebaseio.com 이 아니다. */
export const DATABASE_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
export const PROJECT_ID = 'freepasserp3';
export const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json';
/** 데이터 이관은 백업 도구와 같은 루트·manifest를 써야 대상 DB를 교차확인할 수 있다. */
export const RTDB_BACKUP_ROOT = process.env.RTDB_BACKUP_DIR || 'D:/backup/freepasserp4-rtdb';

/** 규칙 REST 엔드포인트. firebase CLI 로그인 대신 서비스계정 토큰을 쓴다. */
export const RULES_URL = `${DATABASE_URL}/.settings/rules.json`;

export async function accessToken(): Promise<string> {
  const { initializeApp, cert, getApps, getApp } = await import('firebase-admin/app');
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const app = getApps().length ? getApp() : initializeApp({ credential: cert(sa), databaseURL: DATABASE_URL });
  const token = await app.options.credential!.getAccessToken();
  return token.access_token;
}

/** 실행 인자 파서 — `--yes` 같은 플래그와 위치인자를 가른다. */
export function argv(): { cmd: string; flags: Set<string>; rest: string[] } {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const rest = args.filter((a) => !a.startsWith('--'));
  return { cmd: rest[0] || '', flags, rest: rest.slice(1) };
}

export const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export function die(message: string): never {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}
