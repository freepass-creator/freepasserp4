/**
 * 정산서를 **메일로 보낸다** — 드라이브에 올려 «링크»로.
 *
 * ★★★**기본은 «안 보냄»이다.** `--send` 를 붙여야 실제로 나간다.
 *   메일은 되돌릴 수 없다. 잘못 나가면 회수가 안 된다 — 그래서 한 번 더 묻는다.
 *
 * ★**보내는 길은 SMTP 다.** 서비스 계정 위임(`gmail.send`)이 아니다.
 *   2026-08-27 에 위임을 열려고 한참 헤맸는데, 앱 비밀번호로 보내는 길이 «이미 있었다».
 *   환경변수 둘이면 된다.
 *   ```
 *   GMAIL_ADDRESS        pyh@teamjpk.com
 *   GMAIL_APP_PASSWORD   앱 비밀번호 16자
 *   MAILTOOL             기본 C:/dev/mailtool/send_mail.py
 *   ```
 *   ⚠ 앱 비밀번호를 인자로 넘기지 않는다 — 환경변수에서만 읽는다.
 *
 * ★첨부가 아니라 링크다(사장님 2026-08-27 「그냥 구글드라이브를 보내라」).
 *   첨부는 고치면 «옛 첨부»가 상대 손에 남지만, 링크는 덮어쓰면 같이 바뀐다.
 *
 * ★「(확인대기)」가 붙은 종이는 **안 보낸다.** 영업자 실적 확인 전이라 아직 못 나가는 것이다.
 *
 *   npx tsx scripts/send-invoice-mail.mts --month=2026-08              누가 받나 보여만 줌
 *   npx tsx scripts/send-invoice-mail.mts --month=2026-08 --send       전부 보냄
 *   npx tsx scripts/send-invoice-mail.mts "<pdf>" <받는사람> --send    한 장만
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { JWT } from 'google-auth-library';
import { PARTNER_CI, ciOf } from '../lib/domain/partner-ci';
import { dueDate } from '../lib/domain/settlement-cycle';

const ARGS = process.argv.slice(2);
const MONTH = (ARGS.find((a) => a.startsWith('--month=')) || '').slice('--month='.length);
const FOLDER = (ARGS.find((a) => a.startsWith('--folder=')) || '').slice('--folder='.length);
const SEND = ARGS.includes('--send');
const FROM = process.env.GMAIL_ADDRESS || '';
const TOOL = process.env.MAILTOOL || 'C:/dev/mailtool/send_mail.py';
const bare = ARGS.filter((a) => !a.startsWith('--'));

const S = (v: unknown) => String(v ?? '').trim();
const p2 = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}. ${p2(d.getMonth() + 1)}. ${p2(d.getDate())}`;

if (!FROM || !process.env.GMAIL_APP_PASSWORD) {
  console.log('\n  ⛔ GMAIL_ADDRESS / GMAIL_APP_PASSWORD 환경변수가 없습니다.');
  console.log('     앱 비밀번호는 «환경변수로만» 받습니다 — 인자로 넘기지 않습니다.\n');
  process.exit(1);
}
if (!existsSync(TOOL)) {
  console.log(`\n  ⛔ 보내는 도구가 없습니다 — ${TOOL}`);
  console.log('     MAILTOOL 환경변수로 자리를 알려 주세요.\n');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: FROM,
});
const { token } = await jwt.getAccessToken();
const DH = { Authorization: `Bearer ${token}` };

/** 드라이브에 올리고 «링크 아는 사람 누구나» 로 연다. */
async function upload(file: string): Promise<string> {
  const name = basename(file);
  const meta = JSON.stringify({ name, ...(FOLDER ? { parents: [FOLDER] } : {}), mimeType: 'application/pdf' });
  const b = `----${Math.random().toString(36).slice(2)}`;
  const head = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/pdf\r\n\r\n`;
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { ...DH, 'Content-Type': `multipart/related; boundary=${b}` },
    body: Buffer.concat([Buffer.from(head), readFileSync(file), Buffer.from(`\r\n--${b}--`)]),
  });
  const j = await r.json() as { id?: string; error?: { message?: string } };
  if (!j.id) throw new Error(S(j.error?.message) || '드라이브에 못 올렸습니다');
  await fetch(`https://www.googleapis.com/drive/v3/files/${j.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, {
    method: 'POST', headers: { ...DH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  return `https://drive.google.com/file/d/${j.id}/view`;
}

/** 문안 — **한 곳에서** 짓는다. 보낼 때마다 새로 쓰면 회사마다 말이 달라진다. */
function draft(who: string, month: string, link: string) {
  const nm = Number(month.slice(5, 7));
  const due = dueDate(month);
  return {
    subject: `[프리패스모빌리티] ${nm}월 영업수수료 정산서`,
    body: [
      `${who} 담당자님, 안녕하세요.`,
      '프리패스모빌리티입니다.', '',
      `${nm}월 영업수수료 정산서를 아래 링크로 보내 드립니다.`, '',
      link, '',
      `입금 요청일은 ${due ? ymd(due) : ''} 입니다.`,
      '내역에 다른 점이 있으시면 회신해 주시면 확인하겠습니다.', '',
      '이번 한 달도 함께해 주셔서 감사합니다.', '',
      '프리패스모빌리티 주식회사',
      '02-6956-8835 · pyh@teamjpk.com', '',
    ].join('\n'),
  };
}

/** 본문은 «파일로» 넘긴다 — 인자로 넘기면 줄바꿈이 깨진다. 보내고 나면 지운다. */
function post(to: string, subject: string, body: string) {
  const f = `tmp/_mail-${process.pid}-${Math.random().toString(36).slice(2)}.txt`;
  writeFileSync(f, body, 'utf8');
  const r = spawnSync('python', [TOOL, '--to', to, '--subject', subject, '--body-file', f, '--from-name', '프리패스모빌리티'],
    { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  rmSync(f, { force: true });
  const why = [S(r.stderr), S(r.stdout)].filter(Boolean).join(' ').split('\n').filter(Boolean).pop() || '';
  return { ok: r.status === 0, why: why.slice(0, 90) };
}

/**
 * 파일 이름 → 받을 메일.
 *
 * ⚠ 파일 이름은 «정식 상호»고 정본의 열쇠는 «별칭»이다. 둘이 안 겹치는 데가 있다 —
 *   「주식회사 에스엠씨」는 별칭이 `SMC` 고, 「주식회사 하허호무심사」는 `하허호` 다.
 *   ★법인격만 떼서는 못 찾는다. **정식 상호로 되짚어** 찾는다.
 */
const K = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
function mailOf(who: string): { to: string; alias: string } {
  const bare2 = who.replace(/^(주식회사|㈜)\s*/, '').replace(/\s*(주식회사|㈜)$/, '');
  for (const k of [who, bare2]) {
    const ci = ciOf(k);
    if (ci) return { to: S(ci.mail), alias: ci.alias };
  }
  const byLegal = PARTNER_CI.find((c) => K(c.legal) === K(who));
  if (byLegal) return { to: S(byLegal.mail), alias: byLegal.alias };
  return { to: '', alias: who };
}

// ── 한 장만 ───────────────────────────────────────────────
if (bare.length >= 2) {
  const [file, to] = bare;
  const name = basename(file);
  const month = (/^(\d{4}-\d{2})/.exec(name) || [])[1] || MONTH;
  const who = name.replace(/^\d{4}-\d{2} /, '').replace(/ 영업수수료.*$/, '');
  const link = await upload(file);
  const d = draft(who, month, link);
  console.log(`\n  ${FROM}  →  ${to}`);
  console.log(`  ${d.subject}`);
  console.log(`  ${link}`);
  console.log('  ⛔ 이 링크는 «아는 사람 누구나» 볼 수 있습니다.\n');
  if (!SEND) { console.log('  ★아직 «안 보냈습니다». --send 를 붙이세요.\n'); process.exit(0); }
  const r = post(to, d.subject, d.body);
  console.log(r.ok ? '  ○ 보냈습니다.\n' : `  ⛔ 못 보냈습니다 — ${r.why}\n`);
  process.exit(r.ok ? 0 : 1);
}

// ── 한 달 치 ──────────────────────────────────────────────
if (!MONTH) { console.log('\n  --month=2026-08 을 주세요.\n'); process.exit(1); }
const DIR = `tmp/정산서-${MONTH}`;
if (!existsSync(DIR)) { console.log(`\n  ⛔ ${DIR} 가 없습니다 — 먼저 npm run settlement:invoices ${MONTH}\n`); process.exit(1); }
const pdfs = readdirSync(DIR).filter((f) => f.endsWith('.pdf')).sort();

console.log(`\n■ ${MONTH} 정산서 메일 — ${pdfs.length}장${SEND ? '' : '   ★아직 안 보냅니다'}\n`);
let sent = 0; let miss = 0; let held = 0;
for (const f of pdfs) {
  const who = f.replace(/^\d{4}-\d{2} /, '').replace(/ 영업수수료.*$/, '');
  // ★파일 이름이 «아직 못 나간다»고 말한다. 그 말을 무시하지 않는다.
  if (/\(확인대기\)/.test(f)) { held++; console.log(`  ⏸ ${who.padEnd(26)} 확인대기 — 영업자 실적 확인 전입니다`); continue; }
  const { to, alias } = mailOf(who);
  if (!to) { miss++; console.log(`  ⛔ ${who.padEnd(26)} 받을 메일을 모릅니다 — partner-ci.ts 「${alias}」 의 mail`); continue; }
  const link = await upload(join(DIR, f));
  const d = draft(who, MONTH, link);
  if (!SEND) { console.log(`  ○ ${who.padEnd(26)} → ${to}`); continue; }
  const r = post(to, d.subject, d.body);
  if (r.ok) { sent++; console.log(`  ○ ${who.padEnd(26)} → ${to}  보냄`); } else { miss++; console.log(`  ⛔ ${who.padEnd(26)} → ${to}  ${r.why}`); }
}
console.log('');
console.log(`  ${SEND ? '보냄' : '보낼 수 있음'} ${sent || pdfs.length - held - miss} · 확인대기 ${held} · 못 보냄 ${miss}`);
if (!SEND) console.log('  ★아직 «안 보냈습니다». --send 를 붙이세요.');
console.log('');
