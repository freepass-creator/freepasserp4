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
const SRC_SHEET = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';   // 기존 판매시트 = 본시트(영업자가 보는 곳). 헤더를 여기서 읽는다.
// ★--main = «본시트»(영업자가 보는 판매시트)에 직접 발행. 기본은 샘플(실수로 운영을 덮지 않게).
//   본시트에 쓸 때도 4개 상품탭만 rename·clear·재작성한다(AI 인계·차종사전 등 참조탭은 안 건드린다).
const TO_MAIN = process.argv.includes('--main');
const SAMPLE_SHEET_ID = TO_MAIN ? SRC_SHEET : (S(process.env.SAMPLE_SHEET_ID) || '1J7dcGCTI0hiHBSdbHx0SqKJKrBg57xkgsX-I8qyfv3c');
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
// 코드 정규화 — 접미사 앞자리 0 차이 흡수(RP031_S1 ↔ RP031_S01). 사장님 2026-09-03 실측 123대.
const normCode = (c: unknown) => S(c).toLowerCase().replace(/_([a-z]+)0*(\d+)/g, '_$1$2');
const polByCode = new Map<string, any>();     // policy_code 필드
const polByKey = new Map<string, any>();      // 노드 키
const polByNorm = new Map<string, any>();     // 정규화 코드(퍼지)
const provPolicies = new Map<string, any[]>();
for (const [k, p] of Object.entries(policies)) {
  if (!p || typeof p !== 'object') continue;
  polByKey.set(k, p); polByNorm.set(normCode(k), p);
  const code = S((p as any).policy_code);
  if (code) { polByCode.set(code, p); polByNorm.set(normCode(code), p); }
  const prov = S((p as any).provider_company_code);
  if (prov) { const a = provPolicies.get(prov) || []; if (!a.includes(p)) a.push(p); provPolicies.set(prov, a); }
}
// ★공급사 정책이 «하나뿐」이면 그 공급사 차 전부에 적용(사장님 규칙). 둘 이상이면 코드로만(차번별 매칭은 이후 수집작업).
const provSingle = new Map<string, any>();
for (const [prov, arr] of provPolicies) if (arr.length === 1) provSingle.set(prov, arr[0]);
// ★「프리패스 공통 렌트」를 정책 2개+ 공급사에 씌우지 «않는다»(사장님 2026-09-03 「공통정책으로 다 채운 건 안 됨」).
//   실제로 맞는 것만: 코드(정확·퍼지) + 정책이 «진짜 하나뿐인 공급사」. 나머지는 빈칸 — 내일 구형 시트로 실제 정책 채움.
const policyOf = (v: any) => polByCode.get(S(v.policy_code)) || polByKey.get(S(v.policy_code)) || polByNorm.get(normCode(v.policy_code)) || provSingle.get(S(v.provider_company_code)) || {};
const docs = (await getFirestore().collection('products').get()).docs.map((d) => d.data());
const listable = docs.filter((v) => v.listable === true);

// ★전용계좌·공급사명 = 공급사(파트너) 정보(사장님 2026-09-03·09-04 「계좌·공급사명도 원자화된 거 갖고 와야지」).
//   provider_company_code → 은행·계좌·예금주 · 회사명.
const acctByProvider = new Map<string, string>();
const nameByProvider = new Map<string, string>();
{
  const partners = (await db.ref('v4/partners').get()).val() as Record<string, any> || {};
  for (const p of Object.values(partners)) {
    if (!p || typeof p !== 'object') continue;
    const code = S((p as any).partner_code) || S((p as any).provider_company_code);
    const acct = [S((p as any).bank_name), S((p as any).bank_account), S((p as any).bank_holder)].filter(Boolean).join(' ');
    const nm = S((p as any).company_name) || S((p as any).name) || S((p as any).partner_name) || S((p as any).business_name);
    if (code && acct) acctByProvider.set(code, acct);
    if (code && nm) nameByProvider.set(code, nm);
  }
  console.log(`전용계좌 ${acctByProvider.size}개 · 공급사명 ${nameByProvider.size}개 로드`);
}

