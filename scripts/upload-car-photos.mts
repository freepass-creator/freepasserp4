/**
 * **카톡으로 받은 차량 사진을 `freepasspics/<공급사>/<차번 차명>/` 에 올린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★폴더 규격은 「차량번호 + 모델명」으로 고정한다(SA 폴더 실측 2026-08-11) — 「109호1739 GV70」 처럼
 *   트림은 넣지 않고, 한 폴더에 그 차 사진을 모은다. 규격을 새로 만들지 않는다.
 * ★같은 이름 파일이 이미 있으면 올리지 않는다 — 카톡 묶음을 두 번 받으면 사진이 두 배가 된다.
 *
 *   npx tsx scripts/upload-car-photos.mts --plate=162허2357 --files=C:\...\KakaoTalk_20260811_181232556
 *   npx tsx scripts/upload-car-photos.mts --plate=162허2357 --files=... --exclude=KakaoTalk_20260811_181232556_15.jpg
 *   npx tsx scripts/upload-car-photos.mts --plate=162허2357 --files=... --apply
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const PLATE = norm((process.argv.find((a) => a.startsWith('--plate=')) || '').slice('--plate='.length));
const FILES = (process.argv.find((a) => a.startsWith('--files=')) || '').slice('--files='.length).trim();
const EXCLUDE = new Set((process.argv.find((a) => a.startsWith('--exclude=')) || '')
  .slice('--exclude='.length).split(',').map((v) => v.trim()).filter(Boolean));
const ROOT = '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';   // freepasspics
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
if (!PLATE || !FILES) { console.log('■ --plate=162허2357 --files=<파일 또는 접두사> 가 필요하다\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  // 대용량 원본 한 장이 응답 없이 멈춰 전체 묶음이 멈추지 않도록 요청마다 상한을 둔다.
  const res = await fetch(url, { ...init, signal: init?.signal || AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${gT}`, ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};
const ls = async (id: string) => ((await api(
  `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${id}' in parents and trashed=false`)}&pageSize=200&fields=files(id,name,mimeType)&orderBy=name&includeItemsFromAllDrives=true&supportsAllDrives=true`,
)).files || []) as Rec[];

// ── 어느 차인가 ─────────────────────────────────────────────────────────────
const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const car = Object.values<Rec>(prods).find((p) => p && typeof p === 'object' && !dead(p) && norm(p.car_number) === PLATE);
if (!car) { console.log(`■ ${PLATE} 을(를) ERP 에서 못 찾았다 — 차를 먼저 확인하라\n`); process.exit(1); }
const code = S(car.provider_company_code) || S(car.partner_code);
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const pname = S(Object.values<Rec>(partners).find((x) => S(x.partner_code) === code)?.partner_name) || code;
const modelName = S(car.sub_model) || S(car.model);
const displayName = [modelName, S(car.trim_name)].filter(Boolean).join(' ');
console.log(`■ ${PLATE} — ${pname}(${code}) · ${S(car.maker)} ${displayName}\n`);

// ── 올릴 파일 ───────────────────────────────────────────────────────────────
const dir = statSync(FILES, { throwIfNoEntry: false })?.isDirectory() ? FILES : dirname(FILES);
const prefix = statSync(FILES, { throwIfNoEntry: false })?.isDirectory() ? '' : basename(FILES);
const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f) && (!prefix || f.startsWith(prefix)) && !EXCLUDE.has(f)).sort();
if (!files.length) { console.log('  올릴 사진이 없다\n'); process.exit(1); }
console.log(`  사진 ${files.length}장 — ${files[0]} …\n`);

// ── 폴더 찾기·만들기 ────────────────────────────────────────────────────────
const supplierAlias: Record<string, string> = { 'PT-0023': 'SA', RP012: '손오공렌터카', RP030: 'J&J렌트카', RP020: '우리캐피탈렌터카' };
const short = supplierAlias[code] || pname.replace(/\(주\)|주식회사|㈜|렌터카|모빌리티/g, '').trim();
const roots = await ls(ROOT);
const supplierDir = roots.find((f) => S(f.name) === short) || roots.find((f) => S(f.name).includes(short) || short.includes(S(f.name)));
if (!supplierDir) { console.log(`  ✗ freepasspics 아래 「${short}」 폴더가 없다 — 이름을 확인하라\n`); process.exit(1); }
const folderName = `${S(car.car_number)} ${modelName}`.trim();
const kids = await ls(S(supplierDir.id));
let carDir = kids.find((f) => S(f.mimeType).includes('folder') && norm(f.name).startsWith(PLATE));
console.log(`  넣을 곳  freepasspics / ${S(supplierDir.name)} / ${carDir ? S(carDir.name) : `${folderName}  ★새로 만듦`}`);
if (carDir) console.log(`  사진링크  https://drive.google.com/drive/folders/${S(carDir.id)}`);

const existing = carDir ? new Set((await ls(S(carDir.id))).map((f) => S(f.name))) : new Set<string>();
const todo = files.filter((f) => !existing.has(f));
console.log(`  올릴 사진 ${todo.length}장${files.length - todo.length ? ` (이미 있는 ${files.length - todo.length}장 건너뜀)` : ''}`);
if (!APPLY) { console.log('\n※ dry-run. 실제 업로드는 --apply\n'); process.exit(0); }

if (!carDir) {
  carDir = await api('https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [S(supplierDir.id)] }),
  });
  console.log(`  폴더 만듦 「${S(carDir!.name)}」`);
}
let done = 0;
for (const f of todo) {
  const bytes = readFileSync(join(dir, f));
  const meta = JSON.stringify({ name: f, parents: [S(carDir!.id)] });
  const boundary = 'fp4boundary';
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), bytes, Buffer.from(`\r\n--${boundary}--`, 'utf8')]);
  await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name&supportsAllDrives=true', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: body as never,
  });
  done++;
  if (done % 5 === 0 || done === todo.length) console.log(`     ${done}/${todo.length}`);
}
console.log(`\n  올림 ${done}장 — https://drive.google.com/drive/folders/${S(carDir!.id)}\n`);
