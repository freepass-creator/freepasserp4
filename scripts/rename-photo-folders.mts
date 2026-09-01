/**
 * **사진 폴더 이름을 「차량번호 모델」 규격으로 통일한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-23 「**폴더명을 차량번호 모델 로 해 달라고 일괄 통일**」
 *
 * ★왜 이름이 중요한가
 *   문지기(`photo-link-guard`)가 **폴더 이름의 차번**으로 «그 차 사진인가»를 가른다.
 *   이름이 규격을 벗어나면 문지기가 판정을 못 해 링크를 못 걸거나, 남의 차에 걸린다.
 *   실측 2026-08-23: 389개 중 15개가 어긋났다(모델이 없거나 차번이 없다).
 *
 * ★모델 이름은 **공급사 시트에서 가져온다** — 우리가 지어내지 않는다.
 *   시트 「세부모델」(없으면 「모델」·「모델명」)을 그대로 붙인다.
 *   ⚠ 시트에서 못 찾으면 **그 폴더는 건드리지 않는다.** 이름을 지어내면 그게 거짓말이 된다.
 *
 *   npx tsx scripts/rename-photo-folders.mts
 *   npx tsx scripts/rename-photo-folders.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { PLATE_IN_NAME } from '../lib/domain/photo-link-guard';
import { SHEET_NAME_MATCH, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const plateKey = (v: unknown) => S(v).replace(/\s+/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const PICS = arg('pics') || '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
});
const D = 'https://www.googleapis.com/drive/v3/files';
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const EX = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const call = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    if (r.ok) return r.json();
    if (r.status === 404 || r.status === 403) return null;
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const kids = async (parent: string) => {
  const out: any[] = []; let page = '';
  do {
    const r = await call(`${D}?q=${encodeURIComponent(`'${parent}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&${EX}${page ? `&pageToken=${page}` : ''}`);
    out.push(...(r?.files || [])); page = r?.nextPageToken || '';
  } while (page);
  return out;
};

// ── ① 시트에서 차번 → 모델 이름
const model = new Map<string, string>();
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&${EX}`);
for (const f of (found?.files || [])) {
  const meta = await call(`${SH}/${S(f.id)}?fields=sheets.properties(title,hidden)`);
  const tab = (meta?.sheets || [])
    .filter((s: any) => !s.properties.hidden && !isOurNonInventoryTab(S(s.properties.title)))
    .map((s: any) => S(s.properties.title))[0];
  if (!tab) continue;
  const v = await call(`${SH}/${S(f.id)}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:CZ700`)}`);
  const rows = ((v?.values || []) as string[][]).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const head = rows[hi];
  const ip = head.indexOf('차량번호');
  // 세부모델이 먼저 — 폴더 이름은 「차번 + 그 차를 알아보는 이름」이다.
  const cands = ['세부모델', '모델', '모델명'].map((n) => head.indexOf(n)).filter((i) => i >= 0);
  for (const r of rows.slice(hi + 1)) {
    const plate = plateKey(r[ip]);
    if (!plate || model.has(plate)) continue;
    const name = cands.map((i) => S(r[i])).find(Boolean);
    if (name) model.set(plate, name);
  }
  await sleep(120);
}
console.log(`■ 사진 폴더 이름 → 「차량번호 모델」\n  시트에서 읽은 모델 이름 ${model.size}대\n`);

// ── ② 폴더 훑기
let ok = 0; let fix = 0; let cannot = 0;
const jobs: { id: string; from: string; to: string; sup: string }[] = [];
const noName: string[] = [];
for (const sup of (await kids(PICS)).filter((f) => f.mimeType.endsWith('.folder'))) {
  const supName = S(sup.name);
  for (const car of (await kids(sup.id)).filter((f) => f.mimeType.endsWith('.folder'))) {
    const now = S(car.name);
    const plate = (now.match(PLATE_IN_NAME) || [])[1] || '';
    if (!plate) { cannot++; noName.push(`  [차번 없음] ${supName}/${now}`); continue; }
    const m = model.get(plateKey(plate));
    if (!m) {
      // 모델을 모르면 그대로 둔다(이름을 지어내지 않는다). 이미 모델이 붙어 있으면 규격 통과로 본다.
      if (now.replace(plate, '').trim()) ok++;
      else { cannot++; noName.push(`  [시트에 없음] ${supName}/${now}`); }
      continue;
    }
    const want = `${plate} ${m}`;
    if (now === want) { ok++; continue; }
    fix++;
    jobs.push({ id: car.id, from: now, to: want, sup: supName });
  }
}
console.log(`  이미 규격 ${ok} · 바꿀 폴더 ${fix} · 못 정하는 폴더 ${cannot}`);
if (jobs.length) {
  console.log('\n  바꿀 것:');
  jobs.slice(0, 12).forEach((j) => console.log(`  ${j.sup}/${j.from}  ▶  ${j.to}`));
  if (jobs.length > 12) console.log(`  … 외 ${jobs.length - 12}개`);
}
if (noName.length) { console.log('\n  ⚠ 못 정해 그대로 두는 폴더:'); noName.slice(0, 10).forEach((l) => console.log(l)); }

if (!APPLY) { console.log('\n  (미리보기다 — 바꾸려면 --apply)'); process.exit(0); }
let done = 0;
for (const j of jobs) {
  await call(`${D}/${j.id}?${EX}`, { method: 'PATCH', body: JSON.stringify({ name: j.to }) });
  done++;
  if (done % 50 === 0) console.log(`  … ${done}/${jobs.length}`);
}
console.log(`\n  ✓ 폴더 ${done}개 이름을 바꿨다(주소·내용은 그대로라 링크는 살아 있다).`);
