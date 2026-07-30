/**
 * erp3(v3) → erp4(v4) 이관 — ① 변환 전용 (네트워크 없음)
 *
 * 백업 JSON을 읽어 v4 페이로드와 리포트를 만든다. 실제 쓰기는 하지 않는다(드라이런).
 * MIGRATION_PLAN.md 4단계.
 *
 * 실행:
 *   npx tsx scripts/migrate-v3-to-v4.mts <백업.json> [출력디렉터리]
 *   예) npx tsx scripts/migrate-v3-to-v4.mts C:/Users/user/Downloads/freepasserp3-rtdb-backup-2026-07-27-101030.json tmp/migration
 *
 * 설계 근거는 MIGRATION_PLAN.md §5. 요점:
 *  · 코드 재발급 = 매물 M- / 파트너 P- / 계약 C- / 방 CH-. **회원 user_code는 건드리지 않는다**
 *    (users는 루트 공유 노드이고 erp3가 진행 중 계약 30건에 계속 사용 → 바꾸면 erp3가 깨진다)
 *  · 조인은 이관 시점에 굳힌다(차명·차번·contract_date) → 런타임 조인 제거
 *  · 참조 무결성이 깨지는 건은 '제외 + 사유'로 남긴다. 조용히 버리지 않는다
 *  · 멱등 — 같은 입력이면 같은 출력(정렬·결정적 채번)
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

/** 소프트삭제 판정 — v3는 _deleted 불리언과 status:'deleted' 두 갈래를 쓴다. */
const isDeleted = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';

// 리포트 누적
type Skip = { node: string; key: string; reason: string; hint?: string };
const skips: Skip[] = [];
const errors: string[] = [];
const notes: string[] = [];
const skip = (node: string, key: string, reason: string, hint?: string) => skips.push({ node, key, reason, hint });

// ── 0. 선결 검사 — 여기서 걸리면 사람이 정리한 뒤 재실행 ──────────────────
// 파트너 리키잉 충돌: partner_code 기준으로 키를 만들면 서로 다른 레코드가 한 키로 합쳐져
// 조용히 사라지고 이름까지 뒤바뀐다(실측 49→46). 에러로 세운다.
{
  const byCode = new Map<string, string[]>();
  for (const [k, p] of entries('partners')) {
    const code = S(p.partner_code) || k;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(`${k}(${S(p.name || p.partner_name || p.company_name) || '이름없음'})`);
  }
  for (const [code, list] of byCode) {
    if (list.length > 1) errors.push(`파트너 코드 충돌 '${code}' ← ${list.join(' , ')} — 코드 재부여 후 재실행`);
  }
}
// user_code 중복: 정산 스코프가 agent_code(=user_code) 쿼리라 남의 정산이 보인다.
{
  const byCode = new Map<string, string[]>();
  for (const [k, u] of entries('users')) {
    if (isDeleted(u)) continue;
    const c = S(u.user_code);
    if (!c) continue;
    if (!byCode.has(c)) byCode.set(c, []);
    byCode.get(c)!.push(`${k.slice(0, 8)}…(${S(u.name) || S(u.email) || '이름없음'})`);
  }
  for (const [c, list] of byCode) {
    if (list.length > 1) errors.push(`user_code 중복 '${c}' ← ${list.join(' , ')} — 재부여 후 재실행(정산 스코프가 이 값을 쓴다)`);
  }
}

