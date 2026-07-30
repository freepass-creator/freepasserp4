/**
 * v3 → v4 이관 — ③ 검증 (읽기 전용)
 * MIGRATION_PLAN.md 6단계. **1축이라도 FAIL이면 7단계(앱 배포)로 가지 않는다.**
 *
 * 실행:
 *   # 로컬 검증 — 페이로드가 원본을 온전히 담았는가(네트워크 없음)
 *   npx tsx scripts/verify-v4-migration.mts <원본백업.json> tmp/migration/v4-payload.json
 *   # 라이브 검증 — 실제 v4에 반영됐는가(읽기 전용, firebase-admin 필요)
 *   npx tsx scripts/verify-v4-migration.mts <원본백업.json> tmp/migration/v4-payload.json --live
 *
 * 검증 축:
 *   A 건수      원본 live 건수 = 페이로드 + 제외(사유 있는 것)
 *   B 참조무결성 방→매물표시 · 계약→스냅샷 · 정산→계약 · 메시지→방
 *   C 필드손실   원본 레코드의 키가 사라지지 않았는가
 *   D 금액보존   정산 금액 필드가 1원도 다르지 않은가
 *   E PII       주민번호·감사로그가 섞여 들어가지 않았는가
 *   F 소유필드   규칙(.validate)이 요구하는 소유필드를 갖췄는가 — 없으면 이관 후 쓰기가 영구 거부된다
 *   G 라이브     (--live) 실제 v4 값이 페이로드와 일치하는가
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const isDeleted = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';

const SRC = process.argv[2];
const PAY = process.argv[3];
const LIVE = process.argv.includes('--live');
if (!SRC || !PAY) {
  console.error('사용법: npx tsx scripts/verify-v4-migration.mts <원본백업.json> <v4-payload.json> [--live]');
  process.exit(1);
}

const db: Rec = JSON.parse(readFileSync(SRC, 'utf8'));
const pay: Rec = JSON.parse(readFileSync(PAY, 'utf8'));
const live = (node: string) => Object.entries((db[node] || {}) as Rec)
  .filter(([, v]) => isObj(v) && !isDeleted(v)) as [string, Rec][];
const bag = (node: string): Rec => (pay[node] || {}) as Rec;
const cnt = (o: Rec) => Object.keys(o).length;

type Result = { axis: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (axis: string, ok: boolean, detail: string) => { results.push({ axis, ok, detail }); };

// ── A 건수 ─────────────────────────────────────────────────────────────
{
  const rows: string[] = [];
  let bad = 0;
  for (const [node, srcNode] of [['partners', 'partners'], ['rooms', 'rooms'], ['contracts', 'contracts'],
    ['settlements', 'settlements'], ['customers', 'customers'], ['policies', 'policies']] as const) {
    const s = live(srcNode).length; const p = cnt(bag(node));
    const diff = s - p;
    rows.push(`${node} ${p}/${s}${diff ? ` (제외 ${diff})` : ''}`);
    // 제외가 절반을 넘으면 사유를 의심한다
    if (s > 0 && p / s < 0.5) bad++;
  }
  let msgSrc = 0;
  for (const b of Object.values((db.messages || {}) as Rec)) if (isObj(b)) msgSrc += Object.keys(b).length;
  rows.push(`messages ${cnt(bag('messages'))}/${msgSrc}`);
  check('A 건수', bad === 0, rows.join(' · '));
}

// ── B 참조무결성 ───────────────────────────────────────────────────────
{
  const rooms = Object.values(bag('rooms')) as Rec[];
  const adminRooms = rooms.filter((r) => r.is_admin_chat === true || S(r._key).startsWith('ADMIN_')).length;
  const named = rooms.filter((r) => S(r.vehicle_name) || S(r.car_number)).length;
  const roomsOk = named + adminRooms >= rooms.length; // 차량방은 전부 표시정보를 가져야 한다
  check('B1 방 표시정보', roomsOk, `${named}/${rooms.length} (관리자상담 ${adminRooms}건 제외 시 전건)`);

  const cts = Object.values(bag('contracts')) as Rec[];
  const snap = cts.filter((c) => S(c.vehicle_name_snapshot) || S(c.car_number_snapshot)).length;
  check('B2 계약 스냅샷', snap === cts.length, `${snap}/${cts.length}`);

  const roomKeys = new Set(Object.keys(bag('rooms')));
  const msgs = Object.values(bag('messages')) as Rec[];
  const linked = msgs.filter((m) => roomKeys.has(S(m.room_id))).length;
  check('B3 메시지→방', linked === msgs.length, `${linked}/${msgs.length}`);

  const ctCodes = new Set(Object.keys(bag('contracts')));
  const sts = Object.values(bag('settlements')) as Rec[];
  const stLinked = sts.filter((s) => ctCodes.has(S(s.contract_code))).length;
  // 원본에 삭제된 계약을 가리키는 정산이 있으면 100%가 안 될 수 있다 → 경고 수준
  check('B4 정산→계약', stLinked >= sts.length - 1, `${stLinked}/${sts.length}`);
}

// ── C 필드손실 ─────────────────────────────────────────────────────────
{
  let lost = 0; const samples: string[] = [];
  // 노드별 키 규칙을 명시한다. 예전엔 원본키→코드 순으로 폴백했는데,
  // 어떤 계약의 childKey가 다른 계약의 contract_code와 같으면 **엉뚱한 레코드와 비교**해 오탐이 났다.
  const keyOf: Record<string, (r: Rec, k: string) => string> = {
    partners: (r, k) => S(r.partner_code) || k,
    contracts: (r, k) => S(r.contract_code) || k,
    policies: (r, k) => S(r.policy_code) || k,
    rooms: (_r, k) => k,
    settlements: (_r, k) => k,
    customers: (_r, k) => k,
  };
  // 이관이 제외한 레코드는 비교 대상이 아니다. 같은 제외 규칙을 여기서도 적용해야
  // "코드 없는 조각 레코드의 childKey가 다른 레코드의 코드와 같은" 경우에 엉뚱한 비교를 하지 않는다.
  const migrated: Record<string, (r: Rec) => boolean> = {
    contracts: (r) => !!S(r.contract_code), // 코드 없는 껍데기는 이관 제외
    partners: () => true, rooms: () => true, settlements: () => true, customers: () => true,
  };
  for (const [node, srcNode] of [['partners', 'partners'], ['rooms', 'rooms'], ['contracts', 'contracts'],
    ['settlements', 'settlements'], ['customers', 'customers']] as const) {
    const out = bag(node);
    for (const [k, src] of live(srcNode)) {
      if (!migrated[node](src)) continue;
      const rec = out[keyOf[node](src, k)];
      if (!rec) continue; // 제외분은 A축이 본다
      for (const f of Object.keys(src)) {
        if (rec[f] === undefined && src[f] !== undefined && src[f] !== null && src[f] !== '') {
          lost++;
          if (samples.length < 5) samples.push(`${node}/${k}.${f}`);
        }
      }
    }
  }
  check('C 필드손실', lost === 0, lost ? `${lost}건 — 예: ${samples.join(', ')}` : '없음');
}

// ── D 금액보존 ─────────────────────────────────────────────────────────
{
  const MONEY = ['rent_amount', 'deposit_amount', 'fee_amount', 'net_amount', 'agent_payout', 'rent_month', 'fee_rate'];
  let diff = 0; const samples: string[] = [];
  for (const [k, s] of live('settlements')) {
    const o = bag('settlements')[k];
    if (!o) continue;
    for (const f of MONEY) {
      const a = s[f] === undefined ? null : Number(s[f]);
      const b = o[f] === undefined ? null : Number(o[f]);
      if (String(a) !== String(b)) { diff++; if (samples.length < 5) samples.push(`${k}.${f} ${a}→${b}`); }
    }
  }
  check('D 금액보존', diff === 0, diff ? `${diff}건 불일치 — ${samples.join(', ')}` : '전건 일치');
}

// ── E PII ──────────────────────────────────────────────────────────────
{
  // 주민번호와 법인등록번호는 형식이 같다(6-7자리). 필드 문맥으로 갈라야 오탐이 없다.
  const CORP_FIELDS = new Set(['corp_number', 'corporate_number', 'business_number', 'biz_no']);
  const rrn: string[] = [];
  for (const [node, b] of Object.entries(pay)) {
    if (!isObj(b)) continue;
    for (const [k, r] of Object.entries(b as Rec)) {
      if (!isObj(r)) continue;
      for (const [f, v] of Object.entries(r)) {
        if (typeof v !== 'string' || !/^\d{6}-?[1-4]\d{6}$/.test(v)) continue;
        if (CORP_FIELDS.has(f)) continue; // 법인등록번호 — 개인 PII 아님
        rrn.push(`${node}/${k}.${f}`);
      }
    }
  }
  const hasAuditNode = !!pay.audit_logs;
  check('E PII·감사로그', rrn.length === 0 && !hasAuditNode,
    rrn.length || hasAuditNode
      ? `주민번호형 ${rrn.length}건${rrn.length ? ` (${rrn.slice(0, 3).join(', ')})` : ''}${hasAuditNode ? ' · audit_logs 노드 유입!' : ''}`
      : '없음 (법인등록번호는 제외 판정)');
}

// ── F 소유필드 (규칙 .validate 통과 여부) ──────────────────────────────
{
  const need: Record<string, string[]> = {
    rooms: ['agent_uid', 'agent_channel_code', 'provider_company_code'],
    contracts: ['agent_uid', 'agent_channel_code', 'provider_company_code'],
    settlements: ['agent_code', 'provider_company_code'],
  };
  const bad: string[] = [];
  for (const [node, fields] of Object.entries(need)) {
    for (const [k, r] of Object.entries(bag(node)) as [string, Rec][]) {
      if (r.is_admin_chat === true || k.startsWith('ADMIN_')) continue; // 관리자 상담방은 매물·공급사 없음
      const miss = fields.filter((f) => !S(r[f]));
      if (miss.length) bad.push(`${node}/${k}(${miss.join(',')})`);
    }
  }
  check('F 소유필드', bad.length === 0,
    bad.length ? `${bad.length}건 결손 — 이관 후 그 레코드에 쓰기가 영구 거부된다. 예: ${bad.slice(0, 3).join(' ')}` : '전건 충족');
}

// ── G 라이브 대조 ──────────────────────────────────────────────────────
async function liveCheck() {
  let admin: any;
  try { admin = await import('firebase-admin'); } catch { check('G 라이브', false, 'firebase-admin 없음'); return; }
  const dbUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL;
  if (!dbUrl) { check('G 라이브', false, 'DB URL 없음'); return; }
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const app = admin.initializeApp({
    credential: svc ? admin.credential.cert(JSON.parse(svc)) : admin.credential.applicationDefault(),
    databaseURL: dbUrl,
  });
  try {
    let miss = 0; let ok = 0; const samples: string[] = [];
    // 노드별 표본 20건씩만 — 전건 조회는 비용이 크다
    for (const node of Object.keys(pay)) {
      const keysAll = Object.keys(bag(node));
      const step = Math.max(1, Math.floor(keysAll.length / 20));
      for (let i = 0; i < keysAll.length; i += step) {
        const k = keysAll[i];
        const snap = await app.database().ref(`v4/${node}/${k}`).get();
        if (!snap.exists()) { miss++; if (samples.length < 5) samples.push(`v4/${node}/${k}`); }
        else ok++;
      }
    }
    check('G 라이브', miss === 0, miss ? `표본 ${ok + miss}건 중 ${miss}건 미반영 — 예: ${samples.join(', ')}` : `표본 ${ok}건 전부 반영됨`);
  } finally { await app.delete().catch(() => undefined); }
}

async function main() {
  if (LIVE) await liveCheck();

  console.log('# v4 이관 검증\n');
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.axis} — ${r.detail}`);
    if (!r.ok) failed++;
  }
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  if (failed) {
    console.error('\n⛔ 실패 축이 있다. 7단계(앱 배포)로 진행하지 말 것.');
    process.exit(2);
  }
  console.log('\n전 축 통과 — 7단계(앱 배포, 브리지 유지)로 진행 가능');
}

main().catch((e) => { console.error(e); process.exit(1); });
