/**
 * 중앙 작업 lease.
 *
 * 같은 PC의 여러 AI/터미널이 동시에 실행될 때, Google Sheet·Drive의 실제 쓰기를
 * 한 번에 한 작업만 통과시키는 원자적 파일시스템 잠금이다. Google Sheet 행을
 * read → write 하는 방식은 compare-and-swap이 아니므로 mutex로 쓰지 않는다.
 *
 * 외부 쓰기는 lib/goog.mjs가 이 모듈의 토큰을 확인한다. 따라서 반드시
 * scripts/with-lease.mjs 또는 withLease() 안에서 실행해야 한다.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const context = new AsyncLocalStorage();
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 45 * 1000;
const AGENTS = new Set(['codex', 'claude', 'cursor', 'gemini']);
const TASK_ID = /^(?:OPS|TEST)-\d{8}-\d{3}(?:-[a-z0-9][a-z0-9-]{0,31})?$/i;

export class LeaseBusyError extends Error {
  constructor(target, owner) {
    super(`자원 「${target}」은 ${owner.agent}/${owner.taskId} 작업이 보유 중입니다. (${owner.purpose})`);
    this.name = 'LeaseBusyError';
    this.target = target;
    this.owner = owner;
  }
}

export class LeaseLostError extends Error {
  constructor(target) {
    super(`자원 「${target}」 lease를 잃었습니다. 라이브 변경을 중단하고 원본을 다시 확인하세요.`);
    this.name = 'LeaseLostError';
    this.target = target;
  }
}

function projectRoot() {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const gitDir = resolve(process.cwd(), common);
    return basename(gitDir).toLowerCase() === '.git' ? dirname(gitDir) : dirname(gitDir);
  } catch {
    return resolve(fileURLToPath(new URL('..', import.meta.url)));
  }
}

/** 모든 worktree가 공유할 제어 디렉터리. 다른 PC/클라우드 실행에는 단일 writer를 유지해야 한다. */
export function coordinationDir() {
  return process.env.AIOPS_COORDINATION_DIR
    ? resolve(process.env.AIOPS_COORDINATION_DIR)
    : join(projectRoot(), '.coordination');
}

function safeText(value, label, max = 160) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /[\r\n\0]/.test(text)) throw new Error(`${label}은 한 줄 ${max}자 이하여야 합니다.`);
  return text;
}

export function normalizeAgent(agent) {
  const value = safeText(agent, 'agent', 24).toLowerCase();
  if (!AGENTS.has(value)) throw new Error(`알 수 없는 agent: ${agent}`);
  return value;
}

export function normalizeTaskId(taskId) {
  const value = safeText(taskId, 'taskId', 64).toUpperCase();
  if (!TASK_ID.test(value)) throw new Error(`taskId 형식은 OPS-YYYYMMDD-001 이어야 합니다: ${taskId}`);
  return value;
}

/** 리소스 키에는 개인정보가 아닌 시스템 식별자만 쓴다. 예: sheet:<spreadsheetId>, drive */
export function normalizeTarget(target) {
  const value = safeText(target, 'resource', 300).replaceAll('\\', '/');
  if (value === 'drive') return value;
  if (!/^[a-z][a-z0-9_-]*:[a-z0-9._~:/@=+-]+$/i.test(value)) {
    throw new Error(`resource 형식이 잘못되었습니다: ${target}`);
  }
  return value.toLowerCase().startsWith('sheet:') ? `sheet:${value.slice(6)}` : value;
}

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function leasePath(root, target) { return join(root, 'leases', hash(target)); }
function ownerPath(path) { return join(path, 'owner.json'); }
function iso(now = Date.now()) { return new Date(now).toISOString(); }

async function ensureControlDirs(root) {
  await Promise.all([
    mkdir(join(root, 'leases'), { recursive: true }),
    mkdir(join(root, 'stale-leases'), { recursive: true }),
    mkdir(join(root, 'tasks'), { recursive: true }),
  ]);
}

