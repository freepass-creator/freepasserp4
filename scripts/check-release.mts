import fs from 'node:fs';
import path from 'node:path';
import { missingOperatorFields } from '../lib/legal';

const root = process.cwd();
const failures: string[] = [];
const warnings: string[] = [];

function envKeys(file: string): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && m[2].trim() && !/^(["'])?\1$/.test(m[2].trim())) out.add(m[1]);
  }
  return out;
}

const localEnv = envKeys(path.join(root, '.env.local'));
const hasEnv = (key: string) => Boolean(process.env[key]) || localEnv.has(key);
const firebaseKeys = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_DATABASE_URL',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

const missingLegal = missingOperatorFields();
if (missingLegal.length) failures.push(`약관·개인정보 운영자 정보 미기재: ${missingLegal.join(', ')}`);

const missingFirebase = firebaseKeys.filter((key) => !hasEnv(key));
if (missingFirebase.length) failures.push(`Firebase 필수 환경변수 누락: ${missingFirebase.join(', ')}`);

for (const file of ['app/error.tsx', 'app/global-error.tsx', 'components/ClientErrorReporter.tsx']) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`오류 관측/복구 파일 누락: ${file}`);
}

const manifest = fs.readFileSync(path.join(root, 'app/manifest.ts'), 'utf8');
if (!manifest.includes("display: 'standalone'")) failures.push('PWA manifest standalone 설정 누락');
if (!/192x192|512x512/.test(manifest)) warnings.push('스토어/PWA용 192x192·512x512 PNG 아이콘 미확인');
if (!fs.existsSync(path.join(root, 'public', 'sw.js'))) warnings.push('서비스 워커가 없어 오프라인/업데이트 복구는 웹앱 범위 밖');

const nextConfig = fs.readFileSync(path.join(root, 'next.config.mjs'), 'utf8');
for (const header of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
  if (!nextConfig.includes(header)) warnings.push(`보안 응답 헤더 미설정: ${header}`);
}

const storageRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');
if (/match \/contract-files[\s\S]*?allow create, update:[\s\S]*?request\.resource\.size < 20/.test(storageRules)
  && !/match \/contract-files[\s\S]*?request\.resource\.contentType/.test(storageRules)) {
  warnings.push('레거시 contract-files 업로드 규칙에 MIME 형식 제한 없음');
}

for (const warning of warnings) console.warn(`WARN  ${warning}`);
for (const failure of failures) console.error(`FAIL  ${failure}`);

if (failures.length) {
  console.error(`\n출시 게이트 FAIL — ${failures.length}개 차단 항목, ${warnings.length}개 경고`);
  process.exit(1);
}

console.log(`출시 게이트 PASS — 차단 항목 0개, 경고 ${warnings.length}개`);
