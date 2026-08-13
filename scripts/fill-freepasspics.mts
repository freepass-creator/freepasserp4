/**
 * **차량 사진을 구글드라이브 「프리패스픽스」에 공급사별로 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 — 프리패스픽스에 18개 공급사 폴더가 있는데 실제로 사진이 든 곳은 6곳뿐이다(795장).
 *   나머지 사진은 dudguq 드라이브에 **차량별 폴더**(`차번 차종`)로 흩어져 있고, 그게 로컬
 *   백업(`D:\backup\gdrive-dudguq-공유문서함`)에 그대로 내려와 있다. 그걸 공급사별로 옮긴다.
 *
 * ★차번 → 공급사는 **ERP(`v4/products`) 기준**이다(사용자 지시 2026-08-08).
 *   시트나 폴더 이름으로 짐작하지 않는다 — 폴더명에는 공급사가 안 적혀 있다.
 * ⚠ 매칭 안 된 차는 **「공급사미확인」 폴더**로 간다. 버리지 않는다 — 나중에 사람이 가른다.
 * ⚠ 이미 올라가 있는 파일은 **이름으로 걸러 건너뛴다.** 두 번 돌려도 사본이 안 생긴다.
 * ⚠ 원본(dudguq)은 건드리지 않는다. 로컬 백업에서 **올리기만** 한다.
 *
 *   npx tsx scripts/fill-freepasspics.mts
 *   npx tsx scripts/fill-freepasspics.mts --apply
 *   npx tsx scripts/fill-freepasspics.mts --apply --only=아이카        (한 공급사만)
 *   npx tsx scripts/fill-freepasspics.mts --apply --limit=50           (앞 50대만)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { JWT } from 'google-auth-library';
import { companyAlias } from '../lib/domain/identity';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ROOT = arg('root', 'D:\\backup\\gdrive-dudguq-공유문서함');
const PICS = arg('pics', '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ');
const ONLY = arg('only');
const LIMIT = Number(arg('limit', '0'));
const UNKNOWN = '공급사미확인';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const IMG = /\.(jpg|jpeg|png|webp|heic|gif|bmp)$/i;
/** 폴더 이름이 「12가3456 …」로 시작하면 그게 차량 폴더다. */
const PLATE_HEAD = /^\s*(\d{2,3}[가-힣]\d{4})/;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
/**
 * ⚠ 토큰을 한 번 받아 들고 있으면 **한 시간 뒤에 401 로 죽는다**(실측 2026-08-13 — 4GB 올리다
 *   10대 만에 끊겼다). JWT 클라이언트를 살려 두고 요청마다 받아 쓴다 — 만료 전에 알아서 새로 받는다.
 */
const drJwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com',
});
const drive = async (url: string, init?: RequestInit, tries = 3): Promise<Rec> => {
  for (let i = 0; ; i++) {
    const token = (await drJwt.getAccessToken()).token;
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    // 401 은 토큰이 상한 것 — 강제로 새로 받아 한 번 더. 429·5xx 는 잠깐 쉬고 다시.
    if (i < tries && (res.status === 401 || res.status === 429 || res.status >= 500)) {
      if (res.status === 401) (drJwt as unknown as { credentials: Rec }).credentials = {};
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      continue;
    }
    throw new Error(`${res.status} ${text.slice(0, 300)}`);
  }
};
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const EXTRA = 'includeItemsFromAllDrives=true&supportsAllDrives=true';
const listChildren = async (parent: string) => {
  const out: Rec[] = [];
  let page = '';
  do {
    const r = await drive(`${DRIVE}?q=${encodeURIComponent(`'${parent}' in parents and trashed = false`)}&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=1000&${EXTRA}${page ? `&pageToken=${page}` : ''}`);
    out.push(...(r.files || []));
    page = r.nextPageToken || '';
  } while (page);
  return out;
};

// ── 로컬 백업에서 차량 폴더 모으기 ────────────────────────────────────────────
type Local = { plate: string; folder: string; path: string; files: { name: string; path: string; size: number }[] };
const locals: Local[] = [];
const seenFolder = new Set<string>();
(function walk(dir: string, depth = 0) {
  if (depth > 8) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (!st.isDirectory()) continue;
    const m = name.match(PLATE_HEAD);
    if (m) {
      const files: Local['files'] = [];
      (function collect(d: string, k = 0) {
        if (k > 3) return;
        let es: string[]; try { es = readdirSync(d); } catch { return; }
        for (const e of es) {
          const q = join(d, e);
          let s; try { s = statSync(q); } catch { continue; }
          if (s.isDirectory()) collect(q, k + 1);
          else if (IMG.test(extname(e))) files.push({ name: e, path: q, size: s.size });
        }
      })(p);
      // 같은 폴더가 공유 위치마다 중복 순회된다 — 이름+장수로 한 번만 담는다.
      const key = `${norm(name)}|${files.length}`;
      if (files.length && !seenFolder.has(key)) {
        seenFolder.add(key);
        locals.push({ plate: norm(m[1]), folder: name.trim(), path: p, files });
      }
      continue;   // 차량 폴더 아래로는 더 안 내려간다
    }
    walk(p, depth + 1);
  }
})(ROOT);

