/**
 * RTDB 규칙 받기/올리기 — 서비스계정 토큰으로 `.settings/rules.json` 을 직접 다룬다.
 *
 * 규칙 게시는 되돌리기 어려운 축에 속한다(잘못 올리면 전원 401). 그래서 이 순서를 강제한다.
 *   get  → 라이브 원본을 파일로 받는다(백업)
 *   put  → 파일을 올린다. **올리기 직전에 라이브를 한 번 더 받아 타임스탬프 백업으로 남긴다.**
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/rtdb-rules.mts get  <out.json>
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/rtdb-rules.mts put  <in.json>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const MODE = process.argv[2];
const FILE = process.argv[3];

if (!['get', 'put'].includes(MODE || '') || !FILE) {
  console.error('사용법: npx tsx scripts/rtdb-rules.mts <get|put> <파일>');
  process.exit(1);
}

const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault() });

/** 서비스계정으로 OAuth 액세스 토큰 발급 — firebase-admin 내부 credential 을 그대로 쓴다. */
async function token(): Promise<string> {
  const { getApp } = await import('firebase-admin/app');
  const app: any = getApp();
  const t = await app.options.credential.getAccessToken();
  return t.access_token as string;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function fetchRules(tk: string): Promise<string> {
  const r = await fetch(`${DB}/.settings/rules.json`, { headers: { Authorization: `Bearer ${tk}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`GET 실패 ${r.status}: ${body.slice(0, 300)}`);
  return body;
}

async function main() {
  if (!saPath && !saJson) { console.error('서비스계정 자격증명이 없다.'); process.exit(1); }
  const tk = await token();

  if (MODE === 'get') {
    const body = await fetchRules(tk);
    writeFileSync(FILE, body, 'utf8');
    console.log(`받음 → ${FILE} (${body.length}바이트)`);
    return;
  }

  // put — 올리기 전에 현재 라이브를 백업으로 남긴다. 이게 유일한 즉시 복구 수단이다.
  mkdirSync('tmp/rules', { recursive: true });
  const backup = `tmp/rules/live-before-${stamp()}.json`;
  writeFileSync(backup, await fetchRules(tk), 'utf8');
  console.log(`직전 라이브 백업 → ${backup}`);

  const next = readFileSync(FILE, 'utf8');
  JSON.parse(next); // 형식 깨진 채 올리면 전원 401 — 미리 막는다
  const r = await fetch(`${DB}/.settings/rules.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: next,
  });
  const out = await r.text();
  if (!r.ok) throw new Error(`PUT 실패 ${r.status}: ${out.slice(0, 500)}`);
  console.log(`게시 완료 (${next.length}바이트). 되돌리려면: npx tsx scripts/rtdb-rules.mts put ${backup}`);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
