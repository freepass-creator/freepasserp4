/** pyh@teamjpk.com 대행 토큰 + 구글 API 얇은 래퍼. 승인된 범위는 drive · spreadsheets 둘뿐. */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { assertWriteAllowedForUrl } from './lease.mjs';

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:/dev/freepasserp4/tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(KEY, 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export async function token() {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, sub: 'pyh@teamjpk.com',
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const assertion = `${body}.${createSign('RSA-SHA256').update(body).sign(sa.private_key, 'base64url')}`;
  const j = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })).json();
  if (!j.access_token) throw new Error('토큰 실패: ' + JSON.stringify(j));
  return j.access_token;
}

export const colName = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** makeCall은 Drive v3와 Sheets v4만 bearer token을 보낼 수 있다.
 *
 *  ★2026-08-28 — Drive «업로드» 경로를 더했다.
 *  파일을 만드는 것(create·copy)은 이미 /drive/v3/files 로 허용돼 있는데,
 *  «내용이 있는» 파일을 올리려면 경로가 /upload/drive/v3/files 다. 같은 스코프·같은 동작인데
 *  경로만 달라 막혀 있었다 — 직원에게 줄 안내문을 못 올렸다.
 *  ★새 권한을 여는 것이 아니다. 같은 드라이브 권한의 «다른 문» 이다. */
export function assertAllowedGoogleApiUrl(url) {
  const parsed = new URL(String(url));
  const allowed = (parsed.hostname === 'sheets.googleapis.com' && parsed.pathname.startsWith('/v4/spreadsheets'))
    || (parsed.hostname === 'www.googleapis.com' && parsed.pathname.startsWith('/drive/v3/'))
    || (parsed.hostname === 'www.googleapis.com' && parsed.pathname.startsWith('/upload/drive/v3/'));
  if (!allowed) throw new Error(`허용되지 않은 Google API URL입니다: ${parsed.hostname}${parsed.pathname}`);
  return parsed;
}

export function makeCall(tk) {
  return async function call(url, opts = {}, tries = 0) {
    assertAllowedGoogleApiUrl(url);
    await assertWriteAllowedForUrl(url, opts.method || 'GET');
    const r = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${tk}`, 'content-type': 'application/json', ...(opts.headers || {}) },
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    const method = String(opts.method || 'GET').toUpperCase();
    // 쓰기는 서버가 처리한 뒤 응답만 잃을 수 있으므로 자동 재시도하지 않는다.
    if (['GET', 'HEAD', 'OPTIONS'].includes(method) && (r.status === 429 || r.status === 503 || r.status === 500) && tries < 6) {
      const wait = 20000 + tries * 15000;
      process.stdout.write(`[한도대기 ${wait / 1000}s]`);
      await sleep(wait);
      return call(url, opts, tries + 1);
    }
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 500)}`);
    return j;
  };
}

/** 뒤쪽 빈 행·열을 잘라낸 사각형으로 정리 */
export function trim(rows) {
  let maxC = 0, maxR = 0;
  rows.forEach((r, i) => {
    for (let c = r.length - 1; c >= 0; c--) {
      if (String(r[c] ?? '').trim() !== '') { if (c + 1 > maxC) maxC = c + 1; if (i + 1 > maxR) maxR = i + 1; break; }
    }
  });
  return rows.slice(0, maxR).map((r) => { const o = r.slice(0, maxC); while (o.length < maxC) o.push(''); return o; });
}
