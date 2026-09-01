/**
 * F03 차종마스터 — 검수·AI 의견칸만 쓴다. 이름 7열(원산지~생산종료)은 절대 안 씀.
 * 기본 dry-run. 반영 `--apply`. 여러 행이 맞으면 `--all` 없으면 멈춘다.
 *
 *   npx tsx scripts/write-encar-master-review.mts --who=커서 --value="맞음"
 *   npx tsx scripts/write-encar-master-review.mts --who=클로드 --value="못정함 · 엔카 대조 전" --sub="G80 RG3"
 *   npx tsx scripts/write-encar-master-review.mts --apply --who=검수 --value=갈림 --row=2
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  ENCAR_MASTER_SHEET_ID,
  ENCAR_MASTER_TAB,
  ENCAR_NAME_COLUMNS,
  ENCAR_REVIEW_COLUMNS,
  ENCAR_REVIEW_WHO_ALIAS,
  loadEncarWorkSheetGrids,
} from '../lib/domain/encar-master-sheet';
import { assertNotLiveVehicleMasterWrite } from '../lib/domain/legacy-sheets';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const arg = (k: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : '';
};
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (url: string, init?: RequestInit) => {
  const tok = (await jwt.getAccessToken()).token;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json() as Record<string, any>;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};
assertNotLiveVehicleMasterWrite(ENCAR_MASTER_SHEET_ID, 'review write');

const WHO_RAW = S(arg('who'));
const WHO = (ENCAR_REVIEW_WHO_ALIAS[WHO_RAW] || ENCAR_REVIEW_WHO_ALIAS[WHO_RAW.toLowerCase()] || WHO_RAW) as string;
const VALUE = arg('value');
const ROW = Number(arg('row') || 0);
const maker = S(arg('maker'));
const model = S(arg('model'));
const sub = S(arg('sub'));
const trim = S(arg('trim'));
if (!WHO || !ENCAR_REVIEW_COLUMNS.includes(WHO as typeof ENCAR_REVIEW_COLUMNS[number])) {
  throw new Error(`--who= 는 ${ENCAR_REVIEW_COLUMNS.join(' · ')} (별칭 ${Object.keys(ENCAR_REVIEW_WHO_ALIAS).join(' · ')})`);
}
if (!VALUE) throw new Error('--value= 의견값이 없다');

const colA1 = (i: number) => {
  let t = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); }
  return t;
};

const grids = await loadEncarWorkSheetGrids(api);
const hdr = (grids.names[0] || []).map(S);
const nameN = ENCAR_NAME_COLUMNS.length;
if (hdr.slice(0, nameN).join('|') !== ENCAR_NAME_COLUMNS.join('|')) {
  throw new Error(`이름 7열이 다름: ${hdr.join(' | ')}`);
}
const whoAt = hdr.findIndex((h) => h === WHO);
if (whoAt < 0) throw new Error(`검수칸 없음: ${hdr.join(' | ')}`);
if (whoAt < nameN) throw new Error('이름 7열에는 못 쓴다');

const idx = (name: string) => hdr.findIndex((h) => h === name);
const iMaker = idx('제조사');
const iModel = idx('모델');
const iSub = idx('세부모델');
const iTrim = idx('세부트림');
const hits: { sheetRow: number; label: string }[] = [];
(grids.names || []).forEach((raw, r) => {
  if (r === 0) return;
  const row = (raw || []).map(S);
  if (ROW && r + 1 !== ROW) return;
  if (maker && row[iMaker] !== maker) return;
  if (model && row[iModel] !== model) return;
  if (sub && row[iSub] !== sub) return;
  if (trim && row[iTrim] !== trim) return;
  if (!ROW && !maker && !model && !sub && !trim) return;
  hits.push({ sheetRow: r + 1, label: `${row[iMaker]} ${row[iModel]} ${row[iSub]} / ${row[iTrim]}` });
});
if (!hits.length) throw new Error('맞는 행이 없다. --maker --model --sub --trim 또는 --row=');
if (hits.length > 1 && !ALL) {
  console.log(`여러 행 ${hits.length} — 표본`);
  hits.slice(0, 12).forEach((h) => console.log(`  ${h.sheetRow}  ${h.label}`));
  if (hits.length > 12) console.log(`  … +${hits.length - 12}`);
  throw new Error('여러 행. 한 줄은 --row=, 전부는 --all');
}

console.log(`■ 의견칸 「${WHO}」 ← ${VALUE.slice(0, 80)} ${APPLY ? '반영' : '미리보기'} · ${hits.length}행`);
hits.slice(0, 8).forEach((h) => console.log(`  ${h.sheetRow}  ${h.label}`));
if (!APPLY) {
  console.log('※ dry-run. 반영은 --apply. 이름 7열은 안 씀.');
  process.exit(0);
}

const data = hits.map((h) => ({
  range: `'${ENCAR_MASTER_TAB}'!${colA1(whoAt)}${h.sheetRow}`,
  values: [[VALUE]],
}));
const SH = `https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}`;
for (let i = 0; i < data.length; i += 400) {
  await api(`${SH}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 400) }),
  });
}
console.log(`반영 ${hits.length}행 · 칸 ${WHO}만`);
