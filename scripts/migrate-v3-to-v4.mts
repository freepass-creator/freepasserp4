/**
 * erp3(v3) → erp4(v4) 이관 — ① 변환 전용 (네트워크 없음 · 드라이런)
 *
 * 실행:
 *   npx tsx scripts/migrate-v3-to-v4.mts <백업.json> [출력디렉터리]
 *
 * ── 설계 원칙 (독립 감사에서 치명 결함 3건이 나온 뒤 확정) ──
 *  1) **코드를 재발급하지 않는다.** 기존 코드 그대로 옮긴다.
 *     이유: 파트너/공급사 코드는 users(루트, 미이관)와 업무데이터를 잇는 **조인키**다.
 *     규칙이 `매물.provider_company_code === users/{uid}.company_code` 문자열 비교라,
 *     한쪽만 개명하면 공급사 계정에서 매물·계약·정산이 전부 0건이 되고 쓰기도 거부된다.
 *     (관리자는 전건 통과라 스모크테스트로 잡히지 않는다 — 반드시 공급사 계정으로 확인)
 *     코드 정리(U/P/M)는 erp3 종료 후 users까지 한 번에 하는 별도 작업.
 *  2) **매물(products)은 이관하지 않는다.** 시트 동기화로 새로 채운다(MIGRATION_PLAN D5).
 *     이유: v4에 이미 5,629건이 있고 유입분과 129대가 실물 중복 → 같은 차가 두 코드로
 *     노출되어 이중 판매 위험. 원가(vehicle_price)를 공개 노드로 흘리는 문제도 함께 사라진다.
 *  3) **조인은 이관 시점에 굳힌다** — 방·계약의 차명/차번, 정산의 contract_date.
 *     방 89건이 삭제된 매물을 가리켜 런타임 조인은 실패한다. 굳히면 매물 없이도 화면이 정상.
 *  4) **선결 검사에 걸리면 페이로드를 쓰지 않는다.** (예전엔 ⛔를 외치면서도 파일을 써서
 *     정리 안 된 산출물이 적용될 수 있었다)
 *  5) 제외는 사유와 함께 남긴다. 조용히 버리지 않는다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

const SRC = process.argv[2];
const OUTDIR = process.argv[3] || 'tmp/migration';
if (!SRC) {
  console.error('사용법: npx tsx scripts/migrate-v3-to-v4.mts <백업.json> [출력디렉터리]');
  process.exit(1);
}

const db: Rec = JSON.parse(readFileSync(SRC, 'utf8'));
const entries = (node: string): [string, Rec][] =>
  Object.entries((db[node] || {}) as Rec).filter(([, v]) => isObj(v)) as [string, Rec][];

/** 소프트삭제 — v3는 _deleted 불리언과 status:'deleted' 두 갈래를 쓴다. */
const isDeleted = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';

type Skip = { node: string; key: string; reason: string; hint?: string };
const skips: Skip[] = [];
const errors: string[] = [];
const notes: string[] = [];
const skip = (node: string, key: string, reason: string, hint?: string) => skips.push({ node, key, reason, hint });

/** ISO 날짜로 정규화 — 정산 contract_date가 epoch ms와 'YYYY-MM-DD'로 섞여 정렬·표시가 깨진다. */
function toDate(v: unknown): string {
  const s = S(v);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (Number.isFinite(n) && n > 1e11) return new Date(n).toISOString().slice(0, 10);
  return s;
}
/** erp3 차명 규칙 — sub_model 우선. [maker,model,sub_model,trim] 조합은 "기아 K5 더 뉴 K5"처럼 중복된다. */
const vehicleNameOf = (r: Rec): string =>
  S(r.vehicle_name) || S(r.sub_model) || [r.maker, r.model, r.trim_name].map(S).filter(Boolean).join(' ');

// ── 0. 선결 검사 — 걸리면 페이로드를 쓰지 않고 중단 ────────────────────
{
  // 파트너 키 충돌: erp4는 partner_code를 _key로 쓴다(rtdb-records.ts:93).
  // 서로 다른 레코드가 한 키로 합쳐지면 조용히 사라지고 이름까지 뒤바뀐다(실측 49→46).
  const byCode = new Map<string, string[]>();
  for (const [k, p] of entries('partners')) {
    if (isDeleted(p)) continue;
    const code = S(p.partner_code) || k;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(`${k}(${S(p.name || p.partner_name || p.company_name) || '이름없음'})`);
  }
  for (const [code, list] of byCode) {
    if (list.length > 1) errors.push(`파트너 코드 충돌 '${code}' ← ${list.join(' , ')}`);
  }
}
{
  // user_code 중복: 정산 스코프가 agent_code(=user_code) 쿼리라 남의 정산이 보인다.
  const byCode = new Map<string, string[]>();
  for (const [k, u] of entries('users')) {
    if (isDeleted(u)) continue;
    const c = S(u.user_code);
    if (!c) continue;
    if (!byCode.has(c)) byCode.set(c, []);
    byCode.get(c)!.push(`${k.slice(0, 8)}…(${S(u.name) || S(u.email) || '이름없음'})`);
  }
  for (const [c, list] of byCode) {
    if (list.length > 1) errors.push(`user_code 중복 '${c}' ← ${list.join(' , ')} (정산 스코프가 이 값을 쓴다)`);
  }
}

