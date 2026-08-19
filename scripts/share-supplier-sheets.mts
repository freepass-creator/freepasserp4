/**
 * **우리 공급사 시트를 ERP 서비스계정에 읽기 권한으로 공유한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 필요한가(2026-08-11)
 *   ERP 서버는 **서비스계정 자격 그대로** 시트를 읽는다(`lib/server/google-sheet-visible.ts` —
 *   임퍼소네이션 없음). 그런데 우리 시트는 `pyh@teamjpk.com` 소유로 만들어져 그 계정엔 권한이 없다.
 *   공유하지 않고 재고 정본을 우리 시트로 넘기면 **동기화가 401 로 막혀 재고가 안 들어온다**.
 *   실측: 넘긴 직후 미리보기가 「gid 0: ❌ 401」로 0행을 읽었다.
 *
 * 읽기(reader)만 준다 — 서버는 시트를 고칠 일이 없다.
 *
 *   npx tsx scripts/share-supplier-sheets.mts
 *   npx tsx scripts/share-supplier-sheets.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
/**
 * **링크를 가진 사람은 누구나 수정**(사장님 확정 2026-08-11).
 * 공급사마다 계정을 받아 초대하는 대신 링크 하나로 나눠 준다.
 * ⚠ 이 시트는 이제 ERP 재고의 정본이다 — 링크를 받은 사람의 실수도 그대로 재고가 된다.
 *   되돌릴 길은 시트 버전기록뿐이므로, 링크는 공급사 담당자에게만 준다.
 */
const ANYONE = process.argv.includes('--anyone');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const SA_EMAIL = S(sa.client_email);
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

console.log(`■ 공급사 시트를 서비스계정에 공유 ${APPLY ? '(반영)' : '(dry-run)'}\n  대상 계정 ${SA_EMAIL}\n`);
const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`);

let need = 0; let done = 0;
for (const f of ((found.files || []) as Rec[])) {
  const label = supplierSheetLabel(S(f.name));
  const perms = await api(`https://www.googleapis.com/drive/v3/files/${S(f.id)}/permissions?fields=permissions(id,type,role,emailAddress)`);
  const list = (perms.permissions || []) as Rec[];
  const hasSa = list.some((p) => S(p.emailAddress).toLowerCase() === SA_EMAIL.toLowerCase());
  const linkWriter = list.some((p) => S(p.type) === 'anyone' && S(p.role) === 'writer');
  const want = (ANYONE && !linkWriter) || !hasSa;
  if (!want) { console.log(`  · ${label.padEnd(14)}이미 됨${ANYONE ? ' (링크 수정 가능)' : ''}`); continue; }
  need++;
  console.log(`  ★ ${label.padEnd(14)}${!hasSa ? '서비스계정 공유' : ''}${ANYONE && !linkWriter ? ' 링크 수정 권한' : ''}`);
  if (!APPLY) continue;
  if (!hasSa) {
    await api(`https://www.googleapis.com/drive/v3/files/${S(f.id)}/permissions?sendNotificationEmail=false`, {
      method: 'POST', body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: SA_EMAIL }),
    });
  }
  if (ANYONE && !linkWriter) {
    await api(`https://www.googleapis.com/drive/v3/files/${S(f.id)}/permissions?sendNotificationEmail=false`, {
      method: 'POST', body: JSON.stringify({ type: 'anyone', role: 'writer' }),
    });
  }
  done++;
}
console.log(`\n  공유 필요 ${need}개${APPLY ? ` · 공유함 ${done}개` : ''}`);
if (!APPLY) console.log('\n※ dry-run. 실제 공유는 --apply\n');
