/**
 * Hourly, read-only integrity monitor for the Google Sheet vehicle master SSOT.
 *
 * It never updates Google Sheets, the local artifact, supplier sheets, or product data.
 * It only runs existing audits and appends a privacy-minimized local history.
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type Rec = Record<string, any>;
type CommandResult = {
  id: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  summary: string;
};

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultHistoryRoot = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'FreepassERP4', 'vehicle-master-audit')
  : join(repo, 'tmp', 'vehicle-master-audit');
const historyRoot = resolve(process.env.VEHICLE_MASTER_AUDIT_DIR || defaultHistoryRoot);
const historyPath = join(historyRoot, 'history.jsonl');
const latestPath = join(historyRoot, 'LATEST.md');
const lockPath = join(historyRoot, 'monitor.lock');
const downstreamPath = join(repo, 'tmp', 'refine-vs-master.json');
const now = new Date();
const startedAt = now.toISOString();
const runId = createHash('sha256').update(`${startedAt}|${process.pid}|${Math.random()}`).digest('hex').slice(0, 20);

mkdirSync(historyRoot, { recursive: true });

// Task Scheduler can start a new run while a slow Drive audit is still running.
// A two-hour-old lock whose process is gone is stale; otherwise this run is safely skipped.
if (existsSync(lockPath)) {
  const ageMs = Date.now() - statSync(lockPath).mtimeMs;
  let owner: Rec = {};
  try { owner = JSON.parse(readFileSync(lockPath, 'utf8')) as Rec; } catch { /* legacy/corrupt lock */ }
  let ownerAlive = false;
  if (owner.host === hostname() && Number.isInteger(owner.pid)) {
    try { process.kill(Number(owner.pid), 0); ownerAlive = true; } catch { /* process is gone */ }
  }
  if (ageMs < 2 * 60 * 60 * 1000 || ownerAlive) {
    appendFileSync(historyPath, `${JSON.stringify({
      checkedAt: startedAt,
      status: 'SKIPPED',
      reason: 'previous_run_still_active',
    })}\n`, 'utf8');
    console.log('SKIPPED — 이전 차종마스터 검사가 아직 실행 중입니다.');
    process.exit(0);
  }
  unlinkSync(lockPath);
}
const lockFd = openSync(lockPath, 'wx');
writeFileSync(lockFd, JSON.stringify({ runId, pid: process.pid, host: hostname(), startedAt }), 'utf8');

function classifyOutput(text: string): string {
  if (/REGISTERED_SEMANTIC_DRIFT|차량 의미가 바뀌었습니다/.test(text)) return '영구키 의미 변경 감지';
  if (/행키 영구계약 위반/.test(text)) return '영구키 계약 위반으로 산출물 대조 차단';
  if (/401|unauthorized|인증/i.test(text)) return 'Google 인증 실패';
  if (/403|permission|권한/i.test(text)) return 'Google 접근 권한 실패';
  if (/timeout|timed out/i.test(text)) return '검사 제한시간 초과';
  return text.trim() ? '검사 명령 실패(상세 원문은 개인정보 보호를 위해 미기록)' : '';
}

