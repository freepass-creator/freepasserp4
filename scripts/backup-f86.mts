/**
 * **발행 직전 하허호 F86 을 통째로 떠 둔다** — 틀린 회차가 나가면 바로 직전 모습으로 되돌리기 위해.
 *
 * ★사장님 2026-09-16 「그중 하허호 시트는 제일 중요하게 관리해야」 → 「운영 F86 되돌리기 준비」.
 *   통합 워크플로가 F86 발행 «바로 전»에 부른다. 되돌리기는 `restore-f86-from-backup.mts`.
 *
 * · 백업 = 운영 F86 문서의 Drive 사본(값·서식·차번 링크·공지사항까지 그대로) — 「[F86 백업] MM.DD HH:MM:SS」
 * · 자리 = pyh@teamjpk.com 드라이브의 폴더 「[F86 백업] 프리패스x하허호 전용 상품시트」(없으면 만든다 · 공유하지 않는다)
 * · 보관 = 최근 `--keep`(기본 48)개 — 그보다 오래된 것은 «휴지통»으로(30일 동안 되살릴 수 있다 · 영구 삭제하지 않는다)
 * ⚠ 운영 F86 은 읽기만 한다(사본 만들기). 쓰기 문지기 대상이 아니다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/backup-f86.mts [--label=스냅샷ID] [--keep=48]
 */
import { appendFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import nextEnv from '@next/env';
import { HAHUHO_PRODUCT_SHEET_ID } from '../lib/domain/legacy-sheets';
import { googleSheetsServiceAccount } from '../lib/server/google-service-account';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const KEEP = Math.max(1, Number(arg('keep') || 48));
const label = S(arg('label'));
export const F86_BACKUP_FOLDER = '[F86 백업] 프리패스x하허호 전용 상품시트';

const sa = googleSheetsServiceAccount('tmp/firebase-auth/sa.json');
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 1; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n <= 5) { await new Promise((k) => setTimeout(k, 3000 * n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const DRIVE = 'https://www.googleapis.com/drive/v3/files';

// 폴더
const q = encodeURIComponent(`name = '${F86_BACKUP_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'me' in owners`);
let folderId = S(((await api(`${DRIVE}?q=${q}&fields=files(id)`)).files || [])[0]?.id);
if (!folderId) {
  folderId = S((await api(`${DRIVE}?fields=id`, { method: 'POST', body: JSON.stringify({ name: F86_BACKUP_FOLDER, mimeType: 'application/vnd.google-apps.folder' }) })).id);
  console.log(`   + 백업 폴더 만듦 — ${F86_BACKUP_FOLDER}`);
}

// 사본
const kst = new Date(Date.now() + 9 * 3600e3);
const p2 = (n: number) => String(n).padStart(2, '0');
const stamp = `${p2(kst.getUTCMonth() + 1)}.${p2(kst.getUTCDate())} ${p2(kst.getUTCHours())}:${p2(kst.getUTCMinutes())}:${p2(kst.getUTCSeconds())}`;
const name = `[F86 백업] ${stamp}${label ? ` · ${label}` : ''}`;
const copy = await api(`${DRIVE}/${HAHUHO_PRODUCT_SHEET_ID}/copy?fields=id,name`, { method: 'POST', body: JSON.stringify({ name, parents: [folderId] }) });
console.log(`✓ F86 백업 — ${copy.name}\n   https://docs.google.com/spreadsheets/d/${copy.id}/edit`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `backup_id=${copy.id}\n`);

// 보관 개수 — 오래된 것은 휴지통으로
const list = ((await api(`${DRIVE}?q=${encodeURIComponent(`'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`)}&orderBy=createdTime desc&pageSize=500&fields=files(id,name,createdTime)`)).files || []) as { id: string; name: string }[];
const 넘침 = list.slice(KEEP);
for (const f of 넘침) await api(`${DRIVE}/${f.id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
console.log(`   ○ 보관 ${Math.min(list.length, KEEP)}개${넘침.length ? ` · 오래된 ${넘침.length}개 휴지통으로` : ''}`);
process.exit(0);