// ── 차번 → 공급사 (ERP 기준) ─────────────────────────────────────────────────
const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const nameOf = new Map<string, string>();
for (const p of Object.values(partners)) {
  const c = S(p.partner_code) || S(p._key);
  const nm = companyAlias(S(p.partner_name || p.name || p.company_name), p.alias);
  if (c && nm && !nameOf.has(c)) nameOf.set(c, nm);
}
/** 삭제된 매물도 본다 — 사진은 남아 있고 차번은 그대로다. */
const codeByPlate = new Map<string, string>();
for (const p of Object.values<Rec>(prods)) {
  if (!p || typeof p !== 'object') continue;
  const pl = norm(p.car_number);
  const c = S(p.provider_company_code) || S(p.partner_code);
  if (pl && c && !codeByPlate.has(pl)) codeByPlate.set(pl, c);
}

// ── 프리패스픽스 현재 상태 ───────────────────────────────────────────────────
const picFolders = await listChildren(PICS);
const folderByName = new Map<string, string>();
for (const f of picFolders) if (f.mimeType === 'application/vnd.google-apps.folder') folderByName.set(norm(f.name), f.id);
/**
 * ERP 회사 이름 → 프리패스픽스 폴더 이름. 완전히 같지 않아 «품고 있나»로 맞춘다
 * (예: 「아이언렌트카」 → 폴더 「아이언」).
 */
const pickFolder = (company: string) => {
  const c = norm(company);
  if (!c) return '';
  if (folderByName.has(c)) return c;
  for (const key of folderByName.keys()) if (key.length >= 2 && (c.includes(key) || key.includes(c))) return key;
  return '';
};

type Job = { local: Local; company: string; folderName: string };
const jobs: Job[] = [];
for (const l of locals) {
  const code = codeByPlate.get(l.plate) || '';
  const company = code ? (nameOf.get(code) || code) : '';
  const folderName = company ? pickFolder(company) : '';
  jobs.push({ local: l, company, folderName: folderName || UNKNOWN });
}

const byFolder = new Map<string, Job[]>();
for (const j of jobs) (byFolder.get(j.folderName) || byFolder.set(j.folderName, []).get(j.folderName)!).push(j);

const gb = (n: number) => `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
const total = jobs.reduce((n, j) => n + j.local.files.length, 0);
const bytes = jobs.reduce((n, j) => n + j.local.files.reduce((m, f) => m + f.size, 0), 0);
console.log(`■ 프리패스픽스 채우기 ${APPLY ? '반영' : '미리보기(dry-run)'}\n`);
console.log(`  원본 ${ROOT}`);
console.log(`  차량 폴더 ${locals.length}개 · 사진 ${total}장 · ${gb(bytes)}\n`);
for (const [name, list] of [...byFolder].sort((a, b) => b[1].length - a[1].length)) {
  const n = list.reduce((m, j) => m + j.local.files.length, 0);
  const sz = list.reduce((m, j) => m + j.local.files.reduce((k, f) => k + f.size, 0), 0);
  const known = folderByName.has(norm(name));
  console.log(`  ${known ? '📁' : '🆕'} ${name.padEnd(14)} 차 ${String(list.length).padStart(3)}대 · ${String(n).padStart(4)}장 · ${gb(sz)}`);
}
const unknown = byFolder.get(UNKNOWN) || [];
if (unknown.length) {
  console.log(`\n  ⚠ 공급사를 못 찾은 차 ${unknown.length}대 — ERP 에 그 차번이 없다`);
  console.log(`     ${unknown.slice(0, 12).map((j) => j.local.plate).join(' · ')}${unknown.length > 12 ? ' …' : ''}`);
}

if (!APPLY) { console.log('\n※ dry-run. 실제 올리기는 --apply\n'); process.exit(0); }

// ── 올리기 ──────────────────────────────────────────────────────────────────
const ensureFolder = async (name: string, parent: string) => {
  const found = await drive(`${DRIVE}?q=${encodeURIComponent(`'${parent}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&fields=files(id)&${EXTRA}`);
  if (found.files?.length) return found.files[0].id as string;
  const made = await drive(`${DRIVE}?${EXTRA}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
  });
  return made.id as string;
};
const upload = async (file: { name: string; path: string }, parent: string) => {
  const boundary = '-----fp4pics-----';
  const meta = JSON.stringify({ name: file.name, parents: [parent] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    readFileSync(file.path),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return drive(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
};

let done = 0, skipped = 0, failed = 0, cars = 0;
const picked = jobs.filter((j) => !ONLY || j.folderName === ONLY || j.company.includes(ONLY));
for (const job of (LIMIT ? picked.slice(0, LIMIT) : picked)) {
  const supplier = await ensureFolder(job.folderName, PICS);
  const carDir = await ensureFolder(job.local.folder, supplier);
  const already = new Set((await listChildren(carDir)).map((f) => S(f.name)));
  cars++;
  for (const f of job.local.files) {
    if (already.has(f.name)) { skipped++; continue; }
    try { await upload(f, carDir); done++; } catch (e) { failed++; console.log(`   ⚠ ${job.local.folder}/${f.name} — ${(e as Error).message.slice(0, 120)}`); }
  }
  if (cars % 10 === 0) console.log(`  … ${cars}/${picked.length}대 · 올림 ${done} · 건너뜀 ${skipped}${failed ? ` · 실패 ${failed}` : ''}`);
}
console.log(`\n  끝 — 차 ${cars}대 · 올림 ${done}장 · 이미 있어 건너뜀 ${skipped}장${failed ? ` · 실패 ${failed}장` : ''}`);
console.log(`  https://drive.google.com/drive/folders/${PICS}\n`);
