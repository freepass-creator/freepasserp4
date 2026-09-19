/**
 * 운영 강제 배포 + 실제 운영 SHA 검증.
 *
 * 기본:
 *   npm run deploy:prod
 *
 * 운영 확인만:
 *   npm run deploy:verify
 *
 * 커스텀 도메인 alias가 최신 배포를 못 따라올 때만:
 *   npm run deploy:prod -- --repair-alias
 *
 * 원칙:
 * - Git main 머지 성공 != 운영 반영 성공.
 * - Vercel deployment READY != custom domain이 그 deployment를 서빙한다는 뜻.
 * - /api/version.sha가 현재 main SHA와 같을 때만 "운영 배포 완료".
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const verifyOnly = args.has('--verify-only');
const repairAlias = args.has('--repair-alias');
const once = args.has('--once');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(cmd: string, argv: string[], opts: { quiet?: boolean } = {}): string {
  try {
    return execFileSync(cmd, argv, {
      encoding: 'utf8',
      stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: process.env,
    }).trim();
  } catch (error: any) {
    const out = String(error?.stdout || '').trim();
    const err = String(error?.stderr || '').trim();
    if (out) console.error(out);
    if (err) console.error(err);
    throw error;
  }
}

function git(...argv: string[]): string {
  return run('git', argv, { quiet: true });
}

function vercel(...argv: string[]): string {
  const token = String(process.env.VERCEL_TOKEN || '').trim();
  const withAuth = token && !argv.includes('--token') ? [...argv, '--token', token] : argv;
  return run(npx, ['vercel', ...withAuth], { quiet: true });
}

function currentBranch(): string {
  return git('rev-parse', '--abbrev-ref', 'HEAD');
}

function shortSha(ref = 'HEAD'): string {
  return git('rev-parse', '--short=7', ref);
}

function ensureReleasePreflight() {
  const dirty = git('status', '--porcelain');
  if (dirty) throw new Error('작업트리가 깨끗하지 않습니다. 운영 배포 전에 commit/stash 하세요.');

  const branch = currentBranch();
  if (branch !== 'main') throw new Error(`운영 배포는 main에서만 합니다. 현재: ${branch}`);

  try { git('fetch', 'origin', 'main'); } catch {
    throw new Error('origin/main을 갱신하지 못했습니다. 네트워크/GitHub 연결을 확인하세요.');
  }

  const head = git('rev-parse', 'HEAD');
  const remote = git('rev-parse', 'origin/main');
  if (head !== remote) {
    throw new Error(`HEAD와 origin/main이 다릅니다. HEAD=${head.slice(0,7)} origin/main=${remote.slice(0,7)}`);
  }

  if (!existsSync('.vercel/project.json')) {
    throw new Error(
      'Vercel 프로젝트 링크가 없습니다. 먼저: npx vercel link --yes --project freepasserp4 --scope freepass-projects'
    );
  }

  const link = JSON.parse(readFileSync('.vercel/project.json', 'utf8')) as { projectId?: string; orgId?: string };
  if (!link.projectId || !link.orgId) throw new Error('.vercel/project.json에 projectId/orgId가 없습니다.');

  console.log(`\n배포 대상 main ${shortSha()} · project ${link.projectId} · org ${link.orgId}`);
}

function deploymentUrlFrom(text: string): string {
  const urls = text.match(/https:\/\/[^\s]+\.vercel\.app/g) || [];
  return urls.at(-1) || '';
}

type LiveResult = { base: string; ok: boolean; liveSha: string; expectedSha: string; error?: string };

async function readLiveSha(base: string, expectedSha: string): Promise<LiveResult> {
  const url = `${base.replace(/\/$/, '')}/api/version?t=${Date.now()}`;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
      redirect: 'follow',
    });
    if (!res.ok) return { base, ok: false, liveSha: '', expectedSha, error: `HTTP ${res.status}` };
    const body = await res.json() as { sha?: string };
    const liveSha = String(body?.sha || '').slice(0, 7);
    return { base, ok: liveSha === expectedSha, liveSha, expectedSha };
  } catch (e: any) {
    return { base, ok: false, liveSha: '', expectedSha, error: String(e?.message || e) };
  }
}

function liveBases(): string[] {
  const raw = process.env.FP_LIVE_URLS || 'https://freepasserp.com,https://www.freepasserp.com';
  return raw.split(',').map(v => v.trim()).filter(Boolean);
}

async function verifyLive(expectedSha: string, attempts = 12, delayMs = 5000): Promise<boolean> {
  const bases = liveBases();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const rows = await Promise.all(bases.map(base => readLiveSha(base, expectedSha)));
    console.log(`\n운영 SHA 확인 ${attempt}/${attempts}`);
    for (const r of rows) {
      console.log(
        `  ${r.base.padEnd(32)} ${r.ok ? '✅' : '·'} live=${r.liveSha || '-'} expected=${expectedSha}${r.error ? ` · ${r.error}` : ''}`
      );
    }
    if (rows.every(r => r.ok)) return true;
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

async function main() {
  const expectedSha = shortSha('HEAD');

  if (verifyOnly) {
    const ok = await verifyLive(expectedSha, once ? 1 : 12, once ? 0 : 5000);
    if (!ok) process.exitCode = 1;
    return;
  }

  ensureReleasePreflight();

  console.log('\n1/4 Vercel production 환경 동기화');
  vercel('pull', '--yes', '--environment=production');

  console.log('2/4 production artifact 빌드');
  vercel('build', '--prod');

  console.log('3/4 prebuilt artifact를 production으로 강제 배포');
  const deployOutput = vercel('deploy', '--prebuilt', '--prod', '--yes');
  const deploymentUrl = deploymentUrlFrom(deployOutput);
  console.log(deployOutput);
  if (deploymentUrl) console.log(`deployment: ${deploymentUrl}`);

  console.log('4/4 custom domain이 실제로 같은 SHA를 서빙하는지 확인');
  let ok = await verifyLive(expectedSha);

  if (!ok && repairAlias) {
    if (!deploymentUrl) throw new Error('배포 URL을 찾지 못해 alias 복구를 실행할 수 없습니다.');
    console.log('\ncustom domain alias 복구를 명시적으로 실행합니다.');
    for (const host of ['freepasserp.com', 'www.freepasserp.com']) {
      console.log(`  alias → ${host}`);
      vercel('alias', 'set', deploymentUrl, host);
    }
    ok = await verifyLive(expectedSha);
  }

  if (!ok) {
    console.error('\n⛔ artifact 배포와 실제 운영 도메인 반영이 일치하지 않습니다.');
    console.error('다음 순서로 진단하세요:');
    if (deploymentUrl) console.error(`  npx vercel inspect ${deploymentUrl}`);
    console.error('  npx vercel alias ls');
    console.error('  npx vercel ls freepasserp4');
    console.error('  npm run deploy:verify');
    console.error('도메인 alias/DNS가 다른 프로젝트를 가리키면 재빌드만 반복해도 해결되지 않습니다.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n✅ 운영 배포 완료 — freepasserp.com이 main ${expectedSha}를 서빙합니다.\n`);
}

main().catch((error) => {
  console.error('\n배포 실패:', error instanceof Error ? error.message : error);
  process.exit(1);
});
