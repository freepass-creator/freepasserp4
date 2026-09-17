/** 이안카(https://xn--le5bt3bwxk.com/) 연동 클라이언트.
 *
 *  2026-09-17 실측(scripts/diag-ianka-*.mts) — plain fetch로 로그인·재고 조회 다 된다.
 *  헤드리스 브라우저는 Cloudflare 챌린지에 3회 다 막혔다 — 이 API 경로만 쓴다.
 *
 *  ── 인증
 *  계정은 lib/wonja/.이안카계정.json (gitignore, {"email","password"}).
 *  `POST /api/auth/login` {login,password} → 200 {"ok":true} + eancar_session 쿠키.
 *  쿠키는 메모리에만 둔다 — 매 실행마다 새로 로그인(손오공처럼 토큰 캐시할 만큼 자주 안 돌린다).
 *
 *  ── 엔드포인트
 *    POST /api/auth/login  {login,password}   로그인 (body의 email 필드명이 login이다)
 *    GET  /api/inventory                       재고 전량 — { models:[{name,count,units:[...]}], reservedVehicles, ... }
 *
 *  ⚠ 기간별 요금(1~60개월) API는 2026-09-17 기준 아직 못 찾았다(diag-ianka-pricing-api.mts 진행 중 —
 *    /api/rates 가 403으로 응답해 경로는 있는 듯하나 파라미터/권한을 못 맞췄다). 찾기 전엔 요금·보증금을
 *    지어내지 않는다 — 이 클라이언트는 재고(차번·상태·제원)만 준다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const 계정경로 = path.join(루트, 'lib', 'wonja', '.이안카계정.json');
export const HOME = 'https://xn--le5bt3bwxk.com';

function 계정읽기() {
  if (process.env.IANKA_ACCOUNT_JSON) {
    try { return JSON.parse(process.env.IANKA_ACCOUNT_JSON); } catch { /* 파일로 폴백 */ }
  }
  try {
    return JSON.parse(fs.readFileSync(계정경로, 'utf8'));
  } catch {
    throw new Error('이안카 계정 없음 — IANKA_ACCOUNT_JSON 환경변수나 lib/wonja/.이안카계정.json 에 {"email","password"} 를 두세요.');
  }
}

function 쿠키묶음(res, jar) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    jar.set(name, pair);
  }
}

/** 로그인해서 쿠키 저장소(Map)를 반환한다. 실패하면 던진다. */
export async function login() {
  const { email, password } = 계정읽기();
  if (!email || !password) throw new Error('이안카 계정에 email/password 가 없습니다.');
  const jar = new Map();
  const loginPage = await fetch(`${HOME}/login`, {
    headers: { 'User-Agent': 'FreepassERP/4 ianka-source' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  쿠키묶음(loginPage, jar);
  const res = await fetch(`${HOME}/api/auth/login`, {
    method: 'POST',
    headers: {
      'User-Agent': 'FreepassERP/4 ianka-source',
      'Content-Type': 'application/json',
      Cookie: [...jar.values()].join('; '),
    },
    body: JSON.stringify({ login: email, password }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  쿠키묶음(res, jar);
  if (!res.ok) throw new Error(`이안카 로그인 실패 HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return jar;
}

/** 재고 전량(모델별 units + reservedVehicles + 최상위 집계)을 가져온다. */
export async function fetchInventory(jar) {
  const res = await fetch(`${HOME}/api/inventory`, {
    headers: { 'User-Agent': 'FreepassERP/4 ianka-source', Cookie: [...jar.values()].join('; ') },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`이안카 /api/inventory 실패 HTTP ${res.status}`);
  return res.json();
}

/** 로그인 → 재고 전량. 한 번에 쓰는 편의 함수. */
export async function pullAll() {
  const jar = await login();
  return fetchInventory(jar);
}
