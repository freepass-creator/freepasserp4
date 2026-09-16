/**
 * 진단 전용(읽기만) — F01 판매시트 최신 탭의 「구분」 칸 실제 값과 조건부서식(TEXT_EQ) 목록을 찍는다.
 * 사장님 2026-09-16 「신차렌트 중고렌트 왜 색깔 안입혀주냐」— 코드는 고쳤는데 실제 시트에 왜 안 보이는지
 * 추측 대신 실측한다. 아무것도 쓰지 않는다.
 *   npx tsx scripts/diag-f01-type-colors.mts
 */
type Rec = Record<string, any>;
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sheets.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'], subject: 'pyh@teamjpk.com' });
const call = async (u: string): Promise<Rec> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
};
const SHEET = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets(properties(sheetId,title,index),conditionalFormats)`);
const sheets = (meta.sheets || []) as Rec[];
// 판매시트 발행 탭은 인덱스가 가장 앞(AT=0 근처)이고 제목에 "상품리스트"류 이름을 쓴다 — 가장 왼쪽 탭을 본다.
const sorted = [...sheets].sort((a, b) => Number(a.properties?.index) - Number(b.properties?.index));
const main = sorted[0];
console.log(`■ 대상 탭: 「${main.properties?.title}」 (gid=${main.properties?.sheetId}, index=${main.properties?.index})`);
console.log(`■ 전체 탭 목록: ${sheets.map((s) => `${s.properties?.title}(${s.properties?.index})`).join(' · ')}`);

const hdr = ((await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`'${main.properties?.title}'!A1:BZ1`)}`)).values || [])[0] || [];
const gubunCol = hdr.findIndex((c: string) => S(c) === '구분');
console.log(`■ 헤더에서 「구분」 칸 위치: ${gubunCol}(0-base), 전체 헤더: ${JSON.stringify(hdr)}`);

if (gubunCol >= 0) {
  const colLetter = String.fromCharCode(65 + gubunCol); // 26칸 이내 가정
  const vals = ((await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`'${main.properties?.title}'!${colLetter}2:${colLetter}30`)}`)).values || []).map((r: string[]) => r[0]);
  console.log(`■ 「구분」 칸 실제 값(2~30행 샘플): ${JSON.stringify(vals)}`);
}

const cfs = (main.conditionalFormats || []) as Rec[];
console.log(`■ 이 탭 조건부서식 총 개수: ${cfs.length}`);
const onGubun = cfs.filter((c) => (c.ranges || []).some((r: Rec) => r.startColumnIndex === gubunCol));
console.log(`■ 「구분」 칸(col=${gubunCol}) 범위를 가리키는 조건부서식: ${onGubun.length}개`);
for (const c of onGubun) {
  const cond = c.booleanRule?.condition;
  const fg = c.booleanRule?.format?.textFormat?.foregroundColorStyle?.rgbColor || c.booleanRule?.format?.textFormat?.foregroundColor;
  console.log(`  - TEXT_EQ=${JSON.stringify(cond?.values)} fg=${JSON.stringify(fg)}`);
}
