/**
 * 정산서 PDF 를 드라이브에 올리고 **링크**를 받아 온다.
 *
 * ★왜 드라이브인가 — 메일에 링크로 나가야 하는데 ERP 에 공개 경로가 아직 없다.
 *   드라이브 권한은 «이미» 열려 있다(2026-08-27 확인). 그래서 이걸로 먼저 굴린다.
 *
 * ⛔⛔ **`--share` 를 주면 「링크 아는 사람은 누구나」 볼 수 있게 된다.**
 *   주소는 길고 못 맞히지만, 주소가 새면 그 종이는 새는 것이다.
 *   ★그래서 고객 이름은 종이에서 이미 가려 뒀다(문*준). 그래도 차량번호·금액·회원사명은 보인다.
 *   ⚠ 다 끝나면 링크를 거두는 게 낫다 — `--unshare` 가 되돌린다.
 *
 * ⚠ **폴더를 새로 만들지 않는다.** 회사 문서고는 폴더 체계가 정해져 있다.
 *   `--folder=<id>` 로 «어디에 넣을지»를 받아서 쓴다.
 *
 *   node scripts/upload-invoices-to-drive.mjs 2026-08 --folder=<id> --share
 *   node scripts/upload-invoices-to-drive.mjs 2026-08 --folder=<id> --unshare
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { JWT } from 'google-auth-library';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
const FOLDER = (process.argv.find((a) => a.startsWith('--folder=')) || '').slice('--folder='.length);
const SHARE = process.argv.includes('--share');
const UNSHARE = process.argv.includes('--unshare');
if (!MONTH || !FOLDER) {
  console.log('\n  달과 폴더를 주세요 —');
  console.log('    node scripts/upload-invoices-to-drive.mjs 2026-08 --folder=<드라이브 폴더 id> --share');
  console.log('\n  ★폴더는 «제가 만들지 않습니다». 회사 문서고 체계에 맞는 자리를 정해 주세요.');
  console.log('    폴더를 드라이브에서 열면 주소 끝이 그 id 입니다.\n');
  process.exit(1);
}

const DIR = `tmp/정산서-${MONTH}`;
const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
const c = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const { token } = await c.getAccessToken();
const H = { Authorization: `Bearer ${token}` };
const api = (p) => `https://www.googleapis.com/drive/v3/${p}`;

/** 같은 이름이 이미 있으면 «덮어쓴다» — 달마다 새 파일이 쌓이면 어느 게 최신인지 모른다. */
async function findSame(name) {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\'")}' and '${FOLDER}' in parents and trashed=false`);
  const r = await fetch(api(`files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`), { headers: H });
  return (await r.json()).files?.[0]?.id || '';
}

const pdfs = readdirSync(DIR).filter((f) => f.endsWith('.pdf'));
console.log(`\n■ ${MONTH} 정산서 → 드라이브 — ${pdfs.length}장\n`);

const rows = [];
for (const f of pdfs.sort()) {
  const name = basename(f);
  const body = readFileSync(join(DIR, f));
  const old = await findSame(name);

  let id = old;
  if (old) {
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${old}?uploadType=media&supportsAllDrives=true`,
      { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/pdf' }, body });
  } else {
    const meta = JSON.stringify({ name, parents: [FOLDER], mimeType: 'application/pdf' });
    const b = `----${Math.random().toString(36).slice(2)}`;
    const parts = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/pdf\r\n\r\n`),
      body, Buffer.from(`\r\n--${b}--`)]);
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',
      { method: 'POST', headers: { ...H, 'Content-Type': `multipart/related; boundary=${b}` }, body: parts });
    const j = await r.json();
    if (!j.id) { console.log(`  ⛔ ${name}\n     ${JSON.stringify(j.error?.message || j).slice(0, 120)}`); continue; }
    id = j.id;
  }

  let link = '';
  if (SHARE) {
    await fetch(api(`files/${id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`), {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    link = `https://drive.google.com/file/d/${id}/view`;
  }
  if (UNSHARE) {
    const pr = await fetch(api(`files/${id}/permissions?supportsAllDrives=true&fields=permissions(id,type)`), { headers: H });
    for (const perm of (await pr.json()).permissions || []) {
      if (perm.type === 'anyone') await fetch(api(`files/${id}/permissions/${perm.id}?supportsAllDrives=true`), { method: 'DELETE', headers: H });
    }
  }

  const who = name.replace(/^\d{4}-\d{2} /, '').replace(/ 영업수수료.*$/, '');
  rows.push({ who, name, id, link });
  console.log(`  ○ ${who.padEnd(22)} ${old ? '덮어씀' : '새로'}  ${link || '(링크 안 걺)'}`);
}

if (SHARE) {
  /**
   * ★**바로 붙여넣을 문안까지 뽑는다.** 메일 권한(`gmail.send`)이 아직 없어서
   *   보내는 건 사람이 한다 — 그때마다 문장을 새로 짓게 두지 않는다.
   * ⚠ 기한은 정산 주기(다음 달 10일)를 그대로 쓴다. 문안에서 따로 정하지 않는다.
   */
  const [y, m] = MONTH.split('-');
  const nm = Number(m);
  const due = nm === 12 ? `${Number(y) + 1}. 01. 10` : `${y}. ${String(nm + 1).padStart(2, '0')}. 10`;
  const md = [`# ${MONTH} 정산서 링크`, '',
    '> 메일 권한이 아직 없어 **보내는 건 사람이 합니다.** 아래를 그대로 붙여넣으세요.',
    '> 보내는 주소는 `pyh@teamjpk.com` 입니다.', '',
    '⛔ **링크를 아는 사람은 누구나 봅니다.** 회원사에 보낸 뒤 새면 그 종이는 새는 것입니다.',
    '고객 이름은 종이에서 가려 뒀지만(`문*준`) 차량번호·금액·회원사명은 보입니다.',
    '다 받고 나면 `--unshare` 로 거두는 게 낫습니다.', '',
    '| 회원사 | 링크 |', '|---|---|',
    ...rows.map((r) => `| ${r.who} | ${r.link} |`), '', '---', '',
    ...rows.flatMap((r) => ['## ' + r.who, '', '```',
      `제목  [프리패스모빌리티] ${nm}월 영업수수료 정산서`, '',
      `${r.who} 담당자님, 안녕하세요.`,
      '프리패스모빌리티입니다.', '',
      `${nm}월 영업수수료 정산서를 아래 링크로 보내 드립니다.`, '',
      r.link, '',
      `입금 요청일은 ${due} 입니다.`,
      '내역에 다른 점이 있으시면 회신해 주시면 확인하겠습니다.', '',
      '이번 한 달도 함께해 주셔서 감사합니다.', '',
      '프리패스모빌리티 주식회사',
      '02-6956-8835 · pyh@teamjpk.com',
      '```', '']),
  ].join('\n');
  writeFileSync(join(DIR, '_링크.md'), md, 'utf8');
  console.log(`\n  → ${DIR}/_링크.md   (링크 표 + 회원사별 메일 문안)`);
  console.log('  ⛔ 링크를 아는 사람은 누구나 봅니다. 다 받고 나면 --unshare 로 거두세요.');
}
console.log('');
