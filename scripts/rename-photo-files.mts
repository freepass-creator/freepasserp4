/**
 * **사진 파일 이름을 「차량번호 모델_NN」 규격으로 바꾼다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-23 「파일명이 날짜로 되어 있는 애들도 있고… **규격이 차량번호 모델 이렇게 되어 있어야 하는데**」
 *
 * ★왜 이름이 중요한가
 *   사진이 어느 차 것인지 **파일 이름만 보고도** 알 수 있어야 한다. 폴더에서 떨어져 나오거나
 *   카톡·메일로 옮겨 다니면 폴더 이름은 사라지고 파일 이름만 남는다.
 *   실측 2026-08-23: 7,363장 중 카톡 이름 3,955 · `web_NN` 3,023 · 날짜 49 — 이름만으로는 어느 차인지 모른다.
 *
 * ★규격 = `<차량번호> <모델>_<번호>.<확장자>`  (폴더 이름 그대로 + 두 자리 일련번호)
 *   예) 「109호3398 팰리세이드」 폴더의 첫 장 → `109호3398 팰리세이드_01.jpg`
 *
 * ⚠ **폴더 이름에 차번이 없으면 건너뛴다** — 어느 차인지 모르는 채로 이름을 붙이면 그게 거짓말이 된다.
 * ⚠ 파일 **내용은 안 건드린다.** 이름만 바꾸므로 링크(폴더 주소)는 그대로 살아 있다.
 *
 *   npx tsx scripts/rename-photo-files.mts
 *   npx tsx scripts/rename-photo-files.mts --who=아이카
 *   npx tsx scripts/rename-photo-files.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { PLATE_IN_NAME } from '../lib/domain/photo-link-guard';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const WHO = arg('who');
const PICS = arg('pics') || '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const D = 'https://www.googleapis.com/drive/v3/files';
const EX = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const call = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const kids = async (parent: string) => {
  const out: any[] = []; let page = '';
  do {
    const r = await call(`${D}?q=${encodeURIComponent(`'${parent}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&${EX}${page ? `&pageToken=${page}` : ''}`);
    out.push(...(r.files || [])); page = r.nextPageToken || '';
  } while (page);
  return out;
};
/** 확장자 — 없으면 jpg 로 본다(드라이브 사진은 대부분 jpg). */
const extOf = (name: string) => { const m = /\.([A-Za-z0-9]{2,5})$/.exec(name); return m ? `.${m[1].toLowerCase()}` : '.jpg'; };

console.log('■ 사진 파일 이름 → 「차량번호 모델_NN」\n');
let rename = 0; let same = 0; let skip = 0;
const jobs: { id: string; from: string; to: string }[] = [];
const sample: string[] = [];

for (const sup of (await kids(PICS)).filter((f) => f.mimeType.endsWith('.folder'))) {
  const supName = S(sup.name);
  if (WHO && !supName.includes(WHO)) continue;
  for (const car of (await kids(sup.id)).filter((f) => f.mimeType.endsWith('.folder'))) {
    const folder = S(car.name);
    // ⚠ 폴더 이름이 차번을 말하지 않으면 손대지 않는다 — 어느 차인지 모르는 이름을 붙일 수 없다.
    if (!PLATE_IN_NAME.test(folder)) { skip += (await kids(car.id)).filter((f) => !f.mimeType.endsWith('.folder')).length; continue; }
    const photos = (await kids(car.id)).filter((f) => !f.mimeType.endsWith('.folder'))
      .sort((a, b) => S(a.name).localeCompare(S(b.name), 'ko', { numeric: true }));
    photos.forEach((ph, i) => {
      const want = `${folder}_${String(i + 1).padStart(2, '0')}${extOf(S(ph.name))}`;
      if (S(ph.name) === want) { same++; return; }
      rename++;
      if (sample.length < 8) sample.push(`  ${supName}/${folder}\n     ${S(ph.name).slice(0, 40)} ▶ ${want}`);
      jobs.push({ id: ph.id, from: S(ph.name), to: want });
    });
  }
}
console.log(`  바꿀 파일 ${rename} · 이미 규격 ${same} · 폴더에 차번이 없어 건너뜀 ${skip}`);
if (sample.length) { console.log('\n  보기:'); sample.forEach((l) => console.log(l)); }

if (!APPLY) { console.log('\n  (미리보기다 — 바꾸려면 --apply)'); process.exit(0); }
let done = 0;
for (const j of jobs) {
  await call(`${D}/${j.id}?${EX}`, { method: 'PATCH', body: JSON.stringify({ name: j.to }) });
  done++;
  if (done % 100 === 0) console.log(`  … ${done}/${jobs.length}`);
}
console.log(`\n  ✓ ${done}장 이름을 바꿨다(내용·링크는 그대로).`);
