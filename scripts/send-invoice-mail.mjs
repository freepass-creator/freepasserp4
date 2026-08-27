/**
 * 정산서를 **메일로 보낸다** — 드라이브에 올려 링크로.
 *
 * ★★★**기본은 «안 보냄»이다.** `--send` 를 붙여야 실제로 나간다.
 *   메일은 되돌릴 수 없다. 잘못 나가면 회수가 안 된다 — 그래서 한 번 더 묻는다.
 *   `--send` 없이 돌리면 «무엇이 어디로 나갈지»를 보여 주고 끝난다.
 *
 * ★첨부가 아니라 링크다(사장님 2026-08-27 「그냥 구글드라이브를 보내라」).
 *   첨부는 고치면 «옛 첨부»가 상대 손에 남지만, 링크는 덮어쓰면 같이 바뀐다.
 *
 * ⚠ 보내는 사람은 `pyh@teamjpk.com` — 서비스 계정이 그 계정을 대행한다.
 * ⚠ `gmail.send` 위임이 있어야 한다. 없으면 여기서 멈추고 무엇을 여는지 알려 준다.
 *
 *   node scripts/send-invoice-mail.mjs "<pdf>" <받는사람> [--folder=<id>] [--send]
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { JWT } from 'google-auth-library';

const FILE = process.argv[2];
const TO = process.argv[3];
const FOLDER = (process.argv.find((a) => a.startsWith('--folder=')) || '').slice('--folder='.length);
const SEND = process.argv.includes('--send');
const FROM = 'pyh@teamjpk.com';
if (!FILE || !TO) { console.log('\n  node scripts/send-invoice-mail.mjs "<pdf>" <받는사람> [--folder=<id>] [--send]\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = async (scope) => {
  const c = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [scope], subject: FROM });
  const { token } = await c.getAccessToken();
  return token;
};

/** 파일 이름에서 «누구에게 가는 몇 월 것인지»를 읽는다. 문안을 여기서 짓는다. */
const name = basename(FILE);
const MONTH = (/^(\d{4})-(\d{2})/.exec(name) || []).slice(1);
const nm = Number(MONTH[1] || 0);
const who = name.replace(/^\d{4}-\d{2} /, '').replace(/ 영업수수료.*$/, '');
const due = nm === 12 ? `${Number(MONTH[0]) + 1}. 01. 10` : `${MONTH[0]}. ${String(nm + 1).padStart(2, '0')}. 10`;

// ── ① 드라이브에 올리고 링크를 받는다 ────────────────────────
const dt = await tok('https://www.googleapis.com/auth/drive');
const DH = { Authorization: `Bearer ${dt}` };
const meta = JSON.stringify({ name, ...(FOLDER ? { parents: [FOLDER] } : {}), mimeType: 'application/pdf' });
const bd = `----${Math.random().toString(36).slice(2)}`;
const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',
  { method: 'POST', headers: { ...DH, 'Content-Type': `multipart/related; boundary=${bd}` },
    body: Buffer.concat([
      Buffer.from(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${bd}\r\nContent-Type: application/pdf\r\n\r\n`),
      readFileSync(FILE), Buffer.from(`\r\n--${bd}--`)]) });
const f = await up.json();
if (!f.id) { console.log('\n  ⛔ 드라이브에 못 올렸습니다 — ' + JSON.stringify(f.error?.message || f).slice(0, 160) + '\n'); process.exit(1); }
await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
  { method: 'POST', headers: { ...DH, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
const link = `https://drive.google.com/file/d/${f.id}/view`;

// ── ② 문안 ────────────────────────────────────────────────
const subject = `[프리패스모빌리티] ${nm}월 영업수수료 정산서`;
const body = [
  `${who} 담당자님, 안녕하세요.`,
  '프리패스모빌리티입니다.', '',
  `${nm}월 영업수수료 정산서를 아래 링크로 보내 드립니다.`, '',
  link, '',
  `입금 요청일은 ${due} 입니다.`,
  '내역에 다른 점이 있으시면 회신해 주시면 확인하겠습니다.', '',
  '이번 한 달도 함께해 주셔서 감사합니다.', '',
  '프리패스모빌리티 주식회사',
  '02-6956-8835 · pyh@teamjpk.com',
].join('\n');

console.log('');
console.log('  보내는 사람  ' + FROM);
console.log('  받는 사람    ' + TO);
console.log('  제목        ' + subject);
console.log('  링크        ' + link);
console.log('  ⛔ 이 링크는 «아는 사람 누구나» 볼 수 있습니다.');
console.log('');
console.log('  ── 본문 ' + '─'.repeat(52));
for (const l of body.split('\n')) console.log('  ' + l);
console.log('  ' + '─'.repeat(60));

if (!SEND) {
  console.log('');
  console.log('  ★아직 «안 보냈습니다».  실제로 보내려면 뒤에 --send 를 붙이세요.');
  console.log('');
  process.exit(0);
}

// ── ③ 보낸다 ──────────────────────────────────────────────
let gt;
try { gt = await tok('https://www.googleapis.com/auth/gmail.send'); }
catch {
  console.log('');
  console.log('  ⛔ 메일 권한(gmail.send)이 아직 없습니다. 드라이브에는 올라갔습니다.');
  console.log('     관리 콘솔 › 보안 › API 제어 › 도메인 전체 위임 에서 열어 주세요.');
  console.log('     node scripts/check-google-scopes.mjs 로 확인됩니다.');
  console.log('');
  process.exit(1);
}
const b64 = (v) => Buffer.from(v, 'utf8').toString('base64');
const raw = Buffer.from([
  `From: 프리패스모빌리티 <${FROM}>`,
  `To: ${TO}`,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: base64',
  `Subject: =?UTF-8?B?${b64(subject)}?=`,
  '', b64(body),
].join('\r\n'), 'utf8').toString('base64url');

const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
  { method: 'POST', headers: { Authorization: `Bearer ${gt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
const j = await r.json();
console.log('');
if (j.id) { console.log('  ○ 보냈습니다.  메일 id ' + j.id); }
else { console.log('  ⛔ 못 보냈습니다 — ' + JSON.stringify(j.error?.message || j).slice(0, 200)); process.exit(1); }
console.log('');