// ★픽업구독 = 티카 링크를 시트에 그대로 박는다(사장님 2026-09-03). 손오공 「픽업재고」 탭의 「차번링크」 열.
//   원자엔 없고 소스 시트에만 있어 여기서 차번↔티카링크를 읽어 온다.
const NKEY = (c: unknown) => S(c).replace(/\s/g, '');
const ticaByCar = new Map<string, string>();
{
  const SONO = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';   // 손오공 프리패스 재고
  try {
    const jm = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SONO}?fields=sheets.properties(title)`);
    const pkTab = (jm.sheets || []).map((s: any) => s.properties.title).find((t: string) => /픽업/.test(t));
    if (pkTab) {
      const vv = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SONO}/values/${encodeURIComponent(`'${pkTab}'!A1:BZ2000`)}`);
      const rr = vv.values || []; const hd = (rr[0] || []).map(S); const ci = hd.indexOf('차량번호'), li = hd.indexOf('차번링크');
      if (ci >= 0 && li >= 0) for (const r of rr.slice(1)) { const c = NKEY(r[ci]), l = S(r[li]); if (c && /^https?:/i.test(l)) ticaByCar.set(c, l); }
    }
    console.log(`티카 링크(픽업재고 차번링크) ${ticaByCar.size}개 로드`);
  } catch (e) { console.warn('티카 링크 로드 실패:', (e as Error).message); }
}

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
// ★픽업구독 보증금 열 이름 = 「반납형보증금/인수형보증금」(사장님 2026-09-04). 값(대여료×연수 최대3배)은 그대로.
if (headerCache['픽업구독']) headerCache['픽업구독'] = headerCache['픽업구독'].map((h) => h === '보증금 반납형' ? '반납형보증금' : h === '보증금 인수형' ? '인수형보증금' : h);

// ★옵션 정리(사장님 2026-09-04) — 「-」·「.」처럼 텍스트/영문/숫자가 없으면 선택옵션 없음(빈칸).
const cleanOpt = (s: string): string => /[가-힣A-Za-z0-9]/.test(S(s)) ? S(s) : '';

