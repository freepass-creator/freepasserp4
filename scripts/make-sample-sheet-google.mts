/**
 * 샘플 구글시트 — Firestore 원자를 «기존 판매시트와 같은 4탭»으로 올린다(사장님 2026-09-03).
 *   탭 배정 = 발행 파이프라인과 동일: 픽업구독 · 손오공구독(RP012 구독) · 오플구독(RP023) · 상품리스트(나머지).
 *   올릴 수 있는(listable=출고불가 아님) 것만. 새 상태 디테일(분류·이유·올림) + 교정된 차명 + 차량검수.
 * 읽기(Firestore)전용 · 새 시트 생성 + 이전 샘플 휴지통. 기존 판매시트는 안 건드림.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { JWT } from 'google-auth-library';
import { buildSalesFormatRequests, columnWidths } from '../lib/domain/sales-sheet-format';

const S = (v: unknown) => String(v ?? '').trim();
// ★고정 샘플시트 — 매번 새로 만들지 않고 «이 한 시트」를 제자리에서 갱신한다(링크 안 바뀜).
//   env SAMPLE_SHEET_ID 로 덮어쓸 수 있고, 없으면 새로 만들어 ID 를 찍는다(그걸 여기 박으면 고정된다).
const SAMPLE_SHEET_ID = S(process.env.SAMPLE_SHEET_ID) || '1J7dcGCTI0hiHBSdbHx0SqKJKrBg57xkgsX-I8qyfv3c';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (url: string, init?: RequestInit): Promise<any> => {
  for (let attempt = 1; ; attempt++) {
    const tok = (await jwt.getAccessToken()).token;
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const txt = await res.text();
    if (res.ok) return txt ? JSON.parse(txt) : {};
    if ((res.status === 429 || res.status >= 500) && attempt <= 6) { console.warn(`  ${res.status} 재시도 ${attempt}/6…`); await sleep(3000 * attempt); continue; }
    throw new Error(`${res.status} ${url}\n${txt.slice(0, 300)}`);
  }
};

const docs = (await getFirestore().collection('products').get()).docs.map((d) => d.data());
const listable = docs.filter((v) => v.listable === true);

// 탭 배정 — 발행기와 동일 규칙
const tabOf = (v: any): string => {
  const prov = S(v.provider_company_code), pt = S(v.product_type);
  if (prov === 'RP012' && pt === '픽업구독') return '픽업구독';   // 손오공 픽업
  if (prov === 'RP012' && pt.includes('구독')) return '손오공구독'; // 손오공 구독
  if (prov === 'RP023') return '오플구독';                       // 오플 전체(--only=RP023)
  return '상품리스트';                                           // 나머지
};
const TAB_ORDER = ['상품리스트', '손오공구독', '픽업구독', '오플구독'];
const groups: Record<string, any[]> = {};
for (const v of listable) { const t = tabOf(v); (groups[t] = groups[t] || []).push(v); }
const tabs = [...TAB_ORDER.filter((t) => groups[t]?.length), ...Object.keys(groups).filter((t) => !TAB_ORDER.includes(t))];

// ★열은 «기존 판매시트 이름 그대로»(통일) — 상태분류·상태이유·올림 같은 내부값은 안 올린다(우리만 봄).
//   배차상태·구분 이름을 맞춰야 집안 서식이 값별 색을 입힌다.
const money = (v: unknown) => { const n = Number(v); return n ? n.toLocaleString() : ''; };
const rentOf = (price: any, term: number) => (price && typeof price === 'object' && price[String(term)]?.rent != null ? money(price[String(term)].rent) : '');
const depOf = (price: any) => { if (!price || typeof price !== 'object') return ''; const terms = Object.keys(price).map(Number).filter((n) => n).sort((a, b) => b - a); for (const t of terms) if (price[String(t)]?.deposit != null) return money(price[String(t)].deposit); return ''; };
const HEAD = ['배차상태', '구분', '차량번호', '제조사', '모델', '세부모델', '세부트림', '외장', '내장', '연식', 'Km', '연료', '배기량', '차종구분', '장기보증', '12개월', '24개월', '36개월', '48개월', '60개월', '차명(원문)', '옵션(원문)', '원산지', '구동', '인승', '배터리용량', '최초등록', '사진', '정책UID'];
const rowOf = (v: any) => [S(v.status), S(v.product_type), S(v.car_number), S(v.maker), S(v.model), S(v.sub_model), S(v.trim_name), S(v.ext_color), S(v.int_color), S(v.year), S(v.mileage), S(v.fuel_type), S(v.engine_cc), S(v.vehicle_class), depOf(v.price), rentOf(v.price, 12), rentOf(v.price, 24), rentOf(v.price, 36), rentOf(v.price, 48), rentOf(v.price, 60), S(v['원문']?.['차명']), S(v['원문']?.['옵션']), S(v.origin), S(v.drive_type), S(v.seats), S(v.battery_capacity), S(v.first_registration_date), S(v.photo_link), S(v.policy_code)];

console.log('탭 구성:'); for (const t of tabs) console.log(`  ${t} ${groups[t].length}대`);
const total = tabs.reduce((a, t) => a + groups[t].length, 0);

const bodies: Record<string, string[][]> = {};
for (const t of tabs) bodies[t] = groups[t].sort((a, b) => S(a.provider_company_code).localeCompare(S(b.provider_company_code)) || S(a.car_number).localeCompare(S(b.car_number))).map(rowOf);

// 고정 시트를 «제자리 갱신» — 없으면 새로 만든다(그 ID 를 SAMPLE_SHEET_ID 에 박으면 다음부터 고정).
let sheetId = SAMPLE_SHEET_ID;
let fresh = false;
const meta = SAMPLE_SHEET_ID.startsWith('1FZ8placeholder')
  ? null
  : await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`).catch(() => null);
if (!meta) {
  const created = await api('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: JSON.stringify({ properties: { title: '프리패스 — Firestore 상품시트(샘플)' }, sheets: tabs.map((t, i) => ({ properties: { sheetId: i, title: t } })) }) });
  sheetId = created.spreadsheetId; fresh = true;
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=false`, { method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: 'jpkpyh@gmail.com' }) }).catch((e) => console.warn('공유 경고:', e.message));
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) }).catch((e) => console.warn('링크뷰 경고:', e.message));
} else {
  // 필요한 탭이 없으면 추가(제목 고정). 남는 탭은 비운다.
  const have = new Map<string, number>((meta.sheets || []).map((s: any) => [s.properties.title, s.properties.sheetId]));
  const addReqs: any[] = [];
  let nextId = Math.max(0, ...[...have.values()]) + 1;
  for (const t of tabs) if (!have.has(t)) { addReqs.push({ addSheet: { properties: { sheetId: nextId, title: t } } }); have.set(t, nextId); nextId++; }
  if (addReqs.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: addReqs }) });
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: tabs.map((t) => `'${t.replace(/'/g, "''")}'`) }) });
}
const gidOf = (t: string, i: number) => fresh ? i : ((meta.sheets || []).find((s: any) => s.properties.title === t)?.properties.sheetId ?? i);

const data = tabs.map((t) => ({ range: `'${t.replace(/'/g, "''")}'!A1`, values: [HEAD, ...bodies[t]] }));
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });

// ★집안 서식 — Roboto·배차상태색·구분색·헤더·탭색·금액굵기(기존 판매시트와 통일).
const fmt: Record<string, unknown>[] = [];
for (let i = 0; i < tabs.length; i++) {
  const t = tabs[i], gid = fresh ? i : gidOf(t, i);
  fmt.push({ updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
  fmt.push(...buildSalesFormatRequests({ gid, columns: HEAD, widths: columnWidths(HEAD, bodies[t]), tabTitle: t, body: bodies[t] }));
}
for (let i = 0; i < fmt.length; i += 200) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt.slice(i, i + 200) }) });

console.log(`\n★ ${fresh ? '새로 만든' : '제자리 갱신'} 상품시트(${total}대):\nhttps://docs.google.com/spreadsheets/d/${sheetId}/edit`);
if (fresh) console.log(`\n※ 이 ID 를 scripts/make-sample-sheet-google.mts 의 SAMPLE_SHEET_ID 에 박으면 다음부터 이 시트가 고정됩니다:\n   ${sheetId}`);
process.exit(0);
