/**
 * 정제칸 모델·세부모델·세부트림을 라이브 「차종마스터」 행만 남긴다. 읽기 기본, `--apply` 로 씀.
 *
 * 손오공: 빈 칸만 손오공-정제 유일 매칭을 넣는다. 이미 있는 칸은 안 덮고 안 비운다.
 * 그 외 공급사: 지금 칸을 폐쇄만 하되, **이미 적힌 값은 안 비움**(한 번 채우면 끝).
 * 예외: 원문 없는 `디 올 뉴`만 스냅 철자로 되돌린다.
 *
 *   npx tsx scripts/close-refined-names-to-live-master.mts
 *   npx tsx scripts/close-refined-names-to-live-master.mts --apply
 */
import { existsSync, readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { INCLUDE_MIRROR, isMirrorSheet } from '../lib/domain/mirror-sources';
import { isLegacySheetId } from '../lib/domain/legacy-sheets';
import { closeNamesToLiveMaster, isDiAllNewUpgrade } from '../lib/domain/live-master-name-copy';
import { MASTER_SHEET_ID, MASTER_TAB, readMasterSheet } from '../lib/domain/vehicle-master-sheet';
import { composeRefinedVehicleName } from '../lib/domain/vehicle-class';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, LEGACY_SHEET_PREFIX, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const ONLY = new Set(arg('who').split(/[,\s]+/).map(S).filter(Boolean));
const SONO = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
let gT = '';
const tok = async () => { gT = (await jwt.getAccessToken()).token || ''; return gT; };
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    await tok();
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      await sleep(Math.min(60_000, 5_000 * 2 ** n));
      continue;
    }
    throw new Error(S((body as { error?: { message?: string } }).error?.message) || `HTTP ${res.status}`);
  }
};

