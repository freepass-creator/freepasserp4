/**
 * **프리패스픽스 차량 폴더 이름을 「차량번호 모델명」으로 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-20 「폴더는 이름만 정확하면 된다 — 차량번호 차종으로만 기입하면 되니까」.
 *   실측에서 폴더 이름이 제각각이었다: 「146호1686 CT6」(실제 XT6) · 「109호3228 코나」(실제 니로) ·
 *   「125호5168 gv70」(소문자) · 「142호8434」(차종 없음) · 「133호6168(초록)」(메모). 이름이 틀리면
 *   사람이 눈으로 고르다 남의 차를 링크한다.
 *
 * ★이름은 **시트가 정본**이다 — 차번으로 공급사 시트를 찾아 그 줄의 「모델명」을 쓴다(엔카 규격 이름).
 *   시트에 없는 차번은 **손대지 않는다**(옛 차·다른 곳 사진일 수 있다).
 * ★폴더 **id 는 그대로**라 시트 링크는 안 깨진다 — 이름만 바꾼다.
 * ★같은 공급사 폴더 안에 같은 이름이 이미 있으면 건드리지 않는다(합치는 일은 사람이 판단).
 *
 *   npx tsx scripts/tidy-photo-folder-names.mts
 *   npx tsx scripts/tidy-photo-folder-names.mts --apply
 *   npx tsx scripts/tidy-photo-folder-names.mts --apply --who=스타
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
const WHO = arg('who');
const PICS = arg('pics') || '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';
const PLATE_HEAD = /^\s*(\d{2,3}[가-힣]\d{4})/;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text(); if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const EXTRA = 'includeItemsFromAllDrives=true&supportsAllDrives=true';
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const ls = async (parent: string) => {
  const out: Rec[] = []; let page = '';
  do {
    const r = await call(`${DRIVE}?q=${encodeURIComponent(`'${parent}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&${EXTRA}${page ? `&pageToken=${page}` : ''}`);
    out.push(...((r.files || []) as Rec[])); page = S(r.nextPageToken);
  } while (page);
  return out;
};

// ── 차번 → 모델명(시트가 정본) ───────────────────────────────────────────────
const modelOf = new Map<string, string>();
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const books = (((await call(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&${EXTRA}`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) }));
for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(title,hidden)`);
  for (const p of ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec)) {
    const title = S(p.title); if (p.hidden || isOurNonInventoryTab(title)) continue;
    let got: Rec; try { got = await call(`${SH}/${b.id}/values/${encodeURIComponent(`${title}!A1:BZ700`)}`); } catch { continue; }
    const rows = ((got.values || []) as string[][]);
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호')); if (hi < 0) continue;
    const hdr = rows[hi].map(norm);
    const pi = hdr.indexOf('차량번호'); const gi = hdr.indexOf('모델명'); const ci = hdr.findIndex((h) => h.startsWith('차명'));
    if (pi < 0) continue;
    for (const r of rows.slice(hi + 1)) {
      const plate = norm(r[pi]); if (!plate) continue;
      const model = S(r[gi]) || S(r[ci]).split(/\s+/)[0];
      if (model && !modelOf.has(plate)) modelOf.set(plate, model);
    }
  }
}
console.log(`■ 시트에서 읽은 차번 ${modelOf.size}개\n`);

// ── 프리패스픽스 폴더 이름 맞추기 ────────────────────────────────────────────
type Fix = { supplier: string; id: string; from: string; to: string };
const fixes: Fix[] = []; const left: string[] = [];
const sups = (await ls(PICS)).filter((f) => S(f.mimeType).includes('folder'));
for (const sup of sups) {
  const supName = S(sup.name);
  if (WHO && !supName.includes(WHO)) continue;
  const cars = (await ls(S(sup.id))).filter((f) => S(f.mimeType).includes('folder'));
  const taken = new Set(cars.map((c) => norm(c.name)));
  for (const c of cars) {
    const name = S(c.name);
    const m = name.match(PLATE_HEAD);
    if (!m) { left.push(`${supName}/${name} — 이름이 차번으로 시작하지 않음`); continue; }
    const plate = norm(m[1]);
    const model = modelOf.get(plate);
    if (!model) { left.push(`${supName}/${name} — 시트에 없는 차번`); continue; }
    const to = `${plate} ${model}`;
    if (name === to) continue;
    if (taken.has(norm(to))) { left.push(`${supName}/${name} → 「${to}」 같은 이름이 이미 있음`); continue; }
    fixes.push({ supplier: supName, id: S(c.id), from: name, to });
    taken.add(norm(to));
  }
}

console.log(`■ 이름 고칠 폴더 ${fixes.length}개 ${APPLY ? '(반영)' : '(dry-run)'}`);
const bySup = new Map<string, Fix[]>();
for (const f of fixes) (bySup.get(f.supplier) || bySup.set(f.supplier, []).get(f.supplier)!).push(f);
for (const [sup, list] of [...bySup].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n── ${sup} ${list.length}개`);
  for (const f of list) console.log(`   ${f.from.slice(0, 30).padEnd(32)} → ${f.to}`);
}
if (left.length) {
  console.log(`\n■ 손대지 않은 폴더 ${left.length}개`);
  for (const l of left.slice(0, 15)) console.log(`   ${l}`);
  if (left.length > 15) console.log(`   … 그 밖 ${left.length - 15}개`);
}
writeFileSync('tmp/photo-folder-renames.json', JSON.stringify({ fixes, left }, null, 2));
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply · 목록 tmp/photo-folder-renames.json\n'); process.exit(0); }

let done = 0;
for (const f of fixes) {
  await call(`${DRIVE}/${f.id}?${EXTRA}`, { method: 'PATCH', body: JSON.stringify({ name: f.to }) });
  done++;
  if (done % 20 === 0) console.log(`  … ${done}/${fixes.length}`);
}
console.log(`\n■ 끝 — 이름 고침 ${done}개 (폴더 id 는 그대로라 시트 링크는 살아 있다)\n`);
