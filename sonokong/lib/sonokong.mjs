/** 손오공 Agent(sokrc.com) 연동 클라이언트.
 *
 *  손오공 저신용/픽업 차량 목록을 API로 읽는다. 시트 대신 이 API가 정본
 *  ("이거 뚫리면 손오공시트 쓰지 말고 그냥 연동" — 2026-08-26 대표).
 *
 *  ── 인증 (완전 무인)
 *  계정 freepass/freepass 로 `POST /api/auth/login` 하면 accessToken(8h) 이 온다.
 *  계정은 lib/wonja/.손오공계정.json (gitignore). 토큰 만료되면 자동 재로그인하니
 *  사람 손이 필요 없다. 매일 예약 실행 가능.
 *  ⚠ 서로 다른 비번으로 반복 로그인 = brute force 로 오탐·차단. 저장된 계정만 쓴다.
 *
 *  ── 엔드포인트 (전부 /api, Bearer 필요)
 *    POST /auth/login  {id,password}                            로그인
 *    GET  /product/homepage/list?carSource=<버킷>&page&pageSize  목록
 *    GET  /product/homepage/count?carSource=<버킷>               집계
 *  응답: { success, data:{ data:[...], attrs:{ totalCount, currentPage } } }
 *
 *  ── 버킷 (list 는 carSource 로 거른다; count 는 무시하고 전량을 준다)
 *    LOW_SONOKONG_DAILY → 항목 carSource "SON_NO_KONG"   (저신용 렌트)
 *    LOW_SONOKONG       → 항목 carSource "SON_NO_KONG"   (저신용 구독)
 *    LOW_TCAR           → 항목 carSource "TCAR_EXTERNAL"  (저신용 픽업구독)
 *  ★ 앞의 두 화면은 응답 carSource가 같으므로 요청 버킷을 버리면 렌트/구독을 구분할 수 없다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePlate, tcarDetailFromHtml, tcarDetailIdentity, uniqueTcarSaleMatch } from './option-normalizer.mjs';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const 토큰경로 = String(process.env.SONOGONG_TOKEN_PATH || '').trim() || path.join(루트, 'lib', 'wonja', '.손오공토큰.json');
export const 계정경로 = String(process.env.SONOGONG_CREDENTIALS_PATH || '').trim() || path.join(루트, 'lib', 'wonja', '.손오공계정.json');
export const API = 'https://sokrc.com/api';

// 화면 탭 → list 쿼리 carSource 값
export const 버킷 = {
  저신용렌트: 'LOW_SONOKONG_DAILY',
  저신용구독: 'LOW_SONOKONG',
  저신용픽업구독: 'LOW_TCAR',
};

function 계정읽기() {
  try {
    return JSON.parse(fs.readFileSync(계정경로, 'utf8'));
  } catch {
    throw new Error('손오공 계정 없음 — lib/wonja/.손오공계정.json 에 {"id","password"} 를 두세요.');
  }
}

function 토큰읽기() {
  try { return JSON.parse(fs.readFileSync(토큰경로, 'utf8')); } catch { return null; }
}

export function 남은시간h(t = 토큰읽기()) {
  return t ? (Number(t.exp) * 1000 - Date.now()) / 3600000 : -1;
}

function 유효(t) {
  return t && Number(t.exp) * 1000 > Date.now() + 60_000; // 1분 여유
}

/** 저장된 계정으로 로그인 → 토큰 저장 후 반환. */
export async function login() {
  const { id, password } = 계정읽기();
  const r = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.data?.accessToken) {
    throw new Error('손오공 로그인 실패 HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  }
  const at = j.data.accessToken;
  let exp = 0;
  try { exp = JSON.parse(Buffer.from(at.split('.')[1], 'base64url').toString()).exp; } catch {}
  const tok = { accessToken: at, exp, id, savedAt: new Date().toISOString() };
  fs.writeFileSync(토큰경로, JSON.stringify(tok, null, 2));
  return tok;
}

/** 유효한 토큰 헤더를 보장한다 (없거나 만료면 자동 재로그인). */
async function 토큰헤더() {
  let t = 토큰읽기();
  if (!유효(t)) t = await login();
  return { Authorization: 'Bearer ' + t.accessToken };
}

export async function list(carSource, opts = {}) {
  const { page = 1, pageSize = 100, ...rest } = opts;
  const u = new URL(API + '/product/homepage/list');
  u.searchParams.set('page', String(page));
  u.searchParams.set('pageSize', String(pageSize));
  if (carSource) u.searchParams.set('carSource', carSource);
  for (const [k, v] of Object.entries(rest)) if (v != null) u.searchParams.set(k, String(v));
  let r = await fetch(u, { headers: await 토큰헤더() });
  if (r.status === 401) { await login(); r = await fetch(u, { headers: await 토큰헤더() }); }
  if (r.status !== 200) throw new Error('손오공 list HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

export async function count(carSource) {
  const u = new URL(API + '/product/homepage/count');
  if (carSource) u.searchParams.set('carSource', carSource);
  const r = await fetch(u, { headers: await 토큰헤더() });
  if (r.status !== 200) throw new Error('손오공 count HTTP ' + r.status);
  return r.json();
}

/** 상품 상세 (saleAmt·옵션·사진·보증금·설명 등 — 목록엔 없다). */
export async function view(id) {
  let r = await fetch(API + '/product/homepage/view/' + id, { headers: await 토큰헤더() });
  if (r.status === 401) { await login(); r = await fetch(API + '/product/homepage/view/' + id, { headers: await 토큰헤더() }); }
  if (r.status !== 200) throw new Error('손오공 view HTTP ' + r.status + ' (id ' + id + ')');
  return (await r.json()).data;
}

/** 에이전트 상세 (carSourceUrl 등 — homepage/view엔 없다). 원본 상세페이지 URL 확보용. */
export async function viewAgent(id) {
  let r = await fetch(API + '/product/view/' + id, { headers: await 토큰헤더() });
  if (r.status === 401) { await login(); r = await fetch(API + '/product/view/' + id, { headers: await 토큰헤더() }); }
  if (r.status !== 200) return null;
  return (await r.json()).data;
}

/** 롯데 티카 상세페이지에서 정제값(디코드된 이름)을 뽑는다 — T카는 손오공이 티카를 연동한 거라 원본.
 *  차종·내장·외장·구동·변속·연료·인승·배기량·모델·트림이 *Nm 필드로 디코드돼 있다. */
export async function lotteSpec(url) {
  if (!/lotterentacar/.test(String(url || ''))) return null;
  let r;
  try { r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }); } catch { return null; }
  if (!r.ok) return null;
  const sourceHtml = await r.text();
  const detail = tcarDetailFromHtml(sourceHtml);
  const identity = tcarDetailIdentity(detail);
  const h = sourceHtml.replace(/&quot;/g, '"').replace(/\\u002[fF]/g, '/');
  const pick = (f) => { const m = h.match(new RegExp('"' + f + '"\\s*:\\s*"([^"]*)"')); return m && m[1] ? m[1].trim() : null; };
  const num = (f) => { const m = h.match(new RegExp('"' + f + '"\\s*:\\s*"?([0-9]+)')); return m ? m[1] : null; };
  const o = {
    차종: pick('shapeTypeNm'), 차급: pick('carTypeNm'),
    외장: pick('colorExNm'), 내장: pick('colorInNm'),
    구동: pick('wdTypeNm'), 변속: pick('transTypeNm'), 연료: pick('fuelTypeNm'),
    인승: num('seatCount'), 배기량: num('displacement'),
    모델: pick('modelgroup'), 등급: pick('grade'), 세부트림: pick('subgrade'),
    풀네임: pick('carTitleName'),
    __paidOptList: Array.isArray(detail?.paidOptList) ? detail.paidOptList : null,
    __plateNumber: identity.plateNumber || null,
    __carId: identity.carId || null,
  };
  return Object.values(o).some(Boolean) ? o : null;
}

/**
 * 티카 공개 판매목록에서 번호판이 정확히 같은 차량의 상세 URL을 찾는다.
 * 검색 결과가 없거나 중복이면 추정하지 않는다. 공개 GET만 사용한다.
 */
export async function findTcarSaleByPlate(plate) {
  const wanted = normalizePlate(plate);
  if (!wanted) return null;
  const q = new URLSearchParams({
    country: '', perPageNum: '15', page: '1', orderType: '', carType: '', categoryGroup: '[""]',
    minYear: '', maxYear: '', minMileage: '', maxMileage: '', minPrice: '', maxPrice: '',
    minInstPrice: '', maxInstPrice: '', minRentPrice: '', maxRentPrice: '', minSalePrice: '', maxSalePrice: '',
    instPriceMonth: '', rentPriceMonth: '', color: '', inColor: '', fuel: '', checkedCenterCodes: '',
    option: '', carNumber: wanted, keyword: '', themeId: '', themeType: '', themeSaleType: '', brandCert: '',
    retailShopId: '', dealerRegKey: '', sellAdminKey: '', cert: '', manage: '', promotion: '',
    separatePromotion: 'true', reqDirect: '', consult: '', rentBuy: '', rentMonth: '', targetCd: '',
    tagList: '', sTagList: '', saleTySale: 'true', shuffleKey: String(Date.now()), consultAvailable: '',
    isDoubleDiscount: '', isSimpleRepair: '', isFreeShipping: '', isFuelSupport: '',
  });
  let r;
  try {
    r = await fetch('https://tcar.lotterentacar.net/cr/search/ajax/list?' + q, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://tcar.lotterentacar.net/cr/search/list' },
    });
  } catch { return null; }
  if (!r.ok) return null;
  const json = await r.json().catch(() => null);
  const match = uniqueTcarSaleMatch(json, wanted);
  if (!match) return null;
  const carId = String(match.carId);
  return {
    carId,
    plateNumber: String(match.plateNumber),
    url: `https://tcar.lotterentacar.net/cr/search/view?carId=${encodeURIComponent(carId)}&saleTySale=true`,
  };
}

/** 동시성 제한 map (기본 8). fetch 폭주·차단 방지. */
export async function mapPool(items, fn, size = 8) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

/** carSource 버킷 하나를 끝까지 페이지네이션해서 전 항목을 모은다. */
export async function pullAll(carSource) {
  let all = [];
  let p = 1;
  let total = Infinity;
  while (all.length < total) {
    const j = await list(carSource, { page: p, pageSize: 100 });
    const rows = j.data?.data ?? [];
    total = j.data?.attrs?.totalCount ?? rows.length;
    all = all.concat(rows);
    if (!rows.length) break;
    p += 1;
    if (p > 100) break; // 안전장치
  }
  return { total, rows: all };
}
