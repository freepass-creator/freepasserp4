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
const EXTERNAL = new Set(['RP023','RP031','RP004','RP006']);  // 오플·이안카·아이카·아이언 = 공급사 것
const ROLE: Record<string,string> = { owner:'소유자', writer:'편집', commenter:'댓글', reader:'보기' };
console.log('공급사'.padEnd(16) + '코드'.padEnd(10) + '구분'.padEnd(8) + '소유자'.padEnd(34) + '서비스계정 · 링크공개');
for (const p of [...folded.values()].sort((a,b)=>S(a.partner_code).localeCompare(S(b.partner_code)))) {
  const url = S(p.sheet_url); if (!url) continue;
  const code = S(p.partner_code) || S(p._key);
  const id = idOf(url);
  const kind = EXTERNAL.has(code) ? '공급사것' : '우리것';
  let owner = '?', sa2 = '-', anyone = '-';
  try {
    const f = await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=owners(emailAddress)&supportsAllDrives=true&access_token=${token}`)).json();
    owner = f?.error ? `✗ ${f.error.code}` : (f.owners||[]).map((o:any)=>o.emailAddress).join(',') || '?';
    const pm = await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?fields=permissions(type,role,emailAddress)&supportsAllDrives=true&access_token=${token}`)).json();
    if (pm.permissions) {
      const list = pm.permissions as any[];
      sa2 = list.find(x => S(x.emailAddress).startsWith('firebase-adminsdk')) ? '있음' : '없음';
      const a = list.find(x => x.type === 'anyone');
      anyone = a ? ROLE[a.role] || a.role : '없음';
    }
  } catch { owner = '✗ 조회실패'; }
  console.log(`${S(p.partner_name||p.name).slice(0,15).padEnd(16)}${code.padEnd(10)}${kind.padEnd(8)}${owner.slice(0,32).padEnd(34)}${sa2} · ${anyone}`);
}