// ── 1. 파트너 → v4/partners (P-NNN 재발급) ────────────────────────────
const partnerNew = new Map<string, string>(); // 옛 코드/키 → P-NNN
const v4partners: Rec = {};
{
  const live = entries('partners').filter(([, p]) => !isDeleted(p));
  // 결정적 순서 — 옛 코드 사전순. 재실행해도 같은 번호가 나오게(멱등).
  live.sort((a, b) => (S(a[1].partner_code) || a[0]).localeCompare(S(b[1].partner_code) || b[0]));
  live.forEach(([oldKey, p], i) => {
    const nk = `P-${String(i + 1).padStart(3, '0')}`;
    const oldCode = S(p.partner_code) || oldKey;
    partnerNew.set(oldCode, nk);
    partnerNew.set(oldKey, nk);
    v4partners[nk] = {
      ...p,
      _key: nk,
      partner_code: nk,
      legacy_code: oldCode,
      name: S(p.name) || S(p.partner_name) || S(p.company_name) || oldCode,
    };
  });
  for (const [k, p] of entries('partners')) if (isDeleted(p)) skip('partners', k, '삭제됨');
}
// 참조되는데 마스터가 없는 코드 — SP999가 대표(users 96명이 소속으로 참조)
{
  const referenced = new Set<string>();
  for (const [, u] of entries('users')) {
    for (const f of ['company_code', 'agent_channel_code']) { const v = S(u[f]); if (v) referenced.add(v); }
  }
  for (const [, p] of entries('products')) {
    for (const f of ['provider_company_code', 'partner_code']) { const v = S(p[f]); if (v) referenced.add(v); }
  }
  const missing = [...referenced].filter((c) => c && !partnerNew.has(c) && !['MASTER', 'admin', 'PROVIDER'].includes(c));
  if (missing.length) {
    notes.push(`파트너 마스터 없는 참조 코드 ${missing.length}종: ${missing.join(', ')}`);
    notes.push('  → SP999처럼 실사용 중인 코드는 파트너 레코드를 먼저 만들어야 소속·정산 스코프가 성립한다.');
  }
}

// ── 2. 매물 → v4/products (M-NNNNNN 재발급 + 트윈 확정) ─────────────────
/** 차량 동일성 — 트윈(같은 실물, 여러 공급사 등록) 판정 키. */
const vehicleKey = (p: Rec) => S(p.car_number) || S(p.vehicle_number) || '';
const richness = (p: Rec) => {
  let s = 0;
  if (isObj(p.price) && Object.keys(p.price).length) s += 5;
  if (p.policy_code) s += 2;
  if (p.maker || p.sub_model || p.model) s += 1;
  if (p.year) s += 1;
  if (p.photos || p.image_urls || p.images) s += 1;
  return s;
};
const productNew = new Map<string, string>(); // 옛 product_code/childKey → M-NNNNNN
const v4products: Rec = {};
const productMeta = new Map<string, Rec>(); // M-키 → 원본(차명·차번 굳히기용)
{
  const live = entries('products').filter(([, p]) => !isDeleted(p));
  // 트윈 정리 — 차량키별로 richness → product_code 유무 → updatedAt 순으로 1건만 남긴다.
  const byVeh = new Map<string, [string, Rec][]>();
  const noVeh: [string, Rec][] = [];
  for (const e of live) {
    const vk = vehicleKey(e[1]);
    if (!vk) { noVeh.push(e); continue; }
    if (!byVeh.has(vk)) byVeh.set(vk, []);
    byVeh.get(vk)!.push(e);
  }
  const winners: [string, Rec][] = [];
  for (const [vk, list] of byVeh) {
    list.sort((a, b) => richness(b[1]) - richness(a[1])
      || (S(b[1].product_code) ? 1 : 0) - (S(a[1].product_code) ? 1 : 0)
      || Number(b[1].updatedAt || b[1].updated_at || 0) - Number(a[1].updatedAt || a[1].updated_at || 0)
      || a[0].localeCompare(b[0]));
    winners.push(list[0]);
    for (const loser of list.slice(1)) skip('products', loser[0], `트윈 중복(차량 ${vk}) — 대표 1건만 이관`);
  }
  winners.push(...noVeh);
  // 결정적 순서 — 차량번호 → 옛 키
  winners.sort((a, b) => (vehicleKey(a[1]) || 'zzz').localeCompare(vehicleKey(b[1]) || 'zzz') || a[0].localeCompare(b[0]));
  winners.forEach(([oldKey, p], i) => {
    const nk = `M-${String(i + 1).padStart(6, '0')}`;
    const oldCode = S(p.product_code) || oldKey;
    productNew.set(oldCode, nk);
    productNew.set(oldKey, nk);
    if (S(p.product_uid)) productNew.set(S(p.product_uid), nk);
    const prov = S(p.provider_company_code) || S(p.partner_code);
    v4products[nk] = {
      ...p,
      _key: nk,
      product_code: nk,
      legacy_code: oldCode,
      legacy_uid: oldKey,
      provider_company_code: partnerNew.get(prov) || prov, // 파트너도 새 코드로
    };
    productMeta.set(nk, p);
  });
  for (const [k, p] of entries('products')) if (isDeleted(p)) skip('products', k, '삭제됨 — 참조는 방·계약에 굳힌 차명/차번으로 해결');
}

