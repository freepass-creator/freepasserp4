/**
 * **차량번호 하나를 공급사 정제시트부터 끝까지 추적** — 어느 단계에서 스펙이 갈리는지 한눈에. 읽기 전용.
 *   공급사 시트(원문 칸 · 정제칸) → 상품마스터(코드·검증·차명 원문) → 결정 파일 → 판매시트(세 탭) → ERP(v4/products)
 *   사장님 2026-08-19 「왜 우리 담당자가 자꾸 차량번호별로 스펙이 안 맞는다고 하나 — 공급사 정제시트부터 추적해 봐」
 *
 *   npx tsx scripts/trace-plate-spec.mts 161하1266 [101하7624 ...]
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { PRODUCT_MASTER_TAB, DEFAULT_PRODUCT_MASTER_SHEET_ID } from '../lib/domain/product-master-sheet';
import { HUB_CODE_SHEET_ID, SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';
import { isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const PLATES = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(norm);
if (!PLATES.length) { console.log('차량번호를 주세요'); process.exit(1); }
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string): Promise<Rec> => { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : {}; };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const idOf = (u: string) => (String(u).match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || '';
const pick = (h: string[], r: string[], names: string[]) => names.map((n) => { const i = h.findIndex((x) => norm(x) === norm(n)); return `${n}=${i >= 0 ? (r[i] || '') : '·'}`; }).join(' | ');

// 문패 → 21곳
const hub = ((await call(`${SH}/${HUB_CODE_SHEET_ID}/values/A1:Z200`)).values || []) as string[][];
const hi = hub.findIndex((r) => r.some((c) => /공급사코드|코드/.test(S(c))) && r.some((c) => /시트주소|주소|URL/i.test(S(c))));
const hh = (hub[hi] || []).map(S); const ci = hh.findIndex((c) => /공급사코드|코드/.test(c)); const ui = hh.findIndex((c) => /시트주소|주소|URL/i.test(c)); const ni = hh.findIndex((c) => /공급사명|이름/.test(c));
const sheets = hub.slice(hi + 1).map((r) => ({ code: S(r[ci]), name: S(r[ni]), id: idOf(S(r[ui])) })).filter((x) => x.id);
// 상품마스터
const pm = (((await call(`${SH}/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A1:AZ2000`)}`)).values || []) as string[][]).map((r) => r.map(S)); const ph = pm[0];
// 판매시트 세 탭
const smeta = await call(`${SH}/${SALES_SHEET_ID}?fields=sheets.properties(title,hidden)`);
const stabs = pickPublishedSalesTabs(((smeta.sheets || []) as Rec[]).filter((s) => !s.properties.hidden).map((s) => S(s.properties.title)));
const salesRows: { tab: string; h: string[]; r: string[] }[] = [];
for (const t of stabs) { const rows = (((await call(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent(`'${t.title}'!A1:CZ800`)}`)).values || []) as string[][]).map((r) => r.map(S)); const h = rows[0]; const pi = h.indexOf('차량번호'); for (const r of rows.slice(1)) if (PLATES.includes(norm(r[pi]))) salesRows.push({ tab: t.prefix, h, r }); }
// 결정
const decisions = (JSON.parse(readFileSync('data/product-vehicle-review-decisions.json', 'utf8')).decisions || []) as Rec[];
// ERP
let v4: Record<string, Rec> = {};
try { const { initializeApp, cert, getApps } = await import('firebase-admin/app'); const { getDatabase } = await import('firebase-admin/database'); if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' }); v4 = ((await getDatabase().ref('v4/products').get()).val() || {}) as Record<string, Rec>; } catch (e) { console.log('(ERP 못 읽음)', String((e as Error).message).slice(0, 60)); }

const RAW = ['상태', '분류', '제조사', '차명(세부모델+트림)', '옵션', '외부색상', '내부색상', '연식', '주행거리', '연료', '배기량', '차량가격', '최초등록일'];
const REF = ['차종코드', '제조사(정제)', '모델', '세부모델', '세부트림', '선택옵션', '외장색상', '내장색상', '배기량(정제)', '연료(정제)', '차종분류'];
const SALES = ['배차상태', '구분', '공급사', '제조사', '모델', '세부모델', '세부트림', '외장', '내장', '연식', 'Km', '차종구분', '옵션', '연료', '배기량'];
for (const plate of PLATES) {
  console.log(`\n══════ ${plate}`);
  // ① 공급사 시트(모든 시트·탭에서 찾음 — 두 곳에 있으면 둘 다 보인다)
  for (const s of sheets) {
    const m = await call(`${SH}/${s.id}?fields=sheets.properties(title,hidden)`);
    for (const sh of (m.sheets || []) as Rec[]) { const title = S(sh.properties.title); if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
      const rows = (((await call(`${SH}/${s.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`)).values || []) as string[][]).map((r) => r.map(S));
      const h0 = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (h0 < 0) continue; const h = rows[h0]; const pi = h.indexOf('차량번호');
      rows.slice(h0 + 1).forEach((r, k) => { if (norm(r[pi]) !== plate) return;
        console.log(`① 공급사 시트 ${s.name}(${s.code}) 「${title}」 ${h0 + 2 + k}행\n   원문: ${pick(h, r, RAW)}\n   정제칸: ${pick(h, r, REF)}`); });
    }
  }
  // ② 상품마스터
  const at = (n: string) => ph.indexOf(n);
  for (const r of pm.slice(1)) if (norm(r[at('차량번호')]) === plate) console.log(`② 상품마스터(${PRODUCT_MASTER_TAB}): ${pick(ph, r, ['공급사코드', '차종코드', '검증상태', '관리상태', '차량상태', '차종마스터 적용값', '공급사 입력 차명', '검수사유'])}`);
  // ③ 결정
  const d = decisions.filter((x) => norm(x.car_number) === plate); if (d.length) console.log(`③ 결정 파일: ${d.map((x) => `${x.decision} ${x.maker} ${x.model} ${x.sub_model} ${x.trim || '(트림없음)'} ${x.trim_row_key || ''}`).join(' / ')}`); else console.log('③ 결정 파일: 없음');
  // ④ 판매시트
  for (const s of salesRows.filter((x) => norm(x.r[x.h.indexOf('차량번호')]) === plate)) console.log(`④ 판매시트 「${s.tab}」: ${pick(s.h, s.r, SALES)}`);
  // ⑤ ERP
  const erp = Object.entries(v4).filter(([, p]) => norm(p.car_number) === plate && !p._deleted && S(p.status) !== 'deleted');
  for (const [k, p] of erp) console.log(`⑤ ERP ${k}: 상태=${S(p.vehicle_status)} | ${S(p.maker)} ${S(p.model)} ${S(p.sub_model)} ${S(p.trim_name)} | 연료=${S(p.fuel_type)} 배기량=${S(p.engine_cc)} 연식=${S(p.year)} | 외장=${S(p.ext_color)}(원문 ${S(p._raw_ext_color)}) 내장=${S(p.int_color)} | 옵션=${S(p.options).slice(0, 60)} | 코드=${S(p.catalog_id || p.trim_row_key)} 검수=${S(p._product_master_verification)}`);
  if (!erp.length) console.log('⑤ ERP: 없음');
}
