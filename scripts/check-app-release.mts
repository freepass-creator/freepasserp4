import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures: string[] = [];
const warnings: string[] = [];

function envValues(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

const localEnv = envValues(join(root, '.env.local'));
const value = (key: string) => String(process.env[key] ?? localEnv[key] ?? '').trim();
const required = [
  ['NEXT_PUBLIC_OPERATOR_COMPANY', '상호'],
  ['NEXT_PUBLIC_OPERATOR_CEO', '대표자'],
  ['NEXT_PUBLIC_OPERATOR_ADDRESS', '주소'],
  ['NEXT_PUBLIC_OPERATOR_BIZ_NO', '사업자등록번호'],
  ['NEXT_PUBLIC_OPERATOR_EMAIL', '문의 이메일'],
  ['NEXT_PUBLIC_OPERATOR_PRIVACY_OFFICER', '개인정보 보호책임자'],
  ['NEXT_PUBLIC_FIREBASE_API_KEY', 'Firebase API key'],
  ['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'Firebase auth domain'],
  ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'Firebase project id'],
  ['NEXT_PUBLIC_FIREBASE_APP_ID', 'Firebase app id'],
] as const;
for (const [key, label] of required) if (!value(key)) failures.push(`${label} 환경변수 누락 (${key})`);

if (value('NEXT_PUBLIC_OPERATOR_BIZ_NO') && !/^\d{3}-?\d{2}-?\d{5}$/.test(value('NEXT_PUBLIC_OPERATOR_BIZ_NO'))) {
  failures.push('사업자등록번호 형식 오류');
}
if (value('NEXT_PUBLIC_OPERATOR_EMAIL') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('NEXT_PUBLIC_OPERATOR_EMAIL'))) {
  failures.push('문의 이메일 형식 오류');
}
if (value('NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT') !== 'true') warnings.push('기존 회원 약관 재동의 게이트 OFF');

for (const file of ['app/error.tsx', 'app/global-error.tsx', 'components/ClientErrorReporter.tsx']) {
  if (!existsSync(join(root, file))) failures.push(`오류 관측/복구 파일 누락: ${file}`);
}

const manifest = readFileSync(join(root, 'app/manifest.ts'), 'utf8');
if (!manifest.includes("display: 'standalone'")) failures.push('PWA standalone 설정 누락');
if (!/192x192/.test(manifest) || !/512x512/.test(manifest)) failures.push('PWA 192/512 아이콘 선언 누락');

const nextConfig = readFileSync(join(root, 'next.config.mjs'), 'utf8');
for (const header of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
  if (!nextConfig.includes(header)) failures.push(`보안 응답 헤더 누락: ${header}`);
}

for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const failure of failures) console.error(`FAIL ${failure}`);
if (failures.length) process.exit(1);
console.log(`PASS — app release gate (legal, Firebase client, recovery, PWA, security headers); warnings ${warnings.length}`);