async function readOwner(path) {
  try {
    const [raw, info] = await Promise.all([readFile(ownerPath(path), 'utf8'), stat(path)]);
    return { owner: JSON.parse(raw), mtimeMs: info.mtimeMs };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    // 부분 기록 또는 비정상 종료는 보수적으로 잠금으로 취급한다.
    try {
      const info = await stat(path);
      return { owner: null, mtimeMs: info.mtimeMs, unreadable: true };
    } catch (statError) {
      if (statError?.code === 'ENOENT') return null;
      throw statError;
    }
  }
}

function expired(snapshot, now = Date.now()) {
  if (!snapshot) return false;
  const heartbeat = Date.parse(snapshot.owner?.heartbeatAt || snapshot.owner?.acquiredAt || '') || snapshot.mtimeMs;
  const ttl = Number(snapshot.owner?.ttlMs) || DEFAULT_TTL_MS;
  return now - heartbeat > ttl;
}

async function archiveStale(root, path, target) {
  const archive = join(root, 'stale-leases', `${hash(target)}-${Date.now()}-${randomUUID()}`);
  try {
    await rename(path, archive); // 디렉터리 rename은 같은 볼륨에서 원자적이다.
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function makeLease({ root, target, path, owner }) {
  return {
    root, target, path, leaseId: owner.leaseId, agent: owner.agent, taskId: owner.taskId,
    ttlMs: owner.ttlMs, purpose: owner.purpose, timer: null, lost: null,
  };
}

const 잡을수있는 = ['codex', 'claude'];

/** 한 리소스를 원자적으로 확보한다. 같은 리소스는 한 프로세스만 성공한다. */
export async function acquireLease(target, { agent, taskId, purpose, ttlMs = DEFAULT_TTL_MS } = {}) {
  const normalizedTarget = normalizeTarget(target);
  const normalizedAgent = normalizeAgent(agent);
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedPurpose = safeText(purpose, 'purpose');
  // ★2026-08-25 — Claude 도 잡을 수 있게 열었다 (대표 승인, 위 leaseMatches 주석 참고)
  if ((normalizedTarget === 'drive' || normalizedTarget.startsWith('sheet:')) && !잡을수있는.includes(normalizedAgent)) {
    throw new Error(`라이브 리소스 ${normalizedTarget}는 ${잡을수있는.join('·')} 만 lease할 수 있습니다.`);
  }
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl < 60_000 || ttl > 60 * 60 * 1000) throw new Error('ttlMs는 1~60분이어야 합니다.');

  const root = coordinationDir();
  await ensureControlDirs(root);
  const path = leasePath(root, normalizedTarget);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const acquiredAt = Date.now();
    const owner = {
      version: 1, leaseId: randomUUID(), target: normalizedTarget,
      agent: normalizedAgent, taskId: normalizedTaskId, purpose: normalizedPurpose,
      host: os.hostname(), pid: process.pid, acquiredAt: iso(acquiredAt), heartbeatAt: iso(acquiredAt),
      ttlMs: ttl, expiresAt: iso(acquiredAt + ttl),
    };
    try {
      await mkdir(path); // recursive=false 기본값: 이 호출이 mutex의 원자적 핵심이다.
      await writeFile(ownerPath(path), JSON.stringify(owner, null, 2), { encoding: 'utf8', flag: 'wx' });
      return makeLease({ root, target: normalizedTarget, path, owner });
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        // owner.json 기록 실패 시 다음 실행이 영구히 막히지 않도록 비어 있는 디렉터리만 회수한다.
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const snapshot = await readOwner(path);
      if (!snapshot) continue;
      if (!expired(snapshot)) throw new LeaseBusyError(normalizedTarget, snapshot.owner || {
        agent: 'unknown', taskId: 'unknown', purpose: 'owner.json을 읽을 수 없음',
      });
      await archiveStale(root, path, normalizedTarget);
    }
  }
  throw new Error(`lease 확보 재시도 횟수를 초과했습니다: ${normalizedTarget}`);
}

