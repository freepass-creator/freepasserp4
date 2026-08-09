/**
 * Vercel 환경변수 대조기 — 「어느 환경에 무엇이 빠졌는가」를 한 번에 본다.
 *
 *   tsx scripts/deploy/vercel-env.mts diff     환경별 키 차이 + 로컬과 값 일치 여부
 *   tsx scripts/deploy/vercel-env.mts pull     .env.local 을 development 기준으로 갱신
 *
 * ★ 값은 절대 출력하지 않는다
 *   여기 걸리는 것 대부분이 비밀키다. 화면에 찍는 순간 스크롤·로그·캡처로 샌다.
 *   그래서 「같다/다르다/없다」만 말하고 값은 길이조차 보여 주지 않는다.
 *
 * ★ 왜 Production 만 보면 안 되나
 *   Preview 에 없는 변수는 프리뷰 배포에서 조용히 undefined 가 된다. 그러면 프리뷰로
 *   확인한 결과가 프로덕션과 달라지고, **검증이 사고를 못 잡는다**. 그 격차를 드러내는 게
 *   이 스크립트의 존재 이유다.
 */
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { argv } from './_ctx.mts';

const TARGETS = ['production', 'preview', 'development'] as const;
type Target = (typeof TARGETS)[number];
const WORK_DIR = 'tmp/deploy/env';

/** 로컬 전용이라 Vercel 에 없는 게 정상인 키 — 없다고 경고하면 매번 거짓 경보가 된다. */
const LOCAL_ONLY = new Set([
  // 서버리스에는 파일이 없다. 그래서 배포본은 같은 자격증명을 FIREBASE_SERVICE_ACCOUNT_JSON 로 받는다.
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

function vercel(args: string[]): string {
  return execFileSync('npx', ['vercel', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
}

/** dotenv 최소 파서 — 키와 값만 가른다. 따옴표는 벗긴다. */
function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

function pullTo(target: Target, file: string): Map<string, string> {
  if (existsSync(file)) rmSync(file);
  vercel(['env', 'pull', file, `--environment=${target}`, '--yes']);
  return parseEnv(readFileSync(file, 'utf8'));
}

async function main() {
  const { cmd } = argv();
  mkdirSync(WORK_DIR, { recursive: true });

  if (cmd === 'pull') {
    vercel(['env', 'pull', '.env.local', '--environment=development', '--yes']);
    console.log('\n  .env.local 갱신 완료 (development 기준)\n');
    return;
  }

  if (cmd !== 'diff') {
    console.log(`
  사용법
    npm run env:diff     환경별 키 차이 + 로컬 값 일치 여부 (값은 출력 안 함)
    npm run env:pull     .env.local 갱신
`);
    return;
  }

  const byTarget = new Map<Target, Map<string, string>>();
  for (const target of TARGETS) {
    process.stdout.write(`  ${target} 읽는 중…\r`);
    byTarget.set(target, pullTo(target, join(WORK_DIR, `.env.${target}`)));
  }
  const local = existsSync('.env.local') ? parseEnv(readFileSync('.env.local', 'utf8')) : new Map<string, string>();

  const allKeys = [...new Set(TARGETS.flatMap((t) => [...byTarget.get(t)!.keys()]).concat([...local.keys()]))].sort();

  console.log(`\n  키 ${allKeys.length}개 · ${TARGETS.map((t) => `${t} ${byTarget.get(t)!.size}`).join(' · ')} · 로컬 ${local.size}\n`);

  const head = `  ${'키'.padEnd(42)}${'prod'.padEnd(7)}${'prev'.padEnd(7)}${'dev'.padEnd(7)}로컬`;
  console.log(head);
  console.log(`  ${'─'.repeat(head.length)}`);

  const gaps: string[] = [];
  for (const key of allKeys) {
    const mark = (t: Target) => (byTarget.get(t)!.has(key) ? '  ✔  ' : '  ·  ');
    const inLocal = local.has(key);
    const prodValue = byTarget.get('production')!.get(key);
    // 값 자체는 절대 찍지 않는다. 로컬과 프로덕션이 갈라졌는지만 말한다.
    const localMark = !inLocal ? '  ·  ' : prodValue !== undefined && prodValue !== local.get(key) ? ' ≠prod' : '  ✔  ';
    console.log(`  ${key.padEnd(42)}${mark('production')}${mark('preview')}${mark('development')}${localMark}`);
    if (byTarget.get('production')!.has(key) && !byTarget.get('preview')!.has(key)) {
      gaps.push(key);
    }
  }

  if (gaps.length) {
    console.log(`\n  ⚠ Production 에만 있고 Preview 에 없는 키 ${gaps.length}개`);
    console.log('    프리뷰 배포에서 이 값들은 undefined 다 — 프리뷰로 한 확인이 프로덕션과 달라진다.');
    for (const key of gaps) console.log(`      ${key}`);
  }

  const missingLocal = allKeys.filter((key) => byTarget.get('development')!.has(key) && !local.has(key));
  if (missingLocal.length) {
    console.log(`\n  ⚠ development 에 있는데 .env.local 에 없는 키 ${missingLocal.length}개 — npm run env:pull`);
    for (const key of missingLocal) console.log(`      ${key}`);
  }

  const orphan = [...local.keys()].filter((key) => !LOCAL_ONLY.has(key) && !TARGETS.some((t) => byTarget.get(t)!.has(key)));
  if (orphan.length) {
    console.log(`\n  ⚠ 로컬에만 있는 키 ${orphan.length}개 — 배포본에는 없다`);
    for (const key of orphan) console.log(`      ${key}`);
  }

  console.log();
}

main().catch((error) => { console.error(error); process.exit(1); });