/** 매물 참조 해석 — 방·계약이 들고 있는 여러 형태의 식별자를 새 M- 코드로. */
const resolveProduct = (r: Rec): string => {
  for (const f of ['product_code', 'product_uid', 'product_id']) {
    const v = S(r[f]); if (v && productNew.has(v)) return productNew.get(v)!;
  }
  return '';
};
/** erp3 차명 규칙 — sub_model 우선. [maker,model,sub_model,trim] 조합은 "기아 K5 더 뉴 K5" 처럼 중복된다. */
const vehicleNameOf = (r: Rec): string =>
  S(r.vehicle_name) || S(r.sub_model) || [r.maker, r.model, r.trim_name].map(S).filter(Boolean).join(' ');

// ── 3. 방 → v4/rooms (CH-{매물}-{영업} 재발급) ──────────────────────────
const roomNew = new Map<string, string>();
const v4rooms: Rec = {};
{
  const live = entries('rooms').filter(([, r]) => !isDeleted(r));
  live.sort((a, b) => Number(a[1].created_at || 0) - Number(b[1].created_at || 0) || a[0].localeCompare(b[0]));
  const used = new Set<string>();
  for (const [oldKey, r] of live) {
    const isAdminChat = r.is_admin_chat === true || oldKey.startsWith('ADMIN_');
    const mcode = isAdminChat ? '' : resolveProduct(r);
    const agentCode = S(r.agent_code) || S(r.agent_uid).slice(0, 8);
    let nk = isAdminChat ? `CH-ADMIN-${agentCode || oldKey.slice(6, 14)}` : `CH-${mcode}-${agentCode}`;
    if (!isAdminChat && !mcode) {
      // 매물을 못 찾아도 대화는 살린다 — 차명·차번을 굳혀두면 표시에 지장 없다.
      nk = `CH-X${oldKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}-${agentCode}`;
      skip('rooms', oldKey, '매물 참조 해석 실패 — 대화는 이관하되 매물 링크 없음', `product_uid=${S(r.product_uid)} product_code=${S(r.product_code)}`);
    }
    let uniq = nk; let n = 2;
    while (used.has(uniq)) { uniq = `${nk}-${n++}`; }
    used.add(uniq);
    roomNew.set(oldKey, uniq);
    const src = mcode ? (productMeta.get(mcode) || {}) : {};
    v4rooms[uniq] = {
      ...r,
      _key: uniq,
      room_code: uniq,
      legacy_key: oldKey,
      product_code: mcode || '',
      // 조인 굳히기 — 삭제된 매물을 가리키는 방이 89건이라 런타임 조인은 실패한다.
      car_number: S(r.car_number) || S(r.vehicle_number) || S(src.car_number),
      vehicle_name: vehicleNameOf(r) || vehicleNameOf(src),
      provider_company_code: partnerNew.get(S(r.provider_company_code)) || S(r.provider_company_code),
      agent_channel_code: partnerNew.get(S(r.agent_channel_code)) || S(r.agent_channel_code),
    };
  }
  for (const [k, r] of entries('rooms')) if (isDeleted(r)) skip('rooms', k, '삭제됨');
}