const masterGrid = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(`'${MASTER_TAB}'`)}`)) as { values?: string[][] }).values || [];
const BOOK = readMasterSheet(masterGrid);
const refinePath = existsSync('sonokong/tmp/손오공정제.json') ? 'sonokong/tmp/손오공정제.json' : 'sonokong/tmp/손오공정제.json';
const refineMap = new Map<string, { 제조사?: string; 모델?: string; 세부모델?: string; 세부트림?: string }>();
try {
  const j = JSON.parse(readFileSync(refinePath, 'utf8')) as { 결과?: Rec[] };
  for (const r of j.결과 || []) refineMap.set(S(r.차번).replace(/\s/g, ''), {
    제조사: S(r.제조사), 모델: S(r.모델), 세부모델: S(r.세부모델), 세부트림: S(r.세부트림),
  });
} catch { /* 손오공 정제 json 없으면 폐쇄만 */ }

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const targets: { name: string; id: string }[] = [];
for (const f of ((found.files || []) as Rec[])) {
  const nm = S(f.name);
  const who = companyAlias(supplierSheetLabel(nm)) || supplierSheetLabel(nm);
  if (nm.startsWith(LEGACY_SHEET_PREFIX) || /구버전/.test(nm) || isLegacySheetId(S(f.id))) continue;
  if (!INCLUDE_MIRROR && isMirrorSheet(S(f.id))) continue;
  if (ONLY.size && ![...supplierNameKeys(who)].some((k) => ONLY.has(k))) continue;
  targets.push({ name: who, id: S(f.id) });
}
if (!targets.some((t) => t.id === SONO) && (!ONLY.size || [...ONLY].some((k) => /손오공/.test(k)))) {
  targets.push({ name: '손오공', id: SONO });
}
targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

console.log(`■ 라이브 행 폐쇄 ${APPLY ? '반영' : '미리보기'} · 마스터 ${BOOK.rows.length}줄 · 손오공 정제 ${refineMap.size}대 · 대상 ${targets.length}곳`);

let tot = 0;
for (const t of targets) {
  await sleep(400);
  let meta: Rec;
  try {
    meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=${encodeURIComponent('sheets.properties(sheetId,title,hidden)')}`);
  } catch (e) { console.log(`  ✗ ${t.name} — ${String((e as Error).message).slice(0, 80)}`); continue; }
  const tabTitles = ((meta.sheets || []) as Rec[])
    .filter((s) => !(s as { properties?: { hidden?: boolean } }).properties?.hidden && !isOurNonInventoryTab(S((s as { properties?: { title?: string } }).properties?.title)))
    .map((s) => S((s as { properties?: { title?: string } }).properties?.title)).filter(Boolean);
  if (!tabTitles.length) continue;
  const qs = tabTitles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&');
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchGet?${qs}&majorDimension=ROWS`);
  const updates: { range: string; values: string[][] }[] = [];
  let n = 0;
  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = tabTitles[ti];
    const grid = ((vr as { values?: string[][] }).values || []);
    const hRow = grid.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
    if (hRow < 0) return;
    const hdr = (grid[hRow] || []).map(S);
    const at = (name: string) => hdr.indexOf(name);
    const pi = at('차량번호'), mi = at('모델'), si = at('세부모델'), ti2 = at('세부트림');
    if (pi < 0 || mi < 0 || si < 0) return;
    const makerI = at('제조사(정제)') >= 0 ? at('제조사(정제)') : at('제조사');
    const nameI = at('차명(정제)');
    for (let r = hRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const plate = S(row[pi]);
      if (!plate) continue;
      const want: Record<string, string> = {
        '제조사(정제)': makerI >= 0 ? S(row[makerI]) : '',
        '모델': S(row[mi]),
        '세부모델': S(row[si]),
        '세부트림': ti2 >= 0 ? S(row[ti2]) : '',
      };
      const sheetBefore = `${S(row[mi])}\t${S(row[si])}\t${ti2 >= 0 ? S(row[ti2]) : ''}`;
      if (t.id === SONO) {
        const hit = refineMap.get(plate.replace(/\s/g, ''));
        // 빈 칸만 정제 결과로 채운다. 이미 있는 칸을 빈 세부모델로 지우지 않는다(한 번 채우면 끝).
        if (hit?.모델) {
          if (hit.제조사 && !want['제조사(정제)']) want['제조사(정제)'] = hit.제조사;
          if (!want['모델']) want['모델'] = hit.모델;
          if (!want['세부모델'] && hit.세부모델) want['세부모델'] = hit.세부모델;
          if (!want['세부트림'] && hit.세부트림) want['세부트림'] = hit.세부트림;
        }
      }
      closeNamesToLiveMaster(want, BOOK.rows);
      const keep = (now: string, next: string) => {
        if (!now) return next;
        if (isDiAllNewUpgrade(next, now)) return next;
        return now;
      };
      want['모델'] = keep(S(row[mi]), want['모델']);
      want['세부모델'] = keep(S(row[si]), want['세부모델']);
      if (ti2 >= 0) want['세부트림'] = keep(S(row[ti2]), want['세부트림']);
      const after = `${want['모델']}\t${want['세부모델']}\t${want['세부트림']}`;
      const composed = composeRefinedVehicleName(want['모델'], want['세부모델'], want['세부트림']);
      const nameNow = nameI >= 0 ? S(row[nameI]) : '';
      const nameDirty = nameI >= 0 && !!composed && isDiAllNewUpgrade(composed, nameNow);
      // 축이 같아도 차명(정제)에 원문 없는 디올뉴가 남아 있으면 덮는다(손오공 68로3386).
      if (sheetBefore === after && !nameDirty) continue;
      n++;
      tot++;
      if (n <= 8) console.log(`    ${t.name} ${plate}  ${sheetBefore.replace(/\t/g, ' / ')} → ${after.replace(/\t/g, ' / ') || '(빈칸)'}${nameDirty ? ` · 차명(정제) 「${nameNow}」→「${composed}」` : ''}`);
      const put = (col: number, val: string) => {
        if (col < 0) return;
        updates.push({ range: `${a1Tab(title)}!${colA1(col)}${r + 1}`, values: [[val]] });
      };
      put(mi, want['모델']);
      put(si, want['세부모델']);
      if (ti2 >= 0) put(ti2, want['세부트림']);
      if (nameI >= 0 && (!nameNow || nameDirty)) put(nameI, composed);
    }
  });
  console.log(`  ${t.name}  ${n}대`);
  if (APPLY && updates.length) {
    for (let i = 0; i < updates.length; i += 400) {
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates.slice(i, i + 400) }),
      });
      await sleep(300);
    }
  }
}
console.log(`\n  ${APPLY ? '반영' : '미리보기'} ${tot}대. ${APPLY ? '' : '쓰려면 --apply  (정제시트는 --include-mirror)'}`);
