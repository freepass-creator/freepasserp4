/**
 * **상품마스터 확정 코드의 «모델» ↔ 지금 공급사 시트 차명(세부모델+트림) 대조** — 코드가 엉뚱한 차에 붙어 있으면(셀토스 줄에 쏘나타 코드) 여기서 걸린다. 읽기 전용(기본).
 *   사장님 2026-08-19 「왜 담당자가 자꾸 차량번호별로 스펙이 안 맞는다고 하나 — 공급사 정제시트부터 추적해 봐」 → 실측: 08-10 새 시트가 줄이 밀린 채 만들어졌을 때
 *   상품마스터에 박힌 코드가 공급사 칸을 바로잡은 뒤에도 남아, 정제칸 채우기(정본이 이김)가 잘못된 이름을 다시 썼다(손오공 161허1165 셀토스 ↔ 코드 쏘나타 DN8).
 *   판정: 코드의 모델 이름(별칭)·세부모델 개발코드가 지금 차명(세부모델+트림)·옵션 원문에 하나도 없으면 「모델 불일치」.
 *   --demote --apply: 그 줄의 상품마스터 코드·적용값 비움 + 검수필요 + 사유, 결정 파일의 그 차 결정 제거 → resolve-unmatched-vehicles → fill → 발행으로 원문 기준 재정립.
 *
 *   npx tsx scripts/audit-code-vs-supplier-name.mts [--demote --apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';
import { HUB_CODE_SHEET_ID } from '../lib/domain/legacy-sheets';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_./()（）·,]/g, '');
const APPLY = process.argv.includes('--apply');
const DEMOTE = process.argv.includes('--demote');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const idOf = (u: string) => (String(u).match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || '';
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const art = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: Rec[] };
const byKey = new Map(art.records.map((r) => [S(r.trim_row_key), r]));
/** 코드 모델 이름이 원문에 다르게 적히는 것 — 최소 별칭 */
const MODEL_ALIAS: Record<string, string[]> = {
  그랜저: ['grandeur', '그랜져'], 쏘나타: ['sonata'], 아반떼: ['avante', '아반테'], 싼타페: ['santafe', '산타페'], 스포티지: ['sportage'], 쏘렌토: ['sorento', '소렌토'],
  카니발: ['carnival'], 팰리세이드: ['palisade', '팰리'], 셀토스: ['seltos'], 투싼: ['tucson'], K5: ['k5'], K8: ['k8'], K7: ['k7'], K3: ['k3'], K9: ['k9'], 모닝: ['morning'],
  레이: ['ray'], 니로: ['niro'], 아이오닉5: ['ioniq5', '아이오닉 5'], 아이오닉6: ['ioniq6', '아이오닉 6'], GV70: ['gv70'], GV80: ['gv80'], G80: ['g80'], G70: ['g70'], G90: ['g90'],
  스타리아: ['staria'], 캐스퍼: ['casper'], 코나: ['kona'], 베뉴: ['venue'], 토레스: ['torres'], 티볼리: ['tivoli'], 렉스턴: ['rexton'], 코란도: ['korando'], QM6: ['qm6'], SM6: ['sm6'], XM3: ['xm3'],
  트랙스: ['trax'], 트레일블레이저: ['trailblazer'], 말리부: ['malibu'], 스파크: ['spark'], '5시리즈': ['5series', '520', '530', '5 시리즈'], '3시리즈': ['3series', '320', '330'],
  'E-클래스': ['e-class', 'e200', 'e220', 'e300', 'e클래스', 'e 클래스'], 'S-클래스': ['s-class', 's350', 's450', 's500', 's클래스'], 'C-클래스': ['c-class', 'c200', 'c220', 'c클래스'],
  A6: ['a6'], A4: ['a4'], 모델3: ['model3', '모델 3'], 모델Y: ['modely', '모델 y'], X5: ['x5'], X3: ['x3'], GLC: ['glc'], GLE: ['gle'],
};