// ── 4. 메시지 → v4/messages (flat + room_id 실체화) ─────────────────────
const v4messages: Rec = {};
{
  let orphan = 0;
  for (const [bucket, bag] of Object.entries((db.messages || {}) as Rec)) {
    if (!isObj(bag)) continue;
    const nrid = roomNew.get(bucket);
    if (!nrid) { orphan += Object.keys(bag).length; continue; } // 삭제된 방 소속 — 읽을 경로가 없다
    for (const [pushId, m] of Object.entries(bag)) {
      if (!isObj(m)) continue;
      // room_id 실체화 — 원본엔 이 필드가 없고 버킷 키가 유일한 소속 정보다.
      // 없으면 오버레이 조회(orderByChild('room_id'))가 전건 미스한다.
      v4messages[pushId] = { ...m, _key: pushId, room_id: nrid, legacy_room: bucket };
    }
  }
  if (orphan) skip('messages', '(삭제된 방 소속)', `${orphan}건 — 방이 없어 읽을 경로 자체가 없음`);
}

// ── 5. 계약 → v4/contracts (C-YYMMDD-NN 재발급) ────────────────────────
const contractNew = new Map<string, string>();
const v4contracts: Rec = {};
{
  const live = entries('contracts').filter(([, c]) => !isDeleted(c));
  const usable = live.filter(([k, c]) => {
    if (!S(c.contract_code)) {
      skip('contracts', k, '계약코드 없음 — 상태·차번·고객명도 동시 결손인 껍데기');
      return false;
    }
    return true;
  });
  usable.sort((a, b) => Number(a[1].created_at || 0) - Number(b[1].created_at || 0) || a[0].localeCompare(b[0]));
  const seq = new Map<string, number>();
  for (const [oldKey, c] of usable) {
    const d = new Date(Number(c.created_at || 0) || Date.now());
    const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const n = (seq.get(ymd) || 0) + 1; seq.set(ymd, n);
    const nk = `C-${ymd}-${String(n).padStart(2, '0')}`;
    const oldCode = S(c.contract_code) || oldKey;
    contractNew.set(oldCode, nk);
    contractNew.set(oldKey, nk);
    const mcode = resolveProduct(c);
    const src = mcode ? (productMeta.get(mcode) || {}) : {};
    v4contracts[nk] = {
      ...c,
      _key: nk,
      contract_code: nk,
      legacy_code: oldCode,
      product_code: mcode || '',
      // 계약 34건 중 26건이 삭제 매물을 가리킨다 → 스냅샷을 굳혀 조인 의존을 끊는다.
      car_number_snapshot: S(c.car_number_snapshot) || S(src.car_number),
      vehicle_name_snapshot: S(c.vehicle_name_snapshot)
        || [S(c.maker_snapshot), S(c.sub_model_snapshot)].filter(Boolean).join(' ')
        || vehicleNameOf(src),
      provider_company_code: partnerNew.get(S(c.provider_company_code)) || S(c.provider_company_code),
      agent_channel_code: partnerNew.get(S(c.agent_channel_code)) || S(c.agent_channel_code),
    };
    if (!mcode) skip('contracts', oldKey, '매물 참조 해석 실패 — 스냅샷으로 표시는 가능', `product_code=${S(c.product_code)}`);
  }
  for (const [k, c] of entries('contracts')) if (isDeleted(c)) skip('contracts', k, '삭제됨');
}

