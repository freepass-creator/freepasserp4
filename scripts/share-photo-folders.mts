/**
 * **사진 폴더를 링크로 볼 수 있게 공유한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 상세페이지·견적서는 드라이브 사진을 링크로 불러온다 — 폴더가 비공개면 사진이 안 뜬다.
 * 기존 폴더는 이미 링크 공유가 걸려 있다(실측 2026-08-12) — 새로 만든 폴더도 같게 맞춘다.
 *
 * ★읽기(reader)만 준다. 기존 것 중에 writer 로 열린 게 있지만, 사진은 보라고 주는 것이지
 *   고치라고 주는 게 아니다. 이미 열린 폴더는 건드리지 않는다.
 *
 *   npx tsx scripts/share-photo-folders.mts
 *   npx tsx scripts/share-photo-folders.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbT}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const byId = new Map<string, string>();
for (const p of Object.values<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const m = S(p.photo_link).match(/folders\/([\w-]+)/);
  if (m) byId.set(m[1], S(p.car_number));
}
console.log(`■ 사진 폴더 공유 ${APPLY ? '(반영)' : '(dry-run)'} — 폴더 ${byId.size}개\n`);

let need = 0; let done = 0; let skipped = 0;
for (const [id, plate] of byId) {
  let perms: Rec;
  try { perms = await api(`https://www.googleapis.com/drive/v3/files/${id}/permissions?fields=permissions(type,role)&supportsAllDrives=true`); }
  catch { skipped++; continue; }   // 남의 폴더는 권한을 못 본다 — 손대지 않는다
  const open = ((perms.permissions || []) as Rec[]).some((p) => S(p.type) === 'anyone');
  if (open) continue;
  need++;
  console.log(`  ★ ${plate.padEnd(12)}${id}`);
  if (!APPLY) continue;
  try {
    await api(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
      method: 'POST', body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    });
    done++;
  } catch (e) { console.log(`     △ 실패 — ${String((e as Error).message).slice(0, 50)}`); }
}
console.log(`\n  공유 필요 ${need}개${APPLY ? ` · 공유함 ${done}개` : ''}${skipped ? ` · 권한을 못 보는 남의 폴더 ${skipped}개` : ''}`);
if (!APPLY) console.log('\n※ dry-run. 실제 공유는 --apply\n');