function run(id: string, args: string[]): CommandResult {
  const began = Date.now();
  const result = spawnSync(process.execPath, [join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
    windowsHide: true,
    env: process.env,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return {
    id,
    ok: result.status === 0 && !result.error,
    exitCode: result.status,
    durationMs: Date.now() - began,
    summary: result.status === 0 && !result.error ? '' : classifyOutput(`${result.error?.message || ''}\n${output}`),
  };
}

function issueFingerprint(issue: Rec): string {
  return createHash('sha256')
    .update([issue.supplier, issue.plate, issue.kind, issue.detail].map((v) => String(v ?? '')).join('|'))
    .digest('hex')
    .slice(0, 16);
}

function countBy(items: Rec[], field: string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = String(item[field] || '미분류');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function previousEntry(): Rec | null {
  if (!existsSync(historyPath)) return null;
  const lines = readFileSync(historyPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const parsed = JSON.parse(lines[index]) as Rec;
      if (parsed.status !== 'SKIPPED') return parsed;
    } catch { /* malformed historical line does not block a new audit */ }
  }
  return null;
}

try {
  const checks = [
    run('permanent_key_contract', ['scripts/audit-vehicle-trim-key-contract.mts']),
    run('sheet_to_artifact_drift', ['scripts/generate-vehicle-trim-master.mts', '--check']),
    run('downstream_supplier_consistency', ['scripts/audit-refine-vs-master.mts']),
  ];

  let downstream: Rec = { cars: 0, named: 0, blankCore: 0, issues: [] };
  try {
    if (existsSync(downstreamPath)) downstream = JSON.parse(readFileSync(downstreamPath, 'utf8')) as Rec;
  } catch (error) {
    checks[2] = { ...checks[2], ok: false, summary: `감사 결과 JSON 해석 실패: ${String((error as Error).message || error)}` };
  }

  const issues = Array.isArray(downstream.issues) ? downstream.issues as Rec[] : [];
  const fingerprints = issues.map(issueFingerprint).sort();
  const previous = previousEntry();
  const previousFingerprints = new Set<string>(previous?.downstream?.issueFingerprints || []);
  const currentFingerprints = new Set(fingerprints);
  const added = fingerprints.filter((value) => !previousFingerprints.has(value));
  const resolved = [...previousFingerprints].filter((value) => !currentFingerprints.has(value));
  const criticalFailed = checks.some((check) => !check.ok);
  const status = criticalFailed ? 'FAIL' : issues.length ? 'WARN' : 'PASS';

  const entry = {
    checkedAt: startedAt,
    finishedAt: new Date().toISOString(),
    status,
    ssot: {
      spreadsheetId: '1oMB9eoNnQFxUyRK4CSxYh_hKrtCf7s_79xLs-GYwXCE',
      tabs: ['안내', '차종마스터', '세부모델', '배터리근거'],
      artifact: 'public/data/vehicle-trim-master.json',
    },
    checks,
    downstream: {
      cars: Number(downstream.cars || 0),
      named: Number(downstream.named || 0),
      blankCore: Number(downstream.blankCore || 0),
      issueCount: issues.length,
      byKind: countBy(issues, 'kind'),
      byUsageFingerprint: countBy(issues.map((issue) => ({
        usage: createHash('sha256').update(String(issue.supplier || '미분류')).digest('hex').slice(0, 12),
      })), 'usage'),
      issueFingerprints: fingerprints,
    },
    changeFromPrevious: {
      addedIssueCount: added.length,
      resolvedIssueCount: resolved.length,
      addedIssueFingerprints: added,
      resolvedIssueFingerprints: resolved,
    },
    action: criticalFailed
      ? '자동 수정 없음 — 실패한 검사를 사람이 확인해야 함'
      : issues.length
        ? '자동 수정 없음 — 종류·사용처별 불일치를 이력화함'
        : resolved.length
          ? `외부 수정 반영 감지 — 이전 불일치 ${resolved.length}건 해소`
          : '조치 불필요',
    privacy: '차량번호와 원문 행은 저장하지 않고 16자리 비가역 지문과 집계만 보관',
  };

  appendFileSync(historyPath, `${JSON.stringify(entry)}\n`, 'utf8');
  const checkLines = checks.map((check) => `- ${check.ok ? 'PASS' : 'FAIL'} · ${check.id} · ${Math.round(check.durationMs / 1000)}초${check.summary ? `\n  - ${check.summary}` : ''}`);
  const kindLines = Object.entries(entry.downstream.byKind).map(([kind, count]) => `- ${kind}: ${count}건`);
  writeFileSync(latestPath, `# 차종마스터 정합성 최근 검사\n\n- 검사 시각: ${entry.checkedAt}\n- 결과: **${status}**\n- 원자 적용 대상: ${entry.downstream.cars}대\n- 핵심칸 누락: ${entry.downstream.blankCore}대\n- 불일치: ${entry.downstream.issueCount}건\n- 전회 대비: 신규 ${added.length}건 · 해소 ${resolved.length}건\n- 조치: ${entry.action}\n\n## 검사\n\n${checkLines.join('\n')}\n\n## 불일치 종류\n\n${kindLines.length ? kindLines.join('\n') : '- 없음'}\n\n> 차량번호·원문 행은 이력 파일에 저장하지 않습니다. 자동 수정도 수행하지 않습니다.\n`, 'utf8');

  console.log(`${status} — 차종마스터 검사 · 불일치 ${issues.length} · 신규 ${added.length} · 해소 ${resolved.length}`);
  console.log(`이력: ${historyPath}`);
  if (criticalFailed) process.exitCode = 1;
} finally {
  closeSync(lockFd);
  if (existsSync(lockPath)) {
    try {
      const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as Rec;
      if (owner.runId === runId) unlinkSync(lockPath);
    } catch { /* do not remove a lock we cannot prove we own */ }
  }
}
