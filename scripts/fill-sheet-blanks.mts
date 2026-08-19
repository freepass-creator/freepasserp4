/**
 * **공급사 시트의 빈 칸을 우리가 아는 값으로 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 공급사가 준 시트에 제조사·분류·연식이 통째로 없는 곳이 있다(렌트존·에코렌트카·스위치플랜).
 * 사람이 서른 칸을 손으로 치게 두지 않는다 — 우리가 아는 것부터 채우고, 모르는 것만 남긴다.
 *
 * ★**빈 칸만** 채운다. 값이 있으면 손대지 않는다.
 * ★지어내지 않는다 — 근거가 있는 것만 채운다.
 *     제조사  차명(트림)에 든 모델 이름을 **차종마스터**에서 찾아 그 제조사를 쓴다.
 *     연식    최초등록일의 연도(「22-03」 → 2022). 최초등록일이 없으면 비워 둔다.
 *     분류    주행거리로 신차/중고를 가르고(1,000km 미만이면 신차), 렌트/구독은
 *             같은 시트의 다른 줄이 쓰는 쪽을 따른다. 그것도 없으면 렌트로 둔다.
 *             ⚠ 이건 «추정»이다. 공급사가 고치라고 색이 붙은 칸에 넣는다.
 *
 *   npx tsx scripts/fill-sheet-blanks.mts
 *   npx tsx scripts/fill-sheet-blanks.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isVehicleTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).trim();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
/**
 * ⚠ 시트 API 는 «분당 읽기» 쿼터가 있고 가끔 503 을 낸다. 공급사 20곳을 연달아 읽으면
 *   중간에 끊기고, 그때까지 채운 것만 반영된 채 나머지는 조용히 안 채워진다.
 *   재시도를 붙여 «끝까지 돌거나, 못 돌면 알리거나» 둘 중 하나가 되게 한다.
 */
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      const wait = Math.min(60_000, 5_000 * 2 ** n);
      console.log(`  … ${res.status} — ${Math.round(wait / 1000)}초 쉬고 다시`);
      await new Promise((ok) => setTimeout(ok, wait));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

/** 차종마스터 — 모델·세부모델 이름 → 제조사. 긴 이름부터 본다(「K5」가 「K5 하이브리드」를 이기면 안 된다). */
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const entries = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as Rec[];
const makerByName = new Map<string, string>();
for (const e of entries) {
  const maker = S(e.maker);
  if (!maker) continue;
  for (const n of [e.sub_model, e.model].map(S).filter(Boolean)) {
    const key = norm(n);
    if (key.length >= 2 && !makerByName.has(key)) makerByName.set(key, maker);
  }
}
const names = [...makerByName.keys()].sort((a, b) => b.length - a.length);
const makerOf = (carName: string): string => {
  const blob = norm(carName);
  if (!blob) return '';
  for (const n of names) if (blob.includes(n)) return makerByName.get(n)!;
  return '';
};
const yearOf = (first: string): number | '' => {
  const t = S(first);
  const m = t.match(/^(\d{4})/) || t.match(/^(\d{2})[-./]/);
  if (!m) return '';
  const n = Number(m[1]);
  return n >= 1000 ? n : 2000 + n;
};

const A = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const files = ((await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`)).files || []) as Rec[];

console.log(`■ 시트 빈 칸 채우기 ${APPLY ? '(반영)' : '(dry-run)'} — 마스터 이름 ${names.length}개\n`);
let total = 0; const unknown: string[] = [];
for (const f of files) {
  const label = supplierSheetLabel(f.name);
  if (ONLY && !label.includes(ONLY)) continue;
  // 재고 탭은 한 장이 아닐 수 있다 — 렌트·구독을 나눈 공급사는 두 장이다.
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}?fields=sheets.properties.title`);
  const tabs = ((meta.sheets || []) as Rec[]).map((sh) => S(sh.properties?.title)).filter(isVehicleTab);
  for (const TAB of tabs) {
  const vals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`${TAB}!A1:BZ600`)}`);
  const rows = ((vals.values || []) as string[][]);
  const hdr = (rows[0] || []).map(S);
  const i = (n: string) => hdr.indexOf(n);
  const iPlate = i('차량번호'); const iMaker = i('제조사'); const iName = i('차명(트림)');
  const iYear = i('연식'); const iFirst = i('최초등록일'); const iType = i('분류'); const iKm = i('주행거리');
  if (iPlate < 0) continue;
  const body = rows.slice(1);

  /** 렌트인가 구독인가 — 같은 시트가 이미 쓰는 쪽을 따른다. 우리가 정할 값이 아니다. */
  const kinds = body.map((r) => S(r[iType])).filter(Boolean);
  const subs = kinds.filter((x) => /구독/.test(x)).length;
  const mode = subs > kinds.length / 2 ? '구독' : '렌트';

  const writes: { range: string; values: string[][] }[] = [];
  let mk = 0; let yr = 0; let tp = 0;
  body.forEach((r, k) => {
    const rowNo = k + 2;
    if (!S(r[iPlate])) return;
    if (iMaker >= 0 && !S(r[iMaker])) {
      const m = makerOf(S(r[iName]));
      if (m) { writes.push({ range: `${TAB}!${A(iMaker)}${rowNo}`, values: [[m]] }); mk++; }
      else if (S(r[iName]) && unknown.length < 10) unknown.push(`${label} ${S(r[iPlate])} 「${S(r[iName]).slice(0, 20)}」`);
    }
    if (iYear >= 0 && !S(r[iYear]) && iFirst >= 0) {
      const y = yearOf(S(r[iFirst]));
      if (y) { writes.push({ range: `${TAB}!${A(iYear)}${rowNo}`, values: [[String(y)]] }); yr++; }
    }
    if (iType >= 0 && !S(r[iType])) {
      const km = Number(S(r[iKm]).replace(/[^\d]/g, '')) || 0;
      const isNew = km > 0 ? km < 1000 : false;
      writes.push({ range: `${TAB}!${A(iType)}${rowNo}`, values: [[`${isNew ? '신차' : '중고'}${mode}`]] });
      tp++;
    }
  });
  if (!writes.length) continue;
  total += writes.length;
  console.log(`  ${`${label}/${TAB}`.padEnd(18)}제조사 ${String(mk).padStart(2)} · 연식 ${String(yr).padStart(2)} · 분류 ${String(tp).padStart(2)}`);
  if (!APPLY) continue;
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes }),
  });
  }
}
console.log(`\n  채울 칸 ${total}개`);
if (unknown.length) {
  console.log('\n  ★차명으로 제조사를 못 찾은 차 — 마스터에 없는 이름이다');
  for (const u of unknown) console.log(`     ${u}`);
}
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