// ── 열 이름 → 값 ──
const money = (v: unknown) => { const n = Number(String(v).replace(/[,\s]/g, '')); return n ? n.toLocaleString() : (v == null || v === '' ? '' : S(v)); };
// 면책금·한도 단위 표기 — 「1억/50」→「1억원 / 50만원」, 「3천/50」→「3천만원 / 50만원」, 「무한/없음/차량」은 그대로.
const fmtUnit = (s: string): string => {
  s = S(s);
  if (!s || /무한|없음|차량|미가입|불가|가능|협의|전국|일부|본인|가족|사업자|개인|오일|미제공|신용|무심사/.test(s)) return s;
  if (/억\s*원?$/.test(s)) return s.replace(/\s*원$/, '') + '원';           // 1억 → 1억원
  if (/천\s*만?\s*원?$/.test(s)) return s.replace(/\s*만?\s*원?$/, '') + '만원'; // 2천 → 2천만원
  if (/^\d+(?:\s*[~\-]\s*\d+)?\s*만?\s*원?$/.test(s)) return s.replace(/\s*만?\s*원?$/, '').replace(/\s/g, '') + '만원'; // 50 / 50~100 → 만원
  return s;
};
const fmtLimit = (raw: string): string => S(raw).split('/').map((p) => fmtUnit(p.trim())).filter(Boolean).join(' / ');
const priceCell = (price: any, col: string): string => {
  if (!price || typeof price !== 'object') return '';
  const P = price as Record<string, any>;
  const rentK = (k: string) => (P[k]?.rent != null ? money(P[k].rent) : '');
  const depAny = (suffix = '') => { for (const t of ['60', '48', '36', '24', '12']) { const k = suffix ? `${t}${suffix}` : t; if (P[k]?.deposit != null) return money(P[k].deposit); } return ''; };
  const m = col.match(/(\d+)개월/);
  if (/반납형\s*보증금|보증금\s*반납형|^보증금$|장기보증/.test(col)) return depAny();
  if (/인수형\s*보증금|보증금\s*인수형/.test(col)) return depAny('_인수형');
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
// ★공급사별 정책 정본 = 구형 공급사시트에서 학습(사장님 2026-09-03). 공급사코드 → 정책 열값. v4/policies 보다 완전.
const supPol: Record<string, Record<string, string>> = (() => { try { return JSON.parse(readFileSync('public/data/supplier-policies.json', 'utf8')); } catch { return {}; } })();
// ★사장님 확인 오버라이드(21세/23세/1만+ 등) — supplier-policies 보다 우선. 알게 되는 대로 이 파일에 넣는다.
const override: Record<string, Record<string, string>> = (() => { try { return JSON.parse(readFileSync('public/data/supplier-policy-overrides.json', 'utf8')); } catch { return {}; } })();
// 할증 표기(사장님 2026-09-04 「대여료 10% · 정액 10만원 이렇게, 21·23세도」) —
//   「0.1」→대여료 10% · 「10/12/7」(바 정수)→대여료 X% · 「3만/10만원」→정액 X만원 · 불가/협의/문의는 그대로.
//   바 정수를 «대여료 %»로 보는 근거: 손오공 1만+ 「0.1」(=10%)와 21세 「10」이 같은 단위 · 손오공=대여료 10% 확인.
//   정액인 곳은 원값에 「만」이 붙어 오거나(3만) 오버라이드로 박는다.
const fmtSurcharge = (s: string): string => {
  const t = S(s).replace(/\s/g, '');
  if (!t || /문의|협의|불가|없음|미가입|대여료|정액/.test(t)) return S(s);
  if (/만원?$/.test(t)) return `정액 ${t.replace(/원$/, '').replace(/만$/, '만원')}`;
  const n = Number(t.replace('%', ''));
  if (!isNaN(n) && n > 0 && n < 1) return `대여료 ${Math.round(n * 100)}%`;
  if (!isNaN(n) && n >= 1 && n < 100) return `대여료 ${n}%`;   // 바 정수 = 대여료 퍼센트
  if (/%$/.test(t)) return `대여료 ${t}`;
  return S(s);
};
const cell = (col: string, v: any): string => {
  const pol = policyOf(v);
  const prov = S(v.provider_company_code);
  const sp = supPol[prov];
  const ov = override[prov];
  // 0) 사장님 확인값(오버라이드) — 어느 열이든 최우선. 알게 되는 대로 supplier-policy-overrides.json 에 넣는다.
  if (ov && S(ov[col])) return S(ov[col]);
  // ★기본연령(사장님 2026-09-04) — 전 공급사 만26세 이상.
  if (col === '기본연령') return '만26세 이상';
  // ★할증 열(1만+·21세+·23세+) — 「대여료 00% / 정액 00만원」으로 표기(사장님 2026-09-04).
  //   0.1→대여료 10%, 3만→정액 3만원. 애매한 정수(어디는 %·어디는 정액)는 원값 유지 → 확인되면 오버라이드로 박는다.
  if (col === '1만+') return fmtSurcharge(S(sp?.['1만+']) || S(pol.mileage_upcharge_per_10000km));
  if (col === '21세+' || col === '만21세') return fmtSurcharge(S(sp?.['21세']));
  if (col === '23세+' || col === '만23세') return fmtSurcharge(S(sp?.['23세']));
  // 1) 공급사시트 정책이 그 열을 갖고 있으면 그걸 최우선. 면책금 단위표기·가격 콤마.
  if (sp && col !== '전용계좌' && S(sp[col])) {
    const raw = S(sp[col]);
    if (/대인|대물|자손|무보험|자차/.test(col)) return fmtLimit(raw);
    if (/소비자가격|가격|금액/.test(col)) return money(raw);
    return raw;
  }
  const direct: Record<string, string> = {
    '배차상태': S(v.status), '구분': S(v.product_type), '차량번호': S(v.car_number),
    '제조사': S(v.maker), '모델': S(v.model), '세부모델': S(v.sub_model),
    // 세부트림 — snap 이 「기본형」을 버려 비지만, 원문에 기본형이면 그대로 표기(사장님 2026-09-03).
    '세부트림': S(v.trim_name) || (/기본\s*형|\b기본\b/.test(S(v['원문']?.['차명'])) ? '기본형' : ''),
    '외장': S(v.ext_color), '내장': S(v.int_color), '연식': S(v.year), 'Km': S(v.mileage),
    '연료': S(v.fuel_type), '배기량': S(v.engine_cc), '차종구분': S(v.vehicle_class),
    '차명(원문)': S(v['원문']?.['차명']), '옵션(원문)': cleanOpt(S(v['원문']?.['옵션'])),
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
  if (col === '차번링크') return ticaByCar.get(NKEY(v.car_number)) || '';   // 픽업 = 티카 상품링크
  if (col === '전용계좌') return acctByProvider.get(S(v.provider_company_code)) || '';   // 공급사 계좌
  if (col === '공급사') return nameByProvider.get(S(v.provider_company_code)) || S(v.provider_company_code);   // 공급사명(원자 파트너)
  if (/보증|개월|반납형|인수형|만km|장기보증/.test(col)) return priceCell(v.price, col);
  return '';   // 소비자가격·그 밖 요금·연주행·탁송비·분납·사고다발 = 원천 없음(빈칸)
};

// ── 고정 시트 제자리 갱신 · 탭 이름 = 「base 업데이트시각 · N대」(기존 판매시트처럼) ──
const kstNow = (() => { const d = new Date(Date.now() + 9 * 3600e3); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; })();
const titleOf = (base: string) => `${base} ${kstNow} · ${(groups[base] || []).length}대`;

let sheetId = SAMPLE_SHEET_ID, fresh = false;
const meta = SAMPLE_SHEET_ID.startsWith('1FZ8placeholder') ? null : await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`).catch(() => null);
const gidByBase: Record<string, number> = {};
if (!meta) {
  const created = await api('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: JSON.stringify({ properties: { title: '프리패스 — 상품리스트(영업자용)' }, sheets: TAB_ORDER.map((t, i) => ({ properties: { sheetId: i, title: titleOf(t) } })) }) });
  sheetId = created.spreadsheetId; fresh = true;
  TAB_ORDER.forEach((t, i) => { gidByBase[t] = i; });
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=false`, { method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: 'jpkpyh@gmail.com' }) }).catch(() => {});
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) }).catch(() => {});
} else {
  // 기존 탭을 «base 이름」으로 찾아 새 제목(시각·대수)으로 rename. 없으면 추가.
  const existing = (meta.sheets || []).map((s: any) => ({ title: S(s.properties.title), gid: s.properties.sheetId }));
  const reqs: any[] = []; let nid = Math.max(0, ...existing.map((e: any) => e.gid)) + 1;
  for (const base of TAB_ORDER) {
    const found = existing.find((e: any) => e.title === base || e.title.startsWith(base + ' '));
    const nt = titleOf(base);
    const rowCount = 1 + (groups[base]?.length || 0) + 20;   // 밑 여유 20줄만(사장님 2026-09-04) — 쓰기 전에 그리드 맞춤
    if (found) { gidByBase[base] = found.gid; reqs.push({ updateSheetProperties: { properties: { sheetId: found.gid, title: nt, gridProperties: { rowCount } }, fields: 'title,gridProperties.rowCount' } }); }
    else { gidByBase[base] = nid; reqs.push({ addSheet: { properties: { sheetId: nid, title: nt, gridProperties: { rowCount } } } }); nid++; }
  }
  if (reqs.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: TAB_ORDER.map((t) => `'${titleOf(t).replace(/'/g, "''")}'`) }) });
}

