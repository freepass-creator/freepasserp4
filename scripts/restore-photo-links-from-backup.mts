/**
 * **사진이 빈 차에 «리셋 전 사진링크»를 되돌린다 — 차번이 맞는 것만.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-23 「공급사 시트에 사진링크 다 했니?? · 하고 이어서 작업해」
 *   실측: 공급사 시트 694줄 중 **351줄이 사진 없음**이었다. 재고를 리셋하면서 ERP 사진이 사라졌고,
 *   시트에도 안 남은 차가 많다. 그런데 **리셋이력 백업에는 링크가 살아 있다**
 *   (아이카 604 · 오플 416 · 아이언 126 · 손오공 73 …).
 *
 * ★문지기를 반드시 거친다(`photo-link-guard.judgePhotoLink`)
 *   ⚠ 사진 사고의 근원은 «누구 차인지 확인 안 하고 붙인 것»이다. 여기서는 세 가지를 본다 —
 *     ① 드라이브 폴더 «이름»이 차번을 말하면 그게 답이다(다르면 안 건다)
 *     ② 이름이 차번을 안 말하면 «혼자 쓰는가»로 가른다(여러 차가 나눠 쓰면 그 차 사진이 아니다)
 *     ③ 열리지 않는 폴더는 안 건다
 *   통과 못 한 줄은 **비워 둔다.** 틀린 사진보다 빈칸이 낫다.
 *
 * ⚠ **이미 사진이 걸린 차는 안 건드린다.** 멀쩡한 것을 덮으면 그게 또 사고다.
 *
 *   npx tsx scripts/restore-photo-links-from-backup.mts
 *   npx tsx scripts/restore-photo-links-from-backup.mts --who=이안카
 *   npx tsx scripts/restore-photo-links-from-backup.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { countPlatesByUrl, driveIdOf, isPhotoUrl, judgePhotoLink } from '../lib/domain/photo-link-guard';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const plateKey = (v: unknown) => S(v).replace(/\s+/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const WHO = arg('who');
/**
 * `--overwrite` — 이미 사진이 걸린 줄도 **차번 셀 링크로 덮는다**
 *   (사장님 2026-08-23 「링크 다 반영해 주고」). 셀 링크가 공급사가 준 정본이라 그게 이긴다.
 * ⚠ 그래도 문지기는 그대로 거친다 — 덮더라도 «그 차 사진»이어야 한다.
 */
const OVERWRITE = process.argv.includes('--overwrite');
const BACKUP = arg('backup') || 'D:/backup/freepasserp4-rtdb/리셋이력-2026-08-23-2050/v4_products.json';
/**
 * ★**차번 «셀 링크»도 근거로 쓴다**(사장님 2026-08-23 「시트는 원본시트에 다 있잖아 · 과거시트 참조해봐」).
 *   사진은 「사진링크」 열에만 있는 게 아니라 **차량번호 셀의 하이퍼링크**로도 걸려 있다 —
 *   오토플러스 원본 시트 머리글이 그렇게 말한다: 「★★★ 차량번호 클릭 후 차량이미지 다운로드 가능합니다 ★★★」.
 *   값(values)·수식(FORMULA)으로 읽으면 **안 보인다.** `includeGridData` 로 셀 hyperlink 를 읽어야 나온다 —
 *   그래서 처음엔 「원본에 사진이 없다」고 잘못 봤다. 실측 365대분이 여기 살아 있었다.
 *   `tmp/plate-cell-links-all.mts` 가 긁어 `tmp/plate-cell-links.json` 에 둔다.
 */
const CELL_LINKS = (() => {
  try { return JSON.parse(readFileSync('tmp/plate-cell-links.json', 'utf8')) as Record<string, string>; }
  catch { return {}; }
})();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