// ── 매물 인덱스 (이관은 안 하지만 차명·차번 굳히기에 참조) ──────────────
const productByKey = new Map<string, Rec>();
for (const [k, p] of entries('products')) {
  productByKey.set(k, p);
  const c = S(p.product_code); if (c) productByKey.set(c, p);
  const u = S(p.product_uid); if (u) productByKey.set(u, p);
}
const lookupProduct = (r: Rec): Rec | undefined => {
  for (const f of ['product_code', 'product_uid', 'product_id']) {
    const v = S(r[f]); if (v && productByKey.has(v)) return productByKey.get(v);
  }
  return undefined;
};

// ── 1. 파트너 (코드 유지) ──────────────────────────────────────────────
const v4partners: Rec = {};
for (const [k, p] of entries('partners')) {
  if (isDeleted(p)) { skip('partners', k, '삭제됨'); continue; }
  const key = S(p.partner_code) || k;
  v4partners[key] = {
    ...p, _key: key, partner_code: key,
    name: S(p.name) || S(p.partner_name) || S(p.company_name) || key,
  };
}
{
  // 참조되는데 마스터가 없는 코드 — 영향 레코드 수까지 센다(SP999가 대표).
  const refCount = new Map<string, number>();
  const bump = (v: string) => { const s = S(v); if (s) refCount.set(s, (refCount.get(s) || 0) + 1); };
  for (const [, u] of entries('users')) { bump(u.company_code); bump(u.agent_channel_code); }
  for (const [, r] of entries('rooms')) { bump(r.provider_company_code); bump(r.agent_channel_code); }
  for (const [, c] of entries('contracts')) { bump(c.provider_company_code); bump(c.agent_channel_code); }
  const SYS = new Set(['MASTER', 'admin', 'PROVIDER']);
  const missing = [...refCount].filter(([c]) => !v4partners[c] && !SYS.has(c)).sort((a, b) => b[1] - a[1]);
  for (const [code, n] of missing) notes.push(`파트너 마스터 없음: \`${code}\` — 참조 ${n}건`);
  if (missing.length) notes.push('  → 실사용 코드는 파트너 레코드를 먼저 만들어야 소속·정산 스코프가 성립한다.');
}

// ── 2. 방 (키 유지) ────────────────────────────────────────────────────
const v4rooms: Rec = {};
const roomAlive = new Set<string>();
for (const [k, r] of entries('rooms')) {
  if (isDeleted(r)) { skip('rooms', k, '삭제됨'); continue; }
  const src = lookupProduct(r) || {};
  const car = S(r.car_number) || S(r.vehicle_number) || S(src.car_number);
  const name = vehicleNameOf(r) || vehicleNameOf(src);
  const isAdmin = r.is_admin_chat === true || k.startsWith('ADMIN_');
  if (!isAdmin && !car && !name) {
    skip('rooms', k, '차량 식별정보 없음 — 목록에 빈 줄로 뜬다', `product_uid=${S(r.product_uid)}`);
  }
  // 규칙(v4/rooms/$id .validate)이 소유 3필드를 요구한다. 없으면 이관 후 그 방에 쓰기가 영구 거부된다.
  const need = ['agent_uid', 'agent_channel_code', 'provider_company_code'].filter((f) => !S(r[f]));
  if (need.length && !isAdmin) skip('rooms', k, `소유필드 결손(${need.join(',')}) — 이관 후 쓰기 거부됨`, '보정 필요');
  roomAlive.add(k);
  v4rooms[k] = {
    ...r, _key: k, room_code: S(r.room_code) || k,
    // 조인 굳히기 — 방 89건이 삭제된 매물을 가리켜 런타임 조인은 실패한다.
    car_number: car,
    vehicle_name: name,
    product_code: S(r.product_code) || S(src.product_code) || S(r.product_uid),
  };
}