// 문패 → 21곳 → 코드|차번 → 지금 원문(제조사 차명(세부모델+트림) 옵션)
const hub = ((await call(`${SH}/${HUB_CODE_SHEET_ID}/values/A1:Z200`)).values || []) as string[][];
const hi = hub.findIndex((r) => r.some((c) => /공급사코드|코드/.test(S(c))) && r.some((c) => /시트주소|주소|URL/i.test(S(c))));
const hh = (hub[hi] || []).map(S); const ci = hh.findIndex((c) => /공급사코드|코드/.test(c)); const ui = hh.findIndex((c) => /시트주소|주소|URL/i.test(c));
const rawByKey = new Map<string, string>();
for (const r of hub.slice(hi + 1)) {
  const id = idOf(S(r[ui])); const code = S(r[ci]); if (!id || !code) continue;
  const m = await call(`${SH}/${id}?fields=sheets.properties(title,hidden)`);
  for (const sh of (m.sheets || []) as Rec[]) {
    const title = S(sh.properties.title); if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
    const rows = (((await call(`${SH}/${id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`)).values || []) as string[][]).map((x) => x.map(S));
    const h0 = rows.findIndex((x) => x.includes('차량번호') && x.some((c) => c.replace(/\s/g, '') === '차명(세부모델+트림)')); if (h0 < 0) continue;
    const h = rows[h0]; const pi = h.indexOf('차량번호'); const ni = h.findIndex((c) => c.replace(/\s/g, '') === '차명(세부모델+트림)'); const mi = h.indexOf('제조사'); const oi = h.indexOf('옵션');
    for (const x of rows.slice(h0 + 1)) { const p = S(x[pi]).replace(/\s/g, ''); if (!p) continue; const key = `${code}|${p}`; if (!rawByKey.has(key)) rawByKey.set(key, `${S(x[mi])} ${S(x[ni])} ${oi >= 0 ? S(x[oi]) : ''}`); }
  }
}
// 상품마스터
const pm = (((await call(`${SH}/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A1:AZ2000`)}`)).values || []) as string[][]).map((r) => r.map(S));
const ph = pm[0]; const at = (n: string) => ph.indexOf(n);
type Row = { row: number; plate: string; code: string; codeModel: string; raw: string; provider: string; state: string };
const bad: Row[] = []; let checked = 0, noRaw = 0;
for (let i = 1; i < pm.length; i++) {
  const r = pm[i]; const code = S(r[at('차종코드')]); const plate = S(r[at('차량번호')]).replace(/\s/g, '');
  if (!code || !plate || S(r[at('검증상태')]) !== '확정') continue;
  const rec = byKey.get(code); if (!rec) continue;
  const raw = rawByKey.get(`${S(r[at('공급사코드')])}|${plate}`); if (!raw) { noRaw++; continue; }
  checked++;
  const model = S(rec.model); const words = [model, ...(MODEL_ALIAS[model] || [])].map(norm).filter((w) => w.length >= 2);
  const sub = norm(rec.sub_model);
  const devCodes = (S(rec.sub_model).match(/\b[A-Za-z]{1,3}\d{1,2}[A-Za-z]?\b/g) || []).map((c) => c.toLowerCase()).filter((c) => c !== norm(model));
  const text = norm(raw);
  const hit = words.some((w) => text.includes(w)) || devCodes.some((c) => text.includes(c)) || (sub.length >= 3 && text.includes(sub));
  if (!hit) bad.push({ row: i + 1, plate, code, codeModel: `${S(rec.maker)} ${model} ${S(rec.sub_model)} ${S(rec.trim)}`, raw: raw.slice(0, 60), provider: S(r[at('공급사코드')]), state: S(r[at('차량상태')]) });
}
console.log(`■ 상품마스터 확정 코드 ↔ 지금 공급사 차명 대조 — 대조 ${checked}대(공급사 시트에 없는 차 ${noRaw}) · 모델 불일치 ${bad.length}대`);
for (const b of bad) console.log(`   ${b.plate.padEnd(10)} ${b.provider.padEnd(8)} ${b.state.padEnd(5)} 코드=${b.codeModel.slice(0, 40).padEnd(42)} ↔ 원문=${b.raw}`);
writeFileSync('tmp/code-vs-supplier-name.json', JSON.stringify(bad, null, 2));
if (!(DEMOTE && APPLY)) { console.log(DEMOTE ? '※ --apply 를 주면 위 코드를 비우고 검수필요로 둔다' : '※ 비우려면 --demote --apply'); process.exit(0); }
const data: { range: string; values: string[][] }[] = [];
const cidx = { code: at('차종코드'), applied: at('차종마스터 적용값'), verif: at('검증상태'), reason: at('검수사유') };
for (const b of bad) {
  data.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(cidx.code)}${b.row}`, values: [['']] });
  if (cidx.applied >= 0) data.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(cidx.applied)}${b.row}`, values: [['']] });
  data.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(cidx.verif)}${b.row}`, values: [['검수필요']] });
  if (cidx.reason >= 0) data.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(cidx.reason)}${b.row}`, values: [[`코드 모델 불일치 — 코드 ${b.codeModel.slice(0, 40)} ↔ 공급사 차명 「${b.raw.slice(0, 40)}」 → 코드 비움(2026-08-19, 옛 코드 ${b.code})`]] });
}
writeFileSync(`tmp/code-mismatch-demote-snapshot-${Date.now()}.json`, JSON.stringify(bad, null, 2));
for (let i = 0; i < data.length; i += 400) await call(`${SH}/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 400) }) });
// 결정 파일의 그 차 옛 결정 제거 — 원문으로 다시 정하게(resolve)
const dp = 'data/product-vehicle-review-decisions.json'; const d = JSON.parse(readFileSync(dp, 'utf8'));
const plates = new Set(bad.map((b) => b.plate)); const before = d.decisions.length;
d.decisions = d.decisions.filter((x: Rec) => !plates.has(S(x.car_number).replace(/\s/g, '')));
writeFileSync(dp, `${JSON.stringify(d, null, 2)}\n`);
console.log(`  ✓ 상품마스터 ${bad.length}줄 코드 비움+검수필요 · 결정 파일 ${before - d.decisions.length}건 제거 — 다음: resolve-unmatched-vehicles --apply → fill-supplier-ai-columns --apply --include-mirror → 발행`);