// ── ① 백업에서 차번 → 사진링크
const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Record<string, any>;
const plateUrl = new Map<string, string>();
const pairs: { plate: string; urls: string[] }[] = [];
for (const p of Object.values(backup)) {
  if (!p || typeof p !== 'object') continue;
  const url = S((p as any).photo_link);
  const plate = plateKey((p as any).car_number);
  if (!plate || !isPhotoUrl(url)) continue;
  plateUrl.set(plate, url);
  pairs.push({ plate, urls: [url] });
}
/** 한 주소를 «서로 다른 차»가 몇이나 쓰나 — 문지기 규칙 ②의 근거. */
for (const [plate, url] of Object.entries(CELL_LINKS)) if (isPhotoUrl(url)) pairs.push({ plate, urls: [url] });
const shared = countPlatesByUrl(pairs);
console.log(`■ 사진 없는 줄에 리셋 전 링크 되돌리기 — 백업에 ${plateUrl.size}대분\n`);

/** 드라이브 폴더 이름 캐시 — 같은 id 를 여러 번 묻지 않는다. */
const nameCache = new Map<string, { name: string; ok: boolean }>();
const targetOf = async (url: string) => {
  const id = driveIdOf(url);
  if (!id) return { name: '', ok: true };            // 드라이브가 아닌 주소(홈페이지)는 이름이 없다
  if (nameCache.has(id)) return nameCache.get(id)!;
  const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=name&supportsAllDrives=true`);
  const v = r ? { name: S(r.name), ok: true } : { name: '', ok: false };
  nameCache.set(id, v);
  return v;
};

// ── ② 공급사 시트 훑기
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let filled = 0; let blocked = 0; let noBackup = 0; let hasPhoto = 0;
const why = new Map<string, number>();
const sample: string[] = [];

for (const f of (found.files || [])) {
  const label = supplierSheetLabel(S(f.name));
  if (WHO && !label.includes(WHO)) continue;
  if (/구버전|폐기/.test(label)) continue;
  const meta = await api(`${SH}/${S(f.id)}?fields=sheets.properties(title,hidden)`);
  const tab = (meta?.sheets || [])
    .filter((s: any) => !s.properties.hidden && !isOurNonInventoryTab(S(s.properties.title)))
    .map((s: any) => S(s.properties.title))[0];
  if (!tab) continue;
  const got = await api(`${SH}/${S(f.id)}/values/${encodeURIComponent(`${a1Tab(tab)}!A1:CZ700`)}`) as { values?: string[][] } | null;
  const rows = ((got?.values || []) as string[][]).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const head = rows[hi];
  const ip = head.indexOf('차량번호');
  const ic = head.findIndex((h) => /사진링크|사진|이미지/.test(h));
  if (ic < 0) continue;

  const updates: { range: string; values: string[][] }[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const plate = plateKey(rows[r][ip]);
    if (!plate) continue;
    const now = S(rows[r][ic]);
    // 차번 셀 링크가 정본이다 — 있으면 그것을 먼저 쓴다(백업은 옛 값이라 뒤로).
    const url = CELL_LINKS[plate] || plateUrl.get(plate);
    if (now && !(OVERWRITE && url && url !== now)) { hasPhoto++; continue; }
    if (!url) { noBackup++; continue; }
    const verdict = judgePhotoLink(plate, url, await targetOf(url), shared.get(url) || 1);
    if (!verdict.fit) {
      blocked++;
      why.set(verdict.why, (why.get(verdict.why) || 0) + 1);
      continue;
    }
    filled++;
    if (sample.length < 8) sample.push(`  ${label} ${plate}  ▶ ${url.slice(0, 62)}`);
    updates.push({ range: `${a1Tab(tab)}!${colA1(ic)}${r + 1}`, values: [[url]] });
  }
  if (APPLY && updates.length) {
    await api(`${SH}/${S(f.id)}/values:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
    console.log(`  ✓ ${label} ${updates.length}줄`);
  }
  await sleep(120);
}

console.log(`\n  채울 수 있는 줄 ${filled} · 문지기가 막은 줄 ${blocked} · 백업에 없는 차 ${noBackup} · 이미 사진 있음 ${hasPhoto}`);
if (why.size) {
  console.log('\n  문지기가 막은 이유:');
  for (const [w, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`     ${w.padEnd(28)} ${n}`);
}
if (sample.length) { console.log('\n  보기:'); sample.forEach((l) => console.log(l)); }
if (!APPLY) console.log('\n  (미리보기다 — 반영하려면 --apply)');
