/**
 * 원천대장 「차종마스터_규격검토」에 아반떼 CN8 검토 행을 넣는다.
 * 라이브 「차종마스터」 탭에는 쓰지 않는다. 트림행키(mf-)는 발급하지 않는다.
 *
 *   npx tsx scripts/append-cn8-review.mts
 *   npx tsx scripts/append-cn8-review.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MASTER_SHEET_ID } from '../lib/domain/legacy-sheets';
import { VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS } from '../lib/domain/vehicle-master-review-promotion';
import { assertNotLiveVehicleMasterTabWrite } from '../lib/domain/vehicle-master-lock';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const TAB = '차종마스터_규격검토';

assertNotLiveVehicleMasterTabWrite(MASTER_SHEET_ID, TAB);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const token = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Sheets HTTP ${res.status}: ${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : {};
};

const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const got = await api(`${base}/values/${encodeURIComponent(`'${TAB}'!A:X`)}`);
const rows = (got.values || []) as unknown[][];
if (!rows.length) throw new Error('규격검토가 비었다');
const headers = rows[0].map(S);
if (headers.join('\u0000') !== VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS.join('\u0000')) {
  throw new Error(`규격검토 헤더가 계약과 다르다: ${headers.join(' · ')}`);
}
const col = (name: string) => headers.indexOf(name);
const cell = (row: unknown[], name: string) => S(row[col(name)]);

const existing = rows.slice(1).filter((row) => cell(row, '모델') === '아반떼' && /CN8/.test(cell(row, '세부모델')));
console.log(`■ 아반떼 CN8 규격검토 ${APPLY ? '반영' : '미리보기'} — 이미 ${existing.length}행`);

const sample = rows.slice(1).find((row) => cell(row, '세부모델') === '팰리세이드 LX3')
  || rows.slice(1).find((row) => cell(row, '세부모델') === '아반떼 CN7');
if (sample) {
  console.log(`  참고 행: ${cell(sample, '세부모델')} · 분류 ${cell(sample, '차종분류')} · 차체 ${cell(sample, '차체형태')} · 상태 ${cell(sample, '검증상태')}`);
}

if (existing.length) {
  for (const row of existing.slice(0, 8)) {
    console.log(`  있음 ${cell(row, '세부모델')} · ${cell(row, '연료')} · ${cell(row, '세부트림')} · ${cell(row, '검증상태')}`);
  }
  process.exit(0);
}

const variants: { fuel: string; trim: string }[] = [];
for (const fuel of ['가솔린', '하이브리드'] as const) {
  for (const trim of ['모던', '프리미엄', '인스퍼레이션']) variants.push({ fuel, trim });
}

const blank = headers.map(() => '');
const out = variants.map((v) => {
  const row = [...blank];
  const set = (name: string, value: string) => { row[col(name)] = value; };
  set('제조국', '국산');
  set('제조사', '현대');
  set('모델', '아반떼');
  set('세부모델', '아반떼 CN8');
  set('세부트림', v.trim);
  set('연료', v.fuel);
  set('차종분류', '준중형');
  set('차체형태', '세단');
  set('연식시작', '2026');
  set('연식종료', '현재');
  set('기존 세부모델', '디 올 뉴 아반떼');
  set('검증상태', '검토필요');
  set('확인필요항목', '공식 트림·배기량 확정');
  set('확인질문', 'CN8 공식 가격표의 트림·배기량과 같은가');
  return row;
});

console.log(`  넣을 행 ${out.length} — 세부모델 아반떼 CN8 · 트림행키 없음 · 검증상태 검토필요`);
for (const row of out) console.log(`    ${cell(row, '연료')} ${cell(row, '세부트림')}`);

if (!APPLY) {
  console.log('\n  dry-run. 반영은 --apply');
  process.exit(0);
}

const written = await api(
  `${base}/values/${encodeURIComponent(`'${TAB}'!A:X`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
  { method: 'POST', body: JSON.stringify({ values: out }) },
);
console.log(`  반영 ${S(written.updates?.updatedRange)} · ${written.updates?.updatedRows || out.length}행`);