// ── 6. 정산 → v4/settlements (ST 유지 + 계약조인 확정) ──────────────────
const v4settlements: Rec = {};
{
  for (const [k, s] of entries('settlements')) {
    if (isDeleted(s)) { skip('settlements', k, '삭제됨'); continue; }
    const oldC = S(s.contract_code);
    const nc = contractNew.get(oldC) || '';
    if (!nc) skip('settlements', k, '계약 참조 해석 실패', `contract_code=${oldC}`);
    const c = nc ? v4contracts[nc] : null;
    v4settlements[k] = {
      ...s,
      _key: k,
      contract_code: nc || oldC,
      legacy_contract: oldC,
      // 조인 굳히기 — 현재 contract_date 0/14 결손
      contract_date: S(s.contract_date) || S(c?.contract_date) || S(c?.created_at),
      provider_company_code: partnerNew.get(S(s.provider_company_code)) || S(s.provider_company_code),
      agent_channel_code: partnerNew.get(S(s.agent_channel_code)) || S(s.agent_channel_code),
    };
  }
}

// ── 7. 고객 → v4/customers (pushId 키 유지 — 계약이 이 키를 가리킨다) ────
const v4customers: Rec = {};
for (const [k, c] of entries('customers')) {
  if (isDeleted(c)) { skip('customers', k, '삭제됨'); continue; }
  v4customers[k] = { ...c, _key: k };
}

// ── 8. 정책 → v4/policies ─────────────────────────────────────────────
const v4policies: Rec = {};
for (const [k, p] of entries('policies')) {
  if (isDeleted(p)) { skip('policies', k, '삭제됨'); continue; }
  const key = S(p.policy_code) || k;
  v4policies[key] = { ...p, _key: key, policy_code: key };
}

