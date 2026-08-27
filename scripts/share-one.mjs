/**
 * 파일 하나를 드라이브에 올리고 **사람 한 명에게** 공유한다.
 *
 * ★메일을 못 보낼 때의 «가장 가까운 것». Gmail 권한(`gmail.send`)이 열리면 이건 안 써도 된다.
 * ★공유는 «그 계정»에만 건다 — 「링크 아는 사람 누구나」가 아니다.
 * ⚠ 알림 메일은 보내지 않는다(`sendNotificationEmail=false`) — 링크는 사람이 손으로 건넨다.
 *
 *   node scripts/share-one.mjs "<파일>" <메일주소> [--folder=<id>]
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { JWT } from 'google-auth-library';

const FILE = process.argv[2];
const WHO = process.argv[3];
const FOLDER = (process.argv.find((a) => a.startsWith('--folder=')) || '').slice('--folder='.length);
if (!FILE || !WHO) { console.log('\n  node scripts/share-one.mjs "<파일>" <메일주소>\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
const c = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const { token } = await c.getAccessToken();
const H = { Authorization: `Bearer ${token}` };

const name = basename(FILE);
const body = readFileSync(FILE);
const meta = JSON.stringify({ name, ...(FOLDER ? { parents: [FOLDER] } : {}), mimeType: 'application/pdf' });
const b = `----${Math.random().toString(36).slice(2)}`;
const parts = Buffer.concat([
  Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/pdf\r\n\r\n`),
  body, Buffer.from(`\r\n--${b}--`)]);

const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name',
  { method: 'POST', headers: { ...H, 'Content-Type': `multipart/related; boundary=${b}` }, body: parts });
const f = await up.json();
if (!f.id) { console.log('\n  ⛔ 못 올렸습니다 — ' + JSON.stringify(f.error?.message || f).slice(0, 200) + '\n'); process.exit(1); }

const pr = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: WHO }),
});
const pj = await pr.json();

console.log('');
console.log('  올린 파일   ' + f.name + '   ' + (statSync(FILE).size / 1024).toFixed(0) + 'KB');
console.log('  올린 계정   pyh@teamjpk.com');
if (pj.id) {
  console.log('  공유        ' + WHO + '  (읽기)');
  console.log('  주소        https://drive.google.com/file/d/' + f.id + '/view');
  console.log('');
  console.log('  ⚠ 알림 메일은 안 갔습니다. 위 주소를 그 계정으로 열면 보입니다.');
} else {
  console.log('  ⛔ 공유 실패 — ' + JSON.stringify(pj.error?.message || pj).slice(0, 200));
  console.log('     (워크스페이스가 바깥 공유를 막고 있을 수 있습니다)');
}
console.log('');