// ── 3. 메시지 (flat + room_id 실체화) ──────────────────────────────────
const v4messages: Rec = {};
{
  let orphan = 0;
  for (const [bucket, bag] of Object.entries((db.messages || {}) as Rec)) {
    if (!isObj(bag)) continue;
    if (!roomAlive.has(bucket)) { orphan += Object.keys(bag).length; continue; }
    for (const [pushId, m] of Object.entries(bag)) {
      if (!isObj(m)) continue;
      // room_id 실체화 — 원본엔 이 필드가 없고 버킷 키가 유일한 소속 정보다.
      // 없으면 오버레이 조회(orderByChild('room_id'))가 전건 미스한다.
      v4messages[pushId] = { ...m, _key: pushId, room_id: bucket };
    }
  }
  if (orphan) skip('messages', '(삭제된 방 소속)', `${orphan}건 — 방이 없어 읽을 경로 자체가 없음`);
}

// ── 4. 계약 (코드 유지) ────────────────────────────────────────────────
const v4contracts: Rec = {};
const contractByCode = new Map<string, Rec>();
for (const [k, c] of entries('contracts')) {
  if (isDeleted(c)) { skip('contracts', k, '삭제됨'); continue; }
  const code = S(c.contract_code);
  if (!code) { skip('contracts', k, '계약코드 없음 — 상태·차번·고객명 동시 결손인 껍데기'); continue; }
  const src = lookupProduct(c) || {};
  const rec = {
    ...c, _key: code, contract_code: code,
    // 계약 다수가 삭제 매물을 가리킨다 → 스냅샷을 굳혀 조인 의존을 끊는다.
    car_number_snapshot: S(c.car_number_snapshot) || S(src.car_number),
    vehicle_name_snapshot: S(c.vehicle_name_snapshot)
      || [S(c.maker_snapshot), S(c.sub_model_snapshot)].filter(Boolean).join(' ')
      || vehicleNameOf(src),
  };
  v4contracts[code] = rec;
  contractByCode.set(code, rec);
}

// ── 5. 정산 (키·코드 유지 + 계약조인 확정) ─────────────────────────────
const v4settlements: Rec = {};
for (const [k, s] of entries('settlements')) {
  if (isDeleted(s)) { skip('settlements', k, '삭제됨'); continue; }
  const code = S(s.contract_code);
  const c = contractByCode.get(code);
  if (!c) skip('settlements', k, '계약 참조 해석 실패 — 원본이 삭제된 계약을 가리킴', `contract_code=${code}`);
  v4settlements[k] = {
    ...s, _key: k,
    // 조인 굳히기 + 포맷 통일(원본은 epoch ms와 YYYY-MM-DD가 섞여 정렬·표시가 깨진다)
    contract_date: toDate(s.contract_date) || toDate(c?.contract_date) || toDate(c?.created_at),
  };
}

// ── 6. 고객 (pushId 유지 — 계약이 이 키를 가리킨다) ────────────────────
const v4customers: Rec = {};
for (const [k, c] of entries('customers')) {
  if (isDeleted(c)) { skip('customers', k, '삭제됨'); continue; }
  v4customers[k] = { ...c, _key: k };
}

// ── 7. 정책 ────────────────────────────────────────────────────────────
const v4policies: Rec = {};
for (const [k, p] of entries('policies')) {
  if (isDeleted(p)) { skip('policies', k, '삭제됨'); continue; }
  const key = S(p.policy_code) || k;
  v4policies[key] = { ...p, _key: key, policy_code: key };
}

// ── 8. 전자서명 — 만료·더미는 제외(PII), 유효분만 ──────────────────────
const v4sign: Rec = {};
{
  const now = Date.now();
  for (const [k, s] of entries('contract_sign')) {
    const exp = Number(s.expires_at || 0);
    if (exp && exp < now) {
      skip('contract_sign', k, '만료됨 — 평문 PII 보유라 이관 대신 원본 삭제 대상', `expires=${new Date(exp).toISOString().slice(0, 10)}`);
      continue;
    }
    v4sign[k] = { ...s, _key: k };
  }
}

// ── 출력 ──────────────────────────────────────────────────────────────
mkdirSync(OUTDIR, { recursive: true });

const cnt = (o: Rec) => Object.keys(o).length;
const live = (n: string) => entries(n).filter(([, r]) => !isDeleted(r)).length;
let msgSrc = 0; for (const b of Object.values((db.messages || {}) as Rec)) if (isObj(b)) msgSrc += Object.keys(b).length;

const L: string[] = [];
L.push('# v3 → v4 이관 드라이런 리포트', '');
L.push(`- 입력: \`${SRC}\``);
L.push('- **코드 재발급 없음** — 기존 코드 그대로. (파트너·공급사 코드는 users와 업무데이터를 잇는 조인키라,');
L.push('  한쪽만 바꾸면 공급사 계정에서 매물·계약·정산이 전부 0건이 된다)');
L.push('- **매물 미이관** — 시트 동기화로 새로 채운다. v4에 이미 5,629건이 있어 실물 중복·이중판매 위험');
L.push('- 미이관: 회원(users)·카운터(counters) = 루트 공유·erp3 사용 중 / 감사로그 = PII 정리');
L.push(`- 참고 미이관: vehicle_master ${entries('vehicle_master').length} · product_code_aliases ${entries('product_code_aliases').length} · input_codes ${entries('input_codes').length} · code_sequences ${entries('code_sequences').length} · fcm_tokens ${entries('fcm_tokens').length} · home_notices ${entries('home_notices').length} — erp4가 읽지 않음`, '');

