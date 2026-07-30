/**
 * 이관 전 데이터 선정리 — 패치 산출 전용 (네트워크 없음)
 * MIGRATION_PLAN.md 3단계.
 *
 * 실행:
 *   npx tsx scripts/pre-migration-cleanup.mts <백업.json> [출력디렉터리]
 *
 * 산출물: tmp/migration/cleanup-patch.json
 *   RTDB **멀티패스 업데이트** 형식(경로→값 평면 맵). 중첩 객체를 쓰면 상위 키가
 *   통째로 대체되므로 반드시 평면 경로여야 한다.
 *
 * 적용(owner 권한 필요 — 별도 실행):
 *   npx firebase-tools@13 database:update / tmp/migration/cleanup-patch.json --project freepasserp3
 *
 * ── 정리 대상과 근거(백업 실측) ──
 *  ① 파트너 코드 충돌 RP011
 *     연카   : 키=RP011 · partner_code=RP011 · type=provider · active · 매물 24건 참조 → **주인**
 *     렌트존 : 키=PT-0014 · partner_code=RP011(오입력) · type 미설정 · 참조 0건 → 자기 키로 교정
 *     그대로 두면 erp4가 partner_code로 리키잉할 때 한 키에 합쳐져 한 곳이 조용히 사라지고
 *     이름까지 뒤바뀐다(실측 49→46).
 *  ② user_code 중복 U0001 (3계정)
 *     이관영(carpisode@gmail.com·active) = 실사용 → 유지
 *     test@test.com ×2 = 이름 없음·미승인 → 소프트삭제
 *     정산 스코프가 agent_code(=user_code) 쿼리라 중복이면 남의 정산이 보인다.
 *  ③ SP999 파트너 마스터 없음
 *     회원 96명 소속 + 76명 채널이 참조하는데 레코드가 없다(개인 영업자 채널).
 *     마스터가 없으면 소속 표시·정산 스코프가 성립하지 않는다.
 *  ④ 만료 전자서명 1건 — 평문 PII(주소·연락처·서명이미지) 보유 + 무인증 공개 읽기 노드
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

const SRC = process.argv[2];
const OUTDIR = process.argv[3] || 'tmp/migration';
if (!SRC) { console.error('사용법: npx tsx scripts/pre-migration-cleanup.mts <백업.json> [출력디렉터리]'); process.exit(1); }

const db: Rec = JSON.parse(readFileSync(SRC, 'utf8'));
const now = new Date().toISOString();
const patch: Rec = {};
const plan: string[] = [];
const warn: string[] = [];
const manual: string[] = [];

// ── ① 파트너 코드 충돌 해소 ────────────────────────────────────────────
{
  const byCode = new Map<string, [string, Rec][]>();
  for (const [k, p] of Object.entries(db.partners || {}) as [string, Rec][]) {
    if (!isObj(p) || p._deleted === true || S(p.status) === 'deleted') continue;
    const code = S(p.partner_code) || k;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push([k, p]);
  }
  for (const [code, list] of byCode) {
    if (list.length < 2) continue;
    // 주인 = 자기 childKey와 partner_code가 일치하는 쪽. 그게 없으면 참조 수가 많은 쪽.
    const owner = list.find(([k, p]) => k === code && S(p.partner_code) === code)
      || list.find(([k]) => k === code)
      || list[0];
    for (const [k, p] of list) {
      if (k === owner[0]) continue;
      const nm = S(p.name || p.partner_name || p.company_name) || k;
      // 자기 childKey를 코드로 되돌린다(참조 0건이므로 안전). 참조가 있으면 사람이 판단해야 한다.
      patch[`partners/${k}/partner_code`] = k;
      patch[`partners/${k}/updated_at`] = Date.now();
      plan.push(`파트너 '${nm}'(키 ${k})의 partner_code: '${code}' → '${k}' (오입력 교정, 주인=${S(owner[1].name || owner[1].partner_name) || owner[0]})`);
      // 참조 실측 — 있으면 경고
      let refs = 0;
      for (const [, pr] of Object.entries(db.products || {}) as [string, Rec][]) {
        if (!isObj(pr)) continue;
        if (S(pr.provider_company_code) === k || S(pr.partner_code) === k) refs++;
      }
      if (refs) warn.push(`  ⚠ '${nm}'(${k})를 직접 참조하는 매물 ${refs}건 — 코드 교정 후 그 매물의 소유코드도 함께 확인 필요`);
    }
  }
}

// ── ② user_code 중복 해소 ─────────────────────────────────────────────
{
  const byCode = new Map<string, [string, Rec][]>();
  for (const [k, u] of Object.entries(db.users || {}) as [string, Rec][]) {
    if (!isObj(u) || u._deleted === true || S(u.status) === 'deleted') continue;
    const c = S(u.user_code);
    if (!c) continue;
    if (!byCode.has(c)) byCode.set(c, []);
    byCode.get(c)!.push([k, u]);
  }
  for (const [code, list] of byCode) {
    if (list.length < 2) continue;
    // 실사용 판정 — 이름·활성상태·업무참조가 있는 쪽을 남긴다.
    const score = ([k, u]: [string, Rec]) => {
      let s = 0;
      if (S(u.name)) s += 4;
      if (S(u.status) === 'active') s += 3;
      if (!/test@/i.test(S(u.email))) s += 2;
      for (const [, c] of Object.entries(db.contracts || {}) as [string, Rec][]) {
        if (isObj(c) && (S(c.agent_uid) === k || S(c.agent_code) === code)) { s += 1; break; }
      }
      return s;
    };
    const sorted = [...list].sort((a, b) => score(b) - score(a));
    const keep = sorted[0];
    plan.push(`user_code '${code}' 유지 = ${S(keep[1].name) || S(keep[1].email)} (${keep[0].slice(0, 10)}…)`);
    for (const [k, u] of sorted.slice(1)) {
      const who = S(u.name) || S(u.email) || k.slice(0, 10);
      // 소프트삭제 — 하드삭제는 하지 않는다(참조가 남아 있을 수 있고, 되돌릴 수 없다).
      patch[`users/${k}/_deleted`] = true;
      patch[`users/${k}/status`] = 'deleted';
      patch[`users/${k}/is_active`] = false;
      patch[`users/${k}/deleted_at`] = now;
      patch[`users/${k}/deleted_reason`] = `user_code '${code}' 중복 정리(이관 전)`;
      plan.push(`  → 중복 계정 '${who}' 소프트삭제 (${k})`);
      manual.push(`Firebase Auth에서 uid ${k} 계정 disable — 소프트삭제만으로는 로그인이 막히지 않는다`);
    }
  }
}

// ── ③ 참조되는데 마스터 없는 파트너 코드 ───────────────────────────────
{
  const have = new Set<string>();
  for (const [k, p] of Object.entries(db.partners || {}) as [string, Rec][]) {
    if (!isObj(p)) continue;
    have.add(k); const c = S(p.partner_code); if (c) have.add(c);
  }
  const refCount = new Map<string, { user: number; room: number; contract: number }>();
  const bump = (v: unknown, kind: 'user' | 'room' | 'contract') => {
    const s = S(v); if (!s) return;
    if (!refCount.has(s)) refCount.set(s, { user: 0, room: 0, contract: 0 });
    refCount.get(s)![kind]++;
  };
  for (const [, u] of Object.entries(db.users || {}) as [string, Rec][]) { if (isObj(u)) { bump(u.company_code, 'user'); bump(u.agent_channel_code, 'user'); } }
  for (const [, r] of Object.entries(db.rooms || {}) as [string, Rec][]) { if (isObj(r)) { bump(r.provider_company_code, 'room'); bump(r.agent_channel_code, 'room'); } }
  for (const [, c] of Object.entries(db.contracts || {}) as [string, Rec][]) { if (isObj(c)) { bump(c.provider_company_code, 'contract'); bump(c.agent_channel_code, 'contract'); } }

  const SYS = new Set(['MASTER', 'admin', 'PROVIDER']);
  const missing = [...refCount].filter(([c]) => !have.has(c) && !SYS.has(c))
    .sort((a, b) => (b[1].user + b[1].room + b[1].contract) - (a[1].user + a[1].room + a[1].contract));

  for (const [code, n] of missing) {
    const total = n.user + n.room + n.contract;
    if (code === 'SP999') {
      // 개인 영업자 채널 — 소속 표시·정산 스코프가 성립하려면 마스터가 있어야 한다.
      patch['partners/SP999/partner_code'] = 'SP999';
      patch['partners/SP999/name'] = '개인 영업자';
      patch['partners/SP999/partner_type'] = '영업채널';
      patch['partners/SP999/is_active'] = true;
      patch['partners/SP999/status'] = 'active';
      patch['partners/SP999/created_at'] = Date.now();
      patch['partners/SP999/note'] = '소속 채널 없는 개인 영업자용 기본 채널(이관 전 신설)';
      plan.push(`파트너 'SP999' 신설 = 개인 영업자 (회원 ${n.user} · 방 ${n.room} · 계약 ${n.contract} 참조)`);
    } else if (/^[A-Z]{2}\d{3}$|^PT-\d{4}$/.test(code)) {
      warn.push(`  ⚠ 마스터 없는 코드 '${code}' — 참조 ${total}건(회원 ${n.user}·방 ${n.room}·계약 ${n.contract}). 파트너 신설 또는 참조 교정 필요`);
    } else {
      warn.push(`  ⚠ 코드 자리에 상호명 '${code}' — 참조 ${total}건. 정규 코드로 치환 필요(오염 데이터)`);
    }
  }
}

// ── ③-2 소속 없는 활성 영업자 → SP999(개인 영업자) 부여 ────────────────
//  소속이 비면 그 사람이 만든 방·계약이 규칙의 소유필드(agent_channel_code)를 못 채워
//  이관 후 쓰기가 영구 거부된다. SP999가 정확히 이 경우를 위한 채널이다.
{
  let n = 0;
  for (const [k, u] of Object.entries(db.users || {}) as [string, Rec][]) {
    if (!isObj(u) || u._deleted === true || S(u.status) === 'deleted') continue;
    if (!S(u.role).startsWith('agent')) continue;
    if (S(u.agent_channel_code) || S(u.company_code)) continue;
    patch[`users/${k}/agent_channel_code`] = 'SP999';
    patch[`users/${k}/updated_at`] = Date.now();
    n++;
    plan.push(`소속 없는 활성 영업자 '${S(u.name) || S(u.email) || k.slice(0, 10)}' → 채널 SP999 부여 (${k})`);
    if (!S(u.user_code)) warn.push(`  ⚠ 위 계정은 user_code도 없다 — 정산 스코프(agent_code 쿼리)에 잡히지 않는다. 코드 부여 필요`);
  }
  if (n) warn.push(`  ℹ 소속 없는 활성 영업자 ${n}명에게 SP999 부여 — 이들이 만든 방·계약이 이관 후 쓰기 거부되는 것을 막는다`);
}

// ── ④ 만료 전자서명 삭제 (평문 PII) ────────────────────────────────────
{
  const t = Date.now();
  for (const [k, s] of Object.entries(db.contract_sign || {}) as [string, Rec][]) {
    if (!isObj(s)) continue;
    const exp = Number(s.expires_at || 0);
    if (exp && exp < t) {
      patch[`contract_sign/${k}`] = null; // 하드삭제 — 만료 + 평문 PII + 무인증 공개 읽기 노드
      plan.push(`만료 전자서명 삭제 '${k}' (만료 ${new Date(exp).toISOString().slice(0, 10)}, 평문 PII 보유)`);
    }
  }
}

// ── ⑤ 같은 이메일이 여러 회원 레코드에 걸린 경우 — 자동 처리 금지 ──────
//  Firebase Auth는 이메일이 유일하다. RTDB에 같은 이메일 레코드가 여럿이면
//  그중 하나만 실제 로그인 계정이고 나머지는 잔재다. 어느 것이 살아있는지는
//  RTDB만 봐서는 알 수 없다 → Auth를 조회해 확인하기 전에는 손대면 안 된다.
{
  const byEmail = new Map<string, [string, Rec][]>();
  for (const [k, u] of Object.entries(db.users || {}) as [string, Rec][]) {
    if (!isObj(u)) continue;
    const e = S(u.email).toLowerCase();
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e)!.push([k, u]);
  }
  for (const [email, list] of byEmail) {
    if (list.length < 2) continue;
    const desc = list.map(([k, u]) => {
      const del = u._deleted === true || S(u.status) === 'deleted';
      return `${k.slice(0, 12)}…(${S(u.user_code) || '코드없음'}·${del ? '삭제표시' : '활성'})`;
    }).join(' / ');
    warn.push(`  ⚠ 같은 이메일 '${email}'이 회원 ${list.length}건에 걸림 — ${desc}. Auth에는 하나만 존재하므로 **어느 uid가 실제 계정인지 확인 전 삭제·비활성 금지**`);
    const alive = list.filter(([, u]) => !(u._deleted === true || S(u.status) === 'deleted'));
    if (alive.length > 1) warn.push(`     └ 그중 활성이 ${alive.length}건 — 중복 신원. 어느 쪽을 남길지 사람이 판단해야 한다`);
  }
}

// ── ⑥ 삭제 표시된 회원의 Auth 계정 — 일괄 비활성 금지 ──────────────────
{
  const del: [string, Rec][] = [];
  for (const [k, u] of Object.entries(db.users || {}) as [string, Rec][]) {
    if (isObj(u) && (u._deleted === true || S(u.status) === 'deleted')) del.push([k, u]);
  }
  if (del.length) {
    plan.push(`삭제 표시된 회원 ${del.length}건 — RTDB는 이미 정리됨(추가 패치 없음)`);
    manual.push('⛔ **Auth 계정 일괄 비활성 금지.** 아래는 "삭제 표시된 RTDB 레코드" 목록일 뿐이고,');
    manual.push('   같은 이메일이 여러 레코드에 걸린 경우가 있어 잘못 비활성하면 **실사용자가 로그인을 잃는다**.');
    manual.push('   반드시 계정별로 (1) Auth에 그 uid가 실제 존재하는지 (2) 최근 로그인 이력이 있는지 확인 후 개별 처리할 것.');
    for (const [k, u] of del) {
      manual.push(`   - ${k} · ${S(u.email) || '이메일없음'} · ${S(u.name) || '이름없음'} · ${S(u.user_code) || '코드없음'}`);
    }
  }
}

// ── 출력 ──────────────────────────────────────────────────────────────
mkdirSync(OUTDIR, { recursive: true });
writeFileSync(join(OUTDIR, 'cleanup-patch.json'), JSON.stringify(patch, null, 1), 'utf8');

const L: string[] = [];
L.push('# 이관 전 선정리 패치', '');
L.push(`- 입력: \`${SRC}\``);
L.push(`- 패치 경로 수: **${Object.keys(patch).length}**`);
L.push('- 형식: RTDB 멀티패스 업데이트(평면 경로 → 값). 중첩 객체를 쓰면 상위 키가 통째로 대체되므로 평면이어야 한다.', '');
L.push('## 적용', '', '```bash', 'npx firebase-tools@13 database:update / tmp/migration/cleanup-patch.json --project freepasserp3', '```', '');
L.push('> 적용 전 반드시 백업: `npx firebase-tools@13 database:get / --project freepasserp3 -o backup-before-cleanup.json`', '');
L.push('## 수행 내용', '');
for (const p of plan) L.push(`- ${p}`);
L.push('');
if (warn.length) { L.push('## 확인 필요 (자동 처리 안 함)', ''); for (const w of warn) L.push(w.trim().startsWith('⚠') ? `- ${w.trim()}` : `- ${w}`); L.push(''); }
if (manual.length) {
  L.push('## 수동 조치 (RTDB 밖)', '');
  L.push('소프트삭제는 로그인을 막지 못한다. Auth 콘솔 또는 admin SDK로 계정을 비활성화해야 실효가 있다.', '');
  const uniq = [...new Set(manual)];
  for (const m of uniq.slice(0, 20)) L.push(`- ${m}`);
  if (uniq.length > 20) L.push(`- … 외 ${uniq.length - 20}건`);
  L.push('');
}
L.push('## 적용 후', '', '1. 백업 재추출', '2. `npx tsx scripts/migrate-v3-to-v4.mts <새백업> tmp/migration` 재실행', '3. ⛔ 중단 사유가 사라졌는지 확인');

writeFileSync(join(OUTDIR, 'cleanup-report.md'), L.join('\n') + '\n', 'utf8');
console.log(L.join('\n'));
console.log(`\n패치: ${join(OUTDIR, 'cleanup-patch.json')}`);
