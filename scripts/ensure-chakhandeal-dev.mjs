/**
 * 프리패스 로컬 개발 시 착한거래 embed(:3000)도 같이 띄운다.
 * 이미 떠 있으면 그대로 두고, 없으면 ../chakhandeal 에서 next dev 를 백그라운드로 켠다.
 *
 * Windows: `detached + unref` 만 쓰면 npm 자식이 부모 종료와 함께 죽는다.
 * → `cmd /c start` 로 콘솔 세션을 분리한다.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHAK = process.env.CHAKHANDEAL_DIR || path.resolve(ROOT, '../chakhandeal');
const PORT = Number(process.env.CHAKHANDEAL_DEV_PORT || 3000);

function listening(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
  });
}

function startChakhandeal() {
  if (process.platform === 'win32') {
    // start 가 새 프로세스 트리를 만들고 ensure 스크립트 종료와 무관하게 유지한다.
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', 'chakhandeal-dev', '/MIN', 'npm.cmd', 'run', 'dev', '--', '-p', String(PORT)],
      { cwd: CHAK, detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    return;
  }
  const child = spawn('npm', ['run', 'dev', '--', '-p', String(PORT)], {
    cwd: CHAK,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function main() {
  if (await listening(PORT)) {
    console.log(`[dev] 착한거래 embed 이미 :${PORT}`);
    return;
  }
  if (!existsSync(path.join(CHAK, 'package.json'))) {
    console.warn(`[dev] 착한거래 저장소 없음 — embed 생략 (${CHAK})`);
    return;
  }
  console.log(`[dev] 착한거래 embed 기동 → ${CHAK} :${PORT}`);
  startChakhandeal();
  // Ready 대기(최대 ~20s). 실패해도 프리패스 기동은 막지 않는다.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await listening(PORT)) {
      console.log(`[dev] 착한거래 embed Ready :${PORT}`);
      return;
    }
  }
  console.warn(`[dev] 착한거래 :${PORT} 아직 안 열림 — 계약서관리 새로고침 전에 한번 더 확인`);
}

main().catch((err) => {
  console.warn('[dev] 착한거래 기동 실패 — 프리패스만 계속', err instanceof Error ? err.message : err);
});
