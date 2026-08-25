/**
 * 정제 완료본을 읽어 판매 3탭 → 영업채널 카드(천이) → ERP를 순서대로 반영한다.
 * 원본·정제시트·차종마스터에는 절대 쓰지 않는다. 한 단계라도 실패하면 ERP는 실행하지 않는다.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force-shrink');
const A = APPLY ? ['--apply'] : [];
const started = Date.now();
const report: string[] = [];
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function run(label: string, args: string[]) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', ...args], {
      encoding: 'utf8', shell: process.platform === 'win32', env: process.env, maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    report.push(`${label} ${result.status === 0 ? 'OK' : 'FAIL'} (시도 ${attempt})`, ...output.split(/\r?\n/).filter(Boolean).slice(-30));
    console.log(`■ ${label}: ${result.status === 0 ? 'OK' : 'FAIL'}${attempt > 1 ? ` (${attempt}회)` : ''}`);
    if (result.status === 0) return;
    if (!/\b429\b|rate.?limit|quota/i.test(output) || attempt === 3) throw new Error(`${label} 실패`);
    console.log('  Google API 요청 한도 — 30초 후 재시도');
    await wait(30_000);
  }
}

try {
  // 판매 탭은 정제시트를 읽기만 한다. 각각 성공해야 다음 탭으로 진행한다.
  await run('상품리스트 발행', ['scripts/publish-origin-tab.mts', ...A, ...(FORCE ? ['--force-shrink'] : [])]);
  await run('손오공구독 발행', ['scripts/publish-origin-tab.mts', '--only=RP012:구독', '--tab=손오공구독', '--at=1', ...A, ...(FORCE ? ['--force-shrink'] : [])]);
  await run('손오공 인수형 블록', ['scripts/publish-sonogong-tab.mts', ...A]);
  await run('오플구독 발행', ['scripts/publish-origin-tab.mts', '--only=RP023', '--tab=오플구독', '--at=2', ...A, ...(FORCE ? ['--force-shrink'] : [])]);
  await run('오플 요금 블록', ['scripts/publish-sonogong-tab.mts', '--tab=오플구독', ...A]);
  await run('영업채널 카드(천이) 발행', ['scripts/publish-channel-cards.mts', ...A]);
  if (APPLY) {
    await run('판매·천이시트 되읽기', ['scripts/audit-pipeline-destinations.mts']);
    await run('ERP 동기·정합성 대조', ['scripts/hourly-sync.mts', '--apply']);
  }
  console.log(`■ 완료 ${Math.round((Date.now() - started) / 1000)}초`);
} catch (error) {
  console.error(`⛔ 중단: ${(error as Error).message} — ERP는 실행하지 않았거나 실패로 종료했습니다.`);
  process.exitCode = 1;
} finally {
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/sales-erp-hourly-last.txt', report.join('\n'));
}
