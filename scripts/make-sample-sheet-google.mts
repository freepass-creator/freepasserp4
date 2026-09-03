/**
 * Firestore 원자 → «기존 판매시트와 동일한」 샘플 구글시트 (사장님 2026-09-03 「기존 시트 동일하게」).
 *   ★열은 기존 판매시트(1Y1Mx…)의 각 탭 헤더를 «런타임에 읽어» 그대로 쓴다(열 이름·순서 100% 동일).
 *   값 = Firestore 원자 + 정책(v4/policies, policy_code 조인). 구독 요금은 원자 price 의 반납/인수/km 키로.
 *   올릴 수 있는(listable=출고불가 아님) 것만. 집안 서식(Roboto·배차상태색). 고정 시트 제자리 갱신(링크 안 바뀜).
 * 읽기(Firestore·기존시트 헤더)전용 + 고정 샘플시트 쓰기.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { JWT } from 'google-auth-library';
import { buildSalesFormatRequests, columnWidths } from '../lib/domain/sales-sheet-format';

const S = (v: unknown) => String(v ?? '').trim();
const SAMPLE_SHEET_ID = S(process.env.SAMPLE_SHEET_ID) || '1J7dcGCTI0hiHBSdbHx0SqKJKrBg57xkgsX-I8qyfv3c';
const SRC_SHEET = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';   // 기존 판매시트 — 헤더를 여기서 읽는다
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
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

// ── 데이터 ──
const db = getDatabase();
const policies = (await db.ref('v4/policies').get()).val() as Record<string, any> || {};
const polByCode = new Map<string, any>();     // policy_code 필드
const polByKey = new Map<string, any>();      // 노드 키
const polByProvider = new Map<string, any>(); // 공급사 기본정책(FP-{공급사}-RENT) 폴백용
for (const [k, p] of Object.entries(policies)) {
  if (!p || typeof p !== 'object') continue;
  polByKey.set(k, p);
  if (S((p as any).policy_code)) polByCode.set(S((p as any).policy_code), p);
  const prov = S((p as any).provider_company_code);
  if (prov && /RENT/i.test(k)) polByProvider.set(prov, p);   // 공통 렌트 정책을 그 공급사 기본으로
}
const policyOf = (v: any) => polByCode.get(S(v.policy_code)) || polByKey.get(S(v.policy_code)) || polByProvider.get(S(v.provider_company_code)) || {};
const docs = (await getFirestore().collection('products').get()).docs.map((d) => d.data());
const listable = docs.filter((v) => v.listable === true);

// 탭 배정 = 발행기 규칙
const tabOf = (v: any): string => {
  const prov = S(v.provider_company_code), pt = S(v.product_type);
  if (prov === 'RP012' && pt === '픽업구독') return '픽업구독';
  if (prov === 'RP012' && pt.includes('구독')) return '손오공구독';
  if (prov === 'RP023') return '오플구독';
  return '상품리스트';
};
const TAB_ORDER = ['상품리스트', '손오공구독', '픽업구독', '오플구독'];
const groups: Record<string, any[]> = {};
for (const v of listable) { const t = tabOf(v); (groups[t] = groups[t] || []).push(v); }

// ── 기존 판매시트에서 각 탭 헤더를 읽는다(열 100% 동일) ──
const srcMeta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC_SHEET}?fields=sheets.properties(title)`);
const srcTitle = (want: string) => (srcMeta.sheets || []).map((s: any) => s.properties.title).find((t: string) => t.startsWith(want)) || want;
const headerCache: Record<string, string[]> = {};
for (const t of TAB_ORDER) {
  const title = srcTitle(t);
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC_SHEET}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ1`)}`);
  headerCache[t] = ((v.values || [[]])[0] as string[]).map(S).filter(Boolean);
}

// ── 열 이름 → 값 ──
const money = (v: unknown) => { const n = Number(v); return n ? n.toLocaleString() : ''; };
const priceCell = (price: any, col: string): string => {
  if (!price || typeof price !== 'object') return '';
  const P = price as Record<string, any>;
  const rentK = (k: string) => (P[k]?.rent != null ? money(P[k].rent) : '');
  const depAny = (suffix = '') => { for (const t of ['60', '48', '36', '24', '12']) { const k = suffix ? `${t}${suffix}` : t; if (P[k]?.deposit != null) return money(P[k].deposit); } return ''; };
  const m = col.match(/(\d+)개월/);
  if (/보증금\s*반납형|^보증금$|장기보증/.test(col)) return depAny();
  if (/보증금\s*인수형/.test(col)) return depAny('_인수형');
  if (m) {
    const n = m[1];
    if (/인수형/.test(col)) return rentK(`${n}_인수형`);
    if (/반납형/.test(col)) return rentK(n);
    if (/2만/.test(col)) return rentK(`${n}_2만`);
    if (/3만/.test(col)) return rentK(`${n}_3만`);
    return rentK(n);   // 상품리스트 N개월
  }
  return '';
};
const cardYN = (pm: string) => (/카드/.test(pm) ? '가능' : '');
// 정책 스키마 둘 다 흡수 — `*_legacy` 결합필드 우선, 없으면 «한도 / 자기부담」 분리필드로 조립.
const G = (pol: any, ...keys: string[]) => { for (const k of keys) if (S(pol[k])) return S(pol[k]); return ''; };
const combine = (pol: any, legacy: string, limit: string[], ded: string[]) => {
  const L = G(pol, legacy); if (L) return L;
  const a = G(pol, ...limit), b = G(pol, ...ded);
  return [a, b].filter(Boolean).join(' / ');
};
const cell = (col: string, v: any): string => {
  const pol = policyOf(v);
  const direct: Record<string, string> = {
    '배차상태': S(v.status), '구분': S(v.product_type), '차량번호': S(v.car_number),
    '제조사': S(v.maker), '모델': S(v.model), '세부모델': S(v.sub_model), '세부트림': S(v.trim_name),
    '외장': S(v.ext_color), '내장': S(v.int_color), '연식': S(v.year), 'Km': S(v.mileage),
    '연료': S(v.fuel_type), '배기량': S(v.engine_cc), '차종구분': S(v.vehicle_class),
    '차명(원문)': S(v['원문']?.['차명']), '옵션(원문)': S(v['원문']?.['옵션']),
    '원산지': S(v.origin), '구동': S(v.drive_type), '인승': S(v.seats), '배터리용량': S(v.battery_capacity),
    '최초등록': S(v.first_registration_date), '차고지': S(v.location), '사진': S(v.photo_link),
    '정책UID': S(v.policy_code),
    '대인': combine(pol, 'personal_injury_limit_deductible_legacy', ['injury_compensation_limit', 'personal_injury_compensation_limit'], ['injury_deductible', 'personal_injury_deductible']),
    '대물': combine(pol, 'property_limit_deductible_legacy', ['property_compensation_limit'], ['property_deductible']),
    '자손': combine(pol, 'self_body_limit_deductible_legacy', ['self_body_accident', 'self_body_compensation_limit'], ['self_body_deductible']),
    '무보험': combine(pol, 'uninsured_limit_deductible_legacy', ['uninsured_damage', 'uninsured_compensation_limit'], ['uninsured_deductible']),
    '자차': combine(pol, 'own_damage_limit_deductible_legacy', ['own_damage_compensation'], ['own_damage_min_deductible']),
    '심사조건': S(pol.screening_criteria), '대여지역': S(pol.rental_region),
    '1만+': S(pol.mileage_upcharge_per_10000km),
    '대여료 카드결제': cardYN(S(pol.payment_method)), '보증금 카드결제': cardYN(S(pol.payment_method)),
    '중도해지 1년미만': S(pol.penalty_condition), '중도해지 1년이상': S(pol.penalty_condition),
    '승계': S(pol.succession_allowed) + (pol.succession_fee ? ` (${money(pol.succession_fee)})` : ''),
  };
  if (col in direct) return direct[col];
  if (/보증|개월|반납형|인수형|만km|장기보증/.test(col)) return priceCell(v.price, col);
  return '';   // 차번링크·소비자가격·그 밖 요금·연주행·탁송비·분납·사고다발 = 원천 없음(빈칸)
};

// ── 고정 시트 제자리 갱신 ──
let sheetId = SAMPLE_SHEET_ID, fresh = false;
const meta = SAMPLE_SHEET_ID.startsWith('1FZ8placeholder') ? null : await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`).catch(() => null);
if (!meta) {
  const created = await api('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: JSON.stringify({ properties: { title: '프리패스 — Firestore 상품시트(샘플)' }, sheets: TAB_ORDER.map((t, i) => ({ properties: { sheetId: i, title: t } })) }) });
  sheetId = created.spreadsheetId; fresh = true;
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=false`, { method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: 'jpkpyh@gmail.com' }) }).catch(() => {});
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) }).catch(() => {});
} else {
  const have = new Map<string, number>((meta.sheets || []).map((s: any) => [s.properties.title, s.properties.sheetId]));
  const add: any[] = []; let nid = Math.max(0, ...[...have.values()]) + 1;
  for (const t of TAB_ORDER) if (!have.has(t)) { add.push({ addSheet: { properties: { sheetId: nid, title: t } } }); have.set(t, nid); nid++; }
  if (add.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: add }) });
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: TAB_ORDER.map((t) => `'${t}'`) }) });
}
const gidOf = (t: string, i: number) => fresh ? i : ((meta.sheets || []).find((s: any) => s.properties.title === t)?.properties.sheetId ?? i);

const bodies: Record<string, string[][]> = {};
const data = TAB_ORDER.map((t) => {
  const HEAD = headerCache[t];
  const rows = (groups[t] || []).sort((a, b) => S(a.provider_company_code).localeCompare(S(b.provider_company_code)) || S(a.car_number).localeCompare(S(b.car_number))).map((v) => HEAD.map((c) => cell(c, v)));
  bodies[t] = rows;
  console.log(`  ${t} ${rows.length}대 · ${HEAD.length}열`);
  return { range: `'${t}'!A1`, values: [HEAD, ...rows] };
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });

const fmt: Record<string, unknown>[] = [];
for (let i = 0; i < TAB_ORDER.length; i++) {
  const t = TAB_ORDER[i], gid = gidOf(t, i), HEAD = headerCache[t];
  fmt.push({ updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
  fmt.push(...buildSalesFormatRequests({ gid, columns: HEAD, widths: columnWidths(HEAD, bodies[t]), tabTitle: t, body: bodies[t] }));
}
for (let i = 0; i < fmt.length; i += 200) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt.slice(i, i + 200) }) });

const total = TAB_ORDER.reduce((a, t) => a + (groups[t]?.length || 0), 0);
console.log(`\n★ ${fresh ? '새로 만든' : '제자리 갱신'} 상품시트(${total}대 · 기존시트 동일열):\nhttps://docs.google.com/spreadsheets/d/${sheetId}/edit`);
if (fresh) console.log(`\n※ 이 ID 를 SAMPLE_SHEET_ID 에 박으면 고정: ${sheetId}`);
process.exit(0);