// ── 9. 별칭표 — 옛 코드로도 찾을 수 있게 ────────────────────────────────
const v4aliases: Rec = { product: {}, partner: {}, contract: {}, room: {} };
for (const [o, n] of productNew) if (o !== n) v4aliases.product[o.replace(/[.#$/[\]]/g, '_')] = n;
for (const [o, n] of partnerNew) if (o !== n) v4aliases.partner[o.replace(/[.#$/[\]]/g, '_')] = n;
for (const [o, n] of contractNew) if (o !== n) v4aliases.contract[o.replace(/[.#$/[\]]/g, '_')] = n;
for (const [o, n] of roomNew) if (o !== n) v4aliases.room[o.replace(/[.#$/[\]]/g, '_')] = n;

// ── 출력 ──────────────────────────────────────────────────────────────
const payload: Rec = {
  partners: v4partners,
  products: v4products,
  rooms: v4rooms,
  messages: v4messages,
  contracts: v4contracts,
  settlements: v4settlements,
  customers: v4customers,
  policies: v4policies,
  code_aliases: v4aliases,
};

mkdirSync(OUTDIR, { recursive: true });
writeFileSync(join(OUTDIR, 'v4-payload.json'), JSON.stringify(payload, null, 1), 'utf8');

const cnt = (o: Rec) => Object.keys(o).length;
const src = (n: string) => entries(n).length;
let msgSrc = 0; for (const b of Object.values((db.messages || {}) as Rec)) if (isObj(b)) msgSrc += Object.keys(b).length;

const lines: string[] = [];
lines.push('# v3 → v4 이관 드라이런 리포트', '');
lines.push(`- 입력: \`${SRC}\``);
lines.push(`- 회원(users)·카운터(counters)는 **이관 대상 아님** — 루트 공유 노드이고 erp3가 사용 중`);
lines.push(`- 감사로그(audit_logs ${src('audit_logs').toLocaleString()}건) 미이관 — PII 정리`, '');

if (errors.length) {
  lines.push('## ⛔ 중단 사유 — 정리 후 재실행', '');
  for (const e of errors) lines.push(`- ${e}`);
  lines.push('');
}
lines.push('## 노드별 건수', '', '| 노드 | 원본 | 이관 | 제외 |', '|---|---|---|---|');
const row = (label: string, s: number, o: number) => lines.push(`| ${label} | ${s} | ${o} | ${s - o} |`);
row('파트너', src('partners'), cnt(v4partners));
row('매물', src('products'), cnt(v4products));
row('방', src('rooms'), cnt(v4rooms));
row('메시지', msgSrc, cnt(v4messages));
row('계약', src('contracts'), cnt(v4contracts));
row('정산', src('settlements'), cnt(v4settlements));
row('고객', src('customers'), cnt(v4customers));
row('정책', src('policies'), cnt(v4policies));
lines.push('');

lines.push('## 참조 무결성', '');
const roomsWithProduct = Object.values(v4rooms).filter((r: any) => S(r.product_code)).length;
const roomsAdmin = Object.values(v4rooms).filter((r: any) => r.is_admin_chat === true || S(r._key).startsWith('CH-ADMIN')).length;
const roomsNamed = Object.values(v4rooms).filter((r: any) => S(r.vehicle_name) || S(r.car_number)).length;
lines.push(`- 방 → 매물 연결: ${roomsWithProduct}/${cnt(v4rooms)} (관리자 상담방 ${roomsAdmin}건은 매물 없음이 정상)`);
lines.push(`- 방 표시정보(차명 또는 차번) 확보: **${roomsNamed}/${cnt(v4rooms)}** ← 런타임 조인 없이 목록이 그려지는가`);
const ctWithProduct = Object.values(v4contracts).filter((c: any) => S(c.product_code)).length;
const ctNamed = Object.values(v4contracts).filter((c: any) => S(c.vehicle_name_snapshot) || S(c.car_number_snapshot)).length;
lines.push(`- 계약 → 매물 연결: ${ctWithProduct}/${cnt(v4contracts)}`);
lines.push(`- 계약 스냅샷(차명 또는 차번): **${ctNamed}/${cnt(v4contracts)}**`);
const stLinked = Object.values(v4settlements).filter((s: any) => contractNew.get(S(s.legacy_contract))).length;
lines.push(`- 정산 → 계약 연결: ${stLinked}/${cnt(v4settlements)}`);
const msgLinked = Object.values(v4messages).filter((m: any) => v4rooms[S(m.room_id)]).length;
lines.push(`- 메시지 → 방 연결: ${msgLinked}/${cnt(v4messages)}`);
lines.push('');

if (notes.length) { lines.push('## 참고', ''); for (const n of notes) lines.push(`- ${n}`); lines.push(''); }

lines.push('## 제외 내역', '', '| 노드 | 사유 | 건수 |', '|---|---|---|');
const byReason = new Map<string, number>();
for (const s of skips) {
  const k = `${s.node}|${s.reason.split('—')[0].trim()}`;
  byReason.set(k, (byReason.get(k) || 0) + 1);
}
for (const [k, v] of [...byReason].sort((a, b) => b[1] - a[1])) {
  const [node, reason] = k.split('|');
  lines.push(`| ${node} | ${reason} | ${v} |`);
}
lines.push('');
const detail = skips.filter((s) => s.hint).slice(0, 40);
if (detail.length) {
  lines.push('### 개별 확인 필요', '');
  for (const s of detail) lines.push(`- \`${s.node}/${s.key}\` — ${s.reason} · ${s.hint}`);
  lines.push('');
}

lines.push('## 코드 재발급 예시', '');
const sample = (m: Map<string, string>, n: number) => [...m].filter(([o, v]) => o !== v).slice(0, n);
for (const [label, m] of [['매물', productNew], ['파트너', partnerNew], ['계약', contractNew], ['방', roomNew]] as const) {
  const ex = sample(m, 3).map(([o, n2]) => `\`${o}\` → \`${n2}\``).join(' · ');
  if (ex) lines.push(`- ${label}: ${ex}`);
}

writeFileSync(join(OUTDIR, 'report.md'), lines.join('\n') + '\n', 'utf8');

console.log(lines.join('\n'));
console.log(`\n페이로드: ${join(OUTDIR, 'v4-payload.json')}`);
if (errors.length) { console.error('\n⛔ 중단 사유가 있다. 정리 후 재실행할 것.'); process.exit(2); }
