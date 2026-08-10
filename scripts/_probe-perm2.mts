import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const S = (v: unknown) => String(v ?? '').trim();
const ID = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
const token = (await jwt.getAccessToken()).token;
const ROLE: Record<string,string> = { owner:'소유자', writer:'편집 가능', commenter:'댓글 가능', reader:'보기만' };
const f = await (await fetch(`https://www.googleapis.com/drive/v3/files/${ID}?fields=name,owners(emailAddress,displayName),modifiedTime,shared&supportsAllDrives=true&access_token=${token}`)).json();
console.log(`문서 「${f.name}」`);
console.log(`  소유자   ${(f.owners||[]).map((o:any)=>`${o.displayName||''} <${o.emailAddress}>`).join(', ')}`);
console.log(`  마지막수정 ${S(f.modifiedTime).replace('T',' ').slice(0,16)}`);
const p = await (await fetch(`https://www.googleapis.com/drive/v3/files/${ID}/permissions?fields=permissions(type,role,emailAddress,displayName,allowFileDiscovery)&supportsAllDrives=true&access_token=${token}`)).json();
console.log('\n  접근 권한');
for (const x of (p.permissions||[]) as any[]) {
  if (x.type === 'anyone') console.log(`    링크 공개  — ${ROLE[x.role]||x.role} ${x.allowFileDiscovery ? '(검색으로도 찾힘)' : '(링크 아는 사람만)'}`);
  else console.log(`    ${x.type.padEnd(6)} ${S(x.emailAddress).padEnd(52)} ${ROLE[x.role]||x.role}`);
}
