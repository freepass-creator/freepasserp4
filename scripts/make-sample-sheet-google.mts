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

const S = (v: unknown) => String(v ?? '').trim();
const OLD_SAMPLE = '13L1xYYChJNweVFw54uQWWHyak5cPFn4ary-toT-XKJM';   // 직전 샘플 → 휴지통
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

const repRent = (price: any) => {
  if (!price || typeof price !== 'object') return ['', '', ''];
  const terms = Object.keys(price).map(Number).filter((n) => n).sort((a, b) => a - b);
  const t = terms[terms.length - 1]; if (!t) return ['', '', ''];
  const o = price[String(t)] || {};
  return [String(t), String(o.rent ?? ''), String(o.deposit ?? '')];
};
const HEAD = ['배차상태', '상태분류', '상태이유', '올림', '구분', '차량번호', '제조사', '모델', '세부모델', '세부트림', '연식', '연료', '배기량', '차종구분', '외장', '내장', '주행km', '최초등록', '대표개월', '월대여료', '보증금', '차명(원문)', '원산지', '구동', '인승', '공급사', '확정', '검수상태'];
const rowOf = (v: any) => { const [term, rent, dep] = repRent(v.price); return [S(v.status), S(v.status_kind), S(v.status_reason), v.listable ? 'O' : 'X', S(v.product_type), S(v.car_number), S(v.maker), S(v.model), S(v.sub_model), S(v.trim_name), S(v.year), S(v.fuel_type), S(v.engine_cc), S(v.vehicle_class), S(v.ext_color), S(v.int_color), S(v.mileage), S(v.first_registration_date), term, rent, dep, S(v['원문']?.['차명']), S(v.origin), S(v.drive_type), S(v.seats), S(v.provider_company_code), S(v['확정']), S(v['검수상태'])]; };

console.log('탭 구성:'); for (const t of tabs) console.log(`  ${t} ${groups[t].length}대`);
const total = tabs.reduce((a, t) => a + groups[t].length, 0);

const created = await api('https://sheets.googleapis.com/v4/spreadsheets', {
  method: 'POST',
  body: JSON.stringify({ properties: { title: `프리패스 샘플 — 올릴수있는 ${total}대 · 상태디테일 (${new Date().toISOString().slice(0, 16).replace('T', ' ')})` }, sheets: tabs.map((t, i) => ({ properties: { sheetId: i, title: `${t} ${groups[t].length}` } })) }),
});
const sheetId = created.spreadsheetId;
const data = tabs.map((t, i) => ({ range: `'${(t + ' ' + groups[t].length).replace(/'/g, "''")}'!A1`, values: [HEAD, ...groups[t].sort((a, b) => S(a.provider_company_code).localeCompare(S(b.provider_company_code)) || S(a.car_number).localeCompare(S(b.car_number))).map(rowOf)] }));
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: tabs.map((_, i) => ({ updateSheetProperties: { properties: { sheetId: i, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } })) }) });
await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=false`, { method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: 'jpkpyh@gmail.com' }) }).catch((e) => console.warn('공유 경고:', e.message));
await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) }).catch((e) => console.warn('링크뷰 경고:', e.message));
// 이전 6탭 샘플 휴지통
await api(`https://www.googleapis.com/drive/v3/files/${OLD_SAMPLE}?supportsAllDrives=true`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) }).then(() => console.log('이전 샘플 휴지통 처리됨')).catch((e) => console.warn('이전 샘플 정리 경고:', e.message));

console.log(`\n★ 새 샘플시트:\nhttps://docs.google.com/spreadsheets/d/${sheetId}/edit`);
process.exit(0);