/** lease 소유 여부를 확인하고 만료 시각을 연장한다. */
export async function renewLease(lease) {
  const snapshot = await readOwner(lease.path);
  if (!snapshot?.owner || snapshot.owner.leaseId !== lease.leaseId || snapshot.owner.target !== lease.target) {
    throw new LeaseLostError(lease.target);
  }
  if (expired(snapshot)) throw new LeaseLostError(lease.target);
  const now = Date.now();
  const next = { ...snapshot.owner, heartbeatAt: iso(now), expiresAt: iso(now + lease.ttlMs) };
  await writeFile(ownerPath(lease.path), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** 다른 lease로 바뀐 경우 절대 지우지 않는다. */
export async function releaseLease(lease) {
  if (!lease) return false;
  const snapshot = await readOwner(lease.path);
  if (!snapshot?.owner || snapshot.owner.leaseId !== lease.leaseId) return false;
  await rm(lease.path, { recursive: true, force: true });
  return true;
}

function startHeartbeat(lease) {
  const interval = Math.min(HEARTBEAT_MS, Math.floor(lease.ttlMs / 3));
  lease.timer = setInterval(async () => {
    try { await renewLease(lease); }
    catch (error) {
      lease.lost = error;
      clearInterval(lease.timer);
      lease.timer = null;
    }
  }, interval);
  lease.timer.unref?.();
}

function stopHeartbeat(lease) {
  if (lease?.timer) clearInterval(lease.timer);
  if (lease) lease.timer = null;
}

/** 여러 자원을 정렬된 순서로 확보해 교착 상태를 피한다. */
export async function withLease(targets, info, fn) {
  const uniqueTargets = [...new Set((Array.isArray(targets) ? targets : [targets]).map(normalizeTarget))].sort();
  if (!uniqueTargets.length) throw new Error('최소 하나의 resource가 필요합니다.');
  const leases = [];
  try {
    for (const target of uniqueTargets) {
      const lease = await acquireLease(target, info);
      startHeartbeat(lease);
      leases.push(lease);
    }
    return await context.run({ leases }, async () => {
      await appendAudit({ type: 'lease-acquired', ...publicLease(leases), purpose: safeText(info.purpose, 'purpose') });
      const result = await fn(leases);
      if (leases.some((lease) => lease.lost)) throw leases.find((lease) => lease.lost).lost;
      return result;
    });
  } finally {
    for (const lease of [...leases].reverse()) {
      stopHeartbeat(lease);
      const released = await releaseLease(lease);
      await appendAudit({ type: released ? 'lease-released' : 'lease-release-skipped', ...publicLease([lease]) });
    }
  }
}

function publicLease(leases) {
  const list = Array.isArray(leases) ? leases : [leases];
  return {
    agent: list[0]?.agent, taskId: list[0]?.taskId,
    resources: list.map((lease) => lease.target),
    leaseIds: list.map((lease) => lease.leaseId), at: iso(),
  };
}

/** 작업 wrapper가 자식 프로세스에 전달할 검증 가능한 lease 토큰. */
export function childLeaseEnv(leases) {
  const list = Array.isArray(leases) ? leases : [leases];
  return {
    AIOPS_AGENT: list[0]?.agent || '',
    AIOPS_TASK_ID: list[0]?.taskId || '',
    AIOPS_LEASES: JSON.stringify(list.map((lease) => ({
      target: lease.target, path: lease.path, leaseId: lease.leaseId,
    }))),
  };
}

function environmentLeases() {
  try {
    const parsed = JSON.parse(process.env.AIOPS_LEASES || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function activeLeases() {
  const local = context.getStore()?.leases || [];
  return [...local, ...environmentLeases()];
}

/** ★2026-08-25 — Claude 도 lease 를 잡을 수 있게 열었다 (대표 승인).
 *
 *  대표: 「시트가 왜 막혀?? **계속 쓰고 있었는데??**」
 *        「아닌데 **이거 잠겨 있으면 안 되는데**」 / 「**lease.mjs 고쳐도 된다**」
 *
 *  ── 무엇이 바뀌었나
 *  «누가 잡을 수 있나» 뿐이다. 잠금 자체는 그대로다 —
 *  두 도구가 **동시에** 같은 시트를 쓰는 것은 여전히 막히고, 잡고 푼 것은 감사 기록에 남는다.
 *
 *  ── 왜 원래 Codex 만이었나
 *  라이브 쓰기를 한 곳으로 모아 «누가 언제 무엇을 바꿨나» 를 좁히려던 것이다.
 *  그런데 실제로는 Claude 가 시트를 만들고 채우는 일이 대부분이라,
 *  Codex lease 가 만료되면 **일이 통째로 멈췄다.** 오늘 그래서 멈췄다.
 *
 *  ★열렸다고 함부로 쓰지 않는다. 오늘 인수인계 시트에서 탭 셋을 지운 적이 있다 —
 *    쓰기 전에 «무엇이 지워지나» 를 먼저 보고, 붙이는 자리는 시트를 다시 읽어 정한다.
 */


async function leaseMatches(candidate, target) {
  if (candidate.target !== target || !candidate.path || !candidate.leaseId) return false;
  const snapshot = await readOwner(candidate.path);
  return Boolean(snapshot?.owner
    && snapshot.owner.leaseId === candidate.leaseId
    && snapshot.owner.target === target
    && 잡을수있는.includes(snapshot.owner.agent)
    && !expired(snapshot));
}

/**
 * D등급 wrapper의 자식 writer가 호출한다. 새 lease를 잡지 않고, wrapper가 넘긴
 * 살아 있는 Codex lease만 확인한다. 직접 writer 실행과 중첩 lease를 모두 막는다.
 */
export async function assertInheritedCodexLease(targets) {
  const required = [...new Set((Array.isArray(targets) ? targets : [targets]).map(normalizeTarget))].sort();
  const inherited = environmentLeases();
  for (const target of required) {
    const matches = await Promise.all(inherited.map((lease) => leaseMatches(lease, target)));
    if (!matches.some(Boolean)) {
      throw new Error(`승인된 Codex ${target} inherited lease가 없습니다. scripts/with-lease.mjs로 실행하세요.`);
    }
  }
  return required;
}

export function requiredResourceForRequest(url, method = 'GET') {
  const verb = String(method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(verb)) return null;
  const parsed = new URL(String(url));
  if (parsed.hostname === 'sheets.googleapis.com') {
    // 스프레드시트 id 뒤에 :batchUpdate 같은 메서드가 붙는다 — 콜론 앞까지만 id (2026-08-20 Claude 수정)
    const match = parsed.pathname.match(/^\/v4\/spreadsheets\/([^/?:]+)/);
    return match ? `sheet:${decodeURIComponent(match[1])}` : 'sheet:create';
  }
  if (parsed.hostname === 'www.googleapis.com' && (parsed.pathname.startsWith('/drive/') || parsed.pathname.startsWith('/upload/drive/'))) {
    return 'drive';
  }
  return `external:${parsed.host}`;
}

/** lib/goog.mjs가 모든 POST/PUT/PATCH/DELETE 전에 호출한다. */
export async function assertWriteAllowedForUrl(url, method = 'GET') {
  const target = requiredResourceForRequest(url, method);
  if (!target) return null;
  const allowed = await Promise.all(activeLeases().map((lease) => leaseMatches(lease, target)));
  if (!allowed.some(Boolean)) {
    throw new Error(`라이브 쓰기 차단: Codex의 ${target} lease가 없습니다. scripts/with-lease.mjs로 승인된 작업을 실행하세요.`);
  }
  return target;
}

/** 사람이 읽는 상태 화면용. 만료 lease는 표시만 하며 자동 삭제하지 않는다. */
export async function listLeases() {
  const root = coordinationDir();
  const dir = join(root, 'leases');
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const out = [];
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const snapshot = await readOwner(join(dir, entry.name));
      if (snapshot?.owner) out.push({ ...snapshot.owner, expired: expired(snapshot) });
      else if (snapshot) out.push({ target: '(손상된 lease)', expired: expired(snapshot), unreadable: true });
    }
    return out.sort((a, b) => String(a.target).localeCompare(String(b.target)));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/** Git과 분리된 로컬 감사 저널. 원문·개인정보를 넣지 않는다. */
export async function appendAudit(event) {
  const root = coordinationDir();
  await ensureControlDirs(root);
  const record = { at: iso(), ...event };
  await appendFile(join(root, 'audit.ndjson'), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}