if (errors.length) {
  L.push('## ⛔ 중단 — 정리 후 재실행 (페이로드 미생성)', '');
  for (const e of errors) L.push(`- ${e}`);
  L.push('');
}

L.push('## 노드별 건수', '', '| 노드 | 원본(삭제제외) | 이관 | 차이 |', '|---|---|---|---|');
const row = (label: string, s: number, o: number) => L.push(`| ${label} | ${s} | ${o} | ${s - o} |`);
row('파트너', live('partners'), cnt(v4partners));
row('방', live('rooms'), cnt(v4rooms));
row('메시지', msgSrc, cnt(v4messages));
row('계약', live('contracts'), cnt(v4contracts));
row('정산', live('settlements'), cnt(v4settlements));
row('고객', live('customers'), cnt(v4customers));
row('정책', live('policies'), cnt(v4policies));
row('전자서명', entries('contract_sign').length, cnt(v4sign));
L.push('');

L.push('## 참조 무결성', '');
const rv = Object.values(v4rooms) as Rec[];
const adminRooms = rv.filter((r) => r.is_admin_chat === true || S(r._key).startsWith('ADMIN_')).length;
const named = rv.filter((r) => S(r.vehicle_name) || S(r.car_number)).length;
L.push(`- 방 표시정보(차명 또는 차번): **${named}/${cnt(v4rooms)}** — 관리자 상담방 ${adminRooms}건은 차량 없음이 정상`);
const cv = Object.values(v4contracts) as Rec[];
L.push(`- 계약 스냅샷(차명 또는 차번): **${cv.filter((c) => S(c.vehicle_name_snapshot) || S(c.car_number_snapshot)).length}/${cnt(v4contracts)}**`);
const sv = Object.values(v4settlements) as Rec[];
L.push(`- 정산 → 계약 연결: ${sv.filter((s) => contractByCode.has(S(s.contract_code))).length}/${cnt(v4settlements)}`);
L.push(`- 정산 contract_date 확보: ${sv.filter((s) => S(s.contract_date)).length}/${cnt(v4settlements)} (전부 YYYY-MM-DD로 통일)`);
L.push(`- 메시지 → 방 연결: ${(Object.values(v4messages) as Rec[]).filter((m) => v4rooms[S(m.room_id)]).length}/${cnt(v4messages)}`);
L.push(`- 계약 → 고객 연결: ${cv.filter((c) => S(c.customer_uid) && v4customers[S(c.customer_uid)]).length}/${cv.filter((c) => S(c.customer_uid)).length} (customer_uid 보유분 기준)`);
L.push('');

if (notes.length) { L.push('## 확인 필요', ''); for (const n of notes) L.push(`- ${n}`); L.push(''); }

L.push('## 제외 내역', '', '| 노드 | 사유 | 건수 |', '|---|---|---|');
const byReason = new Map<string, number>();
for (const s of skips) byReason.set(`${s.node}|${s.reason.split('—')[0].trim()}`, (byReason.get(`${s.node}|${s.reason.split('—')[0].trim()}`) || 0) + 1);
for (const [k, v] of [...byReason].sort((a, b) => b[1] - a[1])) { const [n, r] = k.split('|'); L.push(`| ${n} | ${r} | ${v} |`); }
L.push('');
const detail = skips.filter((s) => s.hint);
if (detail.length) {
  L.push('### 개별 확인', '');
  for (const s of detail.slice(0, 30)) L.push(`- \`${s.node}/${s.key}\` — ${s.reason} · ${s.hint}`);
  if (detail.length > 30) L.push(`- … 외 ${detail.length - 30}건`);
  L.push('');
}

writeFileSync(join(OUTDIR, 'report.md'), L.join('\n') + '\n', 'utf8');
console.log(L.join('\n'));

if (errors.length) {
  console.error('\n⛔ 선결 정리가 끝나지 않아 페이로드를 생성하지 않았다.');
  process.exit(2);
}

const payload: Rec = {
  partners: v4partners,
  rooms: v4rooms,
  messages: v4messages,
  contracts: v4contracts,
  settlements: v4settlements,
  customers: v4customers,
  policies: v4policies,
  contract_sign: v4sign,
};
writeFileSync(join(OUTDIR, 'v4-payload.json'), JSON.stringify(payload, null, 1), 'utf8');
console.log(`\n페이로드: ${join(OUTDIR, 'v4-payload.json')}`);
