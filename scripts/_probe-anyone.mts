import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/drive.readonly'] });
const token = (await jwt.getAccessToken()).token;
const [t3, t4] = await Promise.all(['partners','v4/partners'].map(async n =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {}));
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k]||{}), ...v, _key: k };
const dead = (v: Rec) => v?._deleted === true || !!v?.deletedAt || S(v?.status) === 'deleted';
const folded = new Map<string, Rec>();
for (const p of Object.values(partners)) { if (dead(p)) continue; const c = S(p.partner_code) || S(p._key);
  const prev = folded.get(c); if (!prev || (!S(prev.sheet_url) && S(p.sheet_url))) folded.set(c, p); }
const idOf = (u: string) => (u.match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1] || '';
const seen = new Set<string>(); let edit = 0, view = 0, closed = 0, err = 0;
const rows: string[] = [];
for (const p of [...folded.values()].sort((a,b)=>S(a.partner_code).localeCompare(S(b.partner_code)))) {
  const url = S(p.sheet_url); if (!url) continue;
  const id = idOf(url); if (seen.has(id)) continue; seen.add(id);
  const name = S(p.partner_name||p.name).slice(0,16);
  try {
    const pm = await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?fields=permissions(type,role,emailAddress)&supportsAllDrives=true&access_token=${token}`)).json();
    if (pm.error) { err++; rows.push(`  ? ${name.padEnd(18)} 권한조회 불가 (${pm.error.code})`); continue; }
    const list = pm.permissions as any[];
    const a = list.find(x => x.type === 'anyone');
    const owner = list.find(x => x.role === 'owner');
    if (!a) { closed++; rows.push(`  ✓ ${name.padEnd(18)} 제한됨          소유 ${S(owner?.emailAddress)}`); }
    else if (a.role === 'writer') { edit++; rows.push(`  ✗ ${name.padEnd(18)} 누구나 편집 가능   소유 ${S(owner?.emailAddress)}`); }
    else { view++; rows.push(`  △ ${name.padEnd(18)} 누구나 보기       소유 ${S(owner?.emailAddress)}`); }
  } catch { err++; }
}
console.log('■ 공급사 시트 공유 상태\n');
rows.forEach(r => console.log(r));
console.log(`\n  ✗ 누구나 편집 ${edit}곳 · △ 누구나 보기 ${view}곳 · ✓ 제한됨 ${closed}곳 · ? 조회불가 ${err}곳`);