const bodies: Record<string, string[][]> = {};
const data = TAB_ORDER.map((t) => {
  const HEAD = headerCache[t];
  const rows = (groups[t] || []).sort((a, b) => S(a.provider_company_code).localeCompare(S(b.provider_company_code)) || S(a.car_number).localeCompare(S(b.car_number))).map((v) => HEAD.map((c) => cell(c, v)));
  bodies[t] = rows;
  console.log(`  ${titleOf(t)} · ${HEAD.length}열`);
  return { range: `'${titleOf(t).replace(/'/g, "''")}'!A1`, values: [HEAD, ...rows] };
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });

const fmt: Record<string, unknown>[] = [];
for (const t of TAB_ORDER) {
  const gid = gidByBase[t], HEAD = headerCache[t];
  fmt.push({ updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
  fmt.push(...buildSalesFormatRequests({ gid, columns: HEAD, widths: columnWidths(HEAD, bodies[t]), tabTitle: t, body: bodies[t] }));
}
for (let i = 0; i < fmt.length; i += 200) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt.slice(i, i + 200) }) });

const total = TAB_ORDER.reduce((a, t) => a + (groups[t]?.length || 0), 0);
console.log(`\n★ ${TO_MAIN ? '본시트 반영 완료' : (fresh ? '새로 만든' : '제자리 갱신')} 상품시트(${total}대 · 기존시트 동일열):\nhttps://docs.google.com/spreadsheets/d/${sheetId}/edit`);
if (fresh) console.log(`\n※ 이 ID 를 SAMPLE_SHEET_ID 에 박으면 고정: ${sheetId}`);
process.exit(0);
