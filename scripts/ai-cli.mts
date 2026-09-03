/**
 * 클로드·코덱스·제미나이 CLI를 비대화형으로 부른다. 채팅창 연동이 아니라 **이 PC에 로그인된 CLI**.
 *
 *   npm run ai:ping
 *   npx tsx scripts/ai-cli.mts claude "오더"
 *   npx tsx scripts/ai-cli.mts codex "오더"
 *   npx tsx scripts/ai-cli.mts gemini "오더"
 *   npx tsx scripts/ai-cli.mts all "오더"
 *
 * 기본 = 읽기 전용(파일·시트 안 고침). `--write` 가 있어도 차종마스터·mf- 키·v3·rules 는 넘기지 마라.
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WHO = ['claude', 'codex', 'gemini'] as const;
type Who = (typeof WHO)[number];
const PING = 'Reply with only the word PONG. Do not use tools. Do not explain.';
const PREAMBLE = [
  'Repo C:\\dev\\freepasserp4. You may run read-only commands. Do not edit files. Do not write Google Sheets.',
  'Do not touch 차종마스터, mf- keys, database.rules.json, or v3 RTDB nodes.',
  'Answer in Korean unless the order is a ping.',
].join(' ');

const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const has = (k: string) => process.argv.includes(`--${k}`);
const WRITE = has('write');
const RUN = WRITE || has('run');
const TIMEOUT = Number(arg('timeout', '180000')) || 180_000;

const rest = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cmd = (rest[0] || '').toLowerCase();
const fileArg = arg('file');
const prompt = (fileArg && existsSync(fileArg) ? readFileSync(fileArg, 'utf8') : rest.slice(1).join(' ')).trim();

const NPM = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'npm', 'node_modules')
  : '';
const CODEX_JS = path.join(NPM, '@openai', 'codex', 'bin', 'codex.js');
const GEMINI_JS = path.join(NPM, '@google', 'gemini-cli', 'bundle', 'gemini.js');

function resolveClaude(): string {
  try {
    const lines = execSync('where.exe claude', { encoding: 'utf8' })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const exe = lines.find((l) => /\.exe$/i.test(l));
    if (exe && existsSync(exe)) return exe;
  } catch { /* PATH */ }
  return 'claude';
}

function spec(who: Who, order: string): { bin: string; args: string[]; stdin: string } {
  if (who === 'claude') {
    return {
      bin: resolveClaude(),
      args: ['-p', order, '--output-format', 'text', '--permission-mode', WRITE ? 'acceptEdits' : RUN ? 'dontAsk' : 'plan'],
      stdin: '',
    };
  }
  if (who === 'codex') {
    if (!existsSync(CODEX_JS)) throw new Error(`codex.js 없음: ${CODEX_JS}`);
    return {
      bin: process.execPath,
      args: [CODEX_JS, 'exec', '-C', ROOT, '-s', WRITE ? 'workspace-write' : 'read-only', '--skip-git-repo-check', '-'],
      stdin: order,
    };
  }
  if (!existsSync(GEMINI_JS)) throw new Error(`gemini.js 없음: ${GEMINI_JS}`);
  return {
    bin: process.execPath,
    args: [GEMINI_JS, '-p', order, '--skip-trust', '--approval-mode', WRITE ? 'auto_edit' : RUN ? 'yolo' : 'plan'],
    stdin: '',
  };
}

function run(who: Who, text: string, timeoutMs: number): Promise<{ who: Who; ok: boolean; ms: number; out: string; err: string }> {
  const order = `${PREAMBLE}\n\nOrder:\n${text}`;
  let bin = '';
  let args: string[] = [];
  let stdin = '';
  try {
    ({ bin, args, stdin } = spec(who, order));
  } catch (e) {
    return Promise.resolve({ who, ok: false, ms: 0, out: '', err: String((e as Error).message) });
  }
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (stdin) {
      child.stdin?.write(stdin);
    }
    child.stdin?.end();
    let out = '';
    let err = '';
    let timedOut = false;
    child.stdout?.on('data', (b) => { out += String(b); });
    child.stderr?.on('data', (b) => { err += String(b); });
    const kill = () => {
      timedOut = true;
      if (child.pid && process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else if (child.pid) {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(kill, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        who,
        ok: !timedOut && code === 0,
        ms: Date.now() - t0,
        out: out.trim(),
        err: timedOut ? (err.trim() || `timeout ${timeoutMs}ms`) : err.trim(),
      });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ who, ok: false, ms: Date.now() - t0, out: '', err: String(e.message) });
    });
  });
}

function printOne(r: { who: Who; ok: boolean; ms: number; out: string; err: string }) {
  const tag = r.ok ? 'ok' : 'FAIL';
  console.log(`\n=== ${r.who} (${tag}, ${(r.ms / 1000).toFixed(1)}s) ===`);
  if (r.out) console.log(r.out);
  if (!r.ok && r.err) console.error(r.err.slice(0, 1200));
}

function usage(): never {
  console.error('usage: npx tsx scripts/ai-cli.mts ping | claude|codex|gemini|all <prompt> [--file=path] [--timeout=180000] [--run] [--write]');
  process.exit(2);
}

const targets: Who[] = cmd === 'ping' || cmd === 'all'
  ? [...WHO]
  : WHO.includes(cmd as Who) ? [cmd as Who] : [];
if (!targets.length) usage();
if (cmd !== 'ping' && !prompt) usage();

const text = cmd === 'ping' ? PING : prompt;
const results = await Promise.all(targets.map((w) => run(w, text, TIMEOUT)));
for (const r of results) printOne(r);

if (cmd === 'ping') {
  const miss = results.filter((r) => !r.ok || !/pong/i.test(r.out));
  if (miss.length) {
    console.error(`\n게이트 실패: ${miss.map((m) => m.who).join(', ')} 가 PONG 을 안 냈다`);
    process.exit(1);
  }
  console.log('\n게이트 ok — claude · codex · gemini CLI 연동');
  process.exit(0);
}

if (results.some((r) => !r.ok)) process.exit(1);
