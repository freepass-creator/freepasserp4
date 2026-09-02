/**
 * **그 달 정산서를 드라이브에 «공급사 / 영업채널»로 갈라 담고 링크를 준다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-02 「8월 청구서 기준으로 정산서 작업하고 구글드라이브 링크주라
 *   공급사 영업채널 8월 폴더에 나눠서 담아줘」
 *
 * ```
 * 프리패스 정산서/
 *   2026-08/
 *     공급사 청구서/         받을 돈 — ★영업자 실적 확인 전이면 이름에 (확인대기)가 붙어 있다
 *     영업채널 지급명세서/     줄 돈
 * ```
 * ★**폴더는 «있으면 쓰고 없으면 만든다».** 같은 이름을 두 번 만들지 않는다 — 두 벌이 생기면
 *   어느 쪽이 최신인지 아무도 모른다.
 * ★★**공유는 «회사 사람까지»다**(teamjpk.com). 「링크 아는 사람 누구나」로 열지 않는다 —
 *   차량번호·금액·회원사명이 그대로 보이는 종이다.
 * ⚠ 이름이 같은 파일은 «덮어쓴다»(새 판을 올린다). 그래야 8월 정산서가 한 장만 남는다.
 *
 *   npx tsx scripts/upload-settlement-docs.mts 2026-08
 *   npx tsx scripts/upload-settlement-docs.mts 2026-08 --apply
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JWT } from 'google-auth-library';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
const APPLY = process.argv.includes('--apply');
if (!MONTH) { console.log('\n  달을 주세요 — npx tsx scripts/upload-settlement-docs.mts 2026-08 [--apply]\n'); process.exit(1); }
const ROOT = '프리패스 정산서';
const DIR = `tmp/정산서-${MONTH}`;
const S = (v: unknown) => String(v ?? '').trim();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/drive'] }).getAccessToken()).token;
const H = { Authorization: `Bearer ${tok}` };
const esc = (s: string) => s.replace(/'/g, "\'");

/** 같은 이름이 있으면 그걸 쓰고, 없을 때만 만든다. */
async function folder(name: string, parent?: string): Promise<string> {
  const q = `mimeType='application/vnd.google-apps.folder' and name='${esc(name)}' and trashed=false`
    + (parent ? ` and '${parent}' in parents` : " and 'root' in parents");
  const found = ((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: H })).json() as { files?: { id: string }[] }).files) || [];
  if (found.length) { console.log(`   ○ 있음   ${name}`); return found[0].id; }
  if (!APPLY) { console.log(`   + 만든다 ${name}`); return `(새폴더:${name})`; }
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent || 'root'] }) });
  const j = await r.json() as { id?: string };
  console.log(`   + 만듦   ${name}`);
  return S(j.id);
}

/** 같은 이름이 있으면 «새 판»으로 덮는다. 없으면 새로 올린다. */
async function put(path: string, name: string, parent: string): Promise<string> {
  const q = `name='${esc(name)}' and '${parent}' in parents and trashed=false`;
  const old = ((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true`, { headers: H })).json() as { files?: { id: string }[] }).files) || [];
  const body = readFileSync(path);
  const meta = old.length ? {} : { name, parents: [parent] };
  const url = old.length
    ? `https://www.googleapis.com/upload/drive/v3/files/${old[0].id}?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true';
  const B = '===fp===';
  const pre = `--${B}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${B}\r\nContent-Type: application/pdf\r\n\r\n`;
  const buf = Buffer.concat([Buffer.from(pre, 'utf8'), body, Buffer.from(`\r\n--${B}--`, 'utf8')]);
  const r = await fetch(url, { method: old.length ? 'PATCH' : 'POST', headers: { ...H, 'Content-Type': `multipart/related; boundary=${B}` }, body: buf });
  if (!r.ok) { console.log(`      ✕ ${name} — ${r.status} ${(await r.text()).slice(0, 120)}`); return ''; }
  return S((await r.json() as { id?: string }).id);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.pdf'));
const bill = files.filter((f) => f.includes('청구서'));
const payd = files.filter((f) => f.includes('지급명세서'));
console.log(`\n■ ${MONTH} 정산서 ${files.length}장 — 공급사 청구서 ${bill.length} · 영업채널 지급명세서 ${payd.length}`);
console.log(`\n■ 폴더 ${APPLY ? '' : '(대조만)'}`);
const root = await folder(ROOT);
const mon = await folder(MONTH, root);
const fBill = await folder('공급사 청구서', mon);
const fPay = await folder('영업채널 지급명세서', mon);

if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 올렸다. --apply 로 올린다.\n'); process.exit(0); }

for (const [label, list, into] of [['공급사 청구서', bill, fBill], ['영업채널 지급명세서', payd, fPay]] as [string, string[], string][]) {
  console.log(`\n■ ${label} ${list.length}장`);
  for (const f of list) { const id = await put(join(DIR, f), f, into); console.log(`   ${id ? '○' : '✕'} ${f}`); }
}

// ★공유는 회사 사람까지. 「링크 아는 사람 누구나」로 열지 않는다.
const share = await fetch(`https://www.googleapis.com/drive/v3/files/${root}/permissions?fields=id&supportsAllDrives=true`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'domain', domain: 'teamjpk.com', role: 'writer' }) });
console.log(`\n■ 공유 — teamjpk.com 회사 사람 전부 ${share.ok ? '✓' : `(이미 되어 있거나 실패 ${share.status})`}`);
console.log('\n■ 링크');
console.log(`   정산서 전체   https://drive.google.com/drive/folders/${root}`);
console.log(`   ${MONTH}       https://drive.google.com/drive/folders/${mon}`);
console.log(`   공급사 청구서   https://drive.google.com/drive/folders/${fBill}`);
console.log(`   영업채널 지급   https://drive.google.com/drive/folders/${fPay}\n`);
process.exit(0);
