/**
 * 민감정보 분리 마이그레이션 — 상업기밀·PII 를 `_private` 노드로 이관(dryRun 기본, 자동실행 금지).
 *
 *   · 공급사 `fee_rate`(상업기밀)  → `v4/partners_private/{partner_code}`
 *   · 회원   `email`(PII)          → `v4/users_private/{uid}`
 *
 * 실행(dryRun=false) 시에만 본노드(top-level + v4 오버레이 양쪽)에서 해당 필드를 원자적으로 제거한다
 * (private 기록 + 본노드 제거를 레코드당 단일 멀티패스 update 로 → 둘 다 사라지는 창 없음).
 *
 * ★안전상 이관 대상에서 의도적으로 제외(retained) — 각 필드에 본노드를 읽는 정당한 소비자가 있어
 *   private(read 제한)로 옮기면 머니플로우/기능이 깨진다:
 *   · users.agent_payout_rate : 공급사·관리자가 대신 계약 생성 시 resolveRates 가 공급사 컨텍스트에서
 *       영업자 payout 을 해석 → 공급사는 타 회원 users_private 를 read 불가 → 기본율 0.04 로 오동결(머니 위험).
 *   · users.phone            : 공개 견적 /q 페이지의 담당 영업자 연락 CTA 가 본노드 phone 을 읽음(화이트라벨).
 *   · partners.contact, 시트연동 필드, business_number : identity 표시·시트연동·가입 사업자번호 매칭이 본노드 의존.
 *
 * 규칙(database.rules.json) 의 partners_private·users_private 권한이 먼저 "게시"되어 있어야
 * private write·본노드 제거가 통과한다(미게시면 오류가 report.errors 로 수집됨).
 */
import { ref, get, update } from 'firebase/database';
import { getRtdb } from './client';

type Rec = Record<string, unknown>;

export type MigrateReport = {
  dryRun: boolean;
  partners: { scanned: number; moved: number; removed: number; samples: string[] };
  users: { scanned: number; moved: number; removed: number; samples: string[] };
  retained: string[];
  errors: string[];
};

const RETAINED = [
  'users.agent_payout_rate (머니: 공급사 대리 계약생성 시 payout 해석 폴백 필요)',
  'users.phone (공개 견적 /q 연락 CTA)',
  'partners.contact / sheet_url / sheet_tab / header_row / adapter_id / mapping_profile (시트연동·표시)',
  'partners.business_number (가입 사업자번호 매칭 — 인증 전 본노드 read)',
];

/**
 * @param opts.dryRun 기본 true(미리보기만). false 여야 실제 이관·제거.
 */
export async function migrateSensitiveToPrivate(opts?: { dryRun?: boolean }): Promise<MigrateReport> {
  const db = getRtdb();
  if (!db) throw new Error('RTDB 미연결 — 로컬/데모에선 마이그레이션 불필요(본노드=단일 진실원)');
  const dryRun = opts?.dryRun !== false; // 기본 true
  const errors: string[] = [];

  const partners = { scanned: 0, moved: 0, removed: 0, samples: [] as string[] };
  const users = { scanned: 0, moved: 0, removed: 0, samples: [] as string[] };

  // ── 공급사 fee_rate ──
  const liveP = ((await get(ref(db, 'partners'))).val() as Record<string, Rec> | null) || {};
  const overP = ((await get(ref(db, 'v4/partners'))).val() as Record<string, Rec> | null) || {};
  for (const key of new Set([...Object.keys(liveP), ...Object.keys(overP)])) {
    const live = liveP[key] || {};
    const over = overP[key] || {};
    partners.scanned++;
    const code = String(over.partner_code || live.partner_code || key);
    // ★private 우선(멱등) — 이미 private에 있으면(회원관리 편집분) 그 값 유지, base 옛값으로 덮지 않는다(요율 revert 방지). 없을 때만 base(오버레이>live) 이관.
    const existingPriv = ((await get(ref(db, `v4/partners_private/${code}`))).val() as Rec | null)?.fee_rate;
    const fee = existingPriv ?? over.fee_rate ?? live.fee_rate;
    if (fee == null) continue;
    partners.moved++;
    if (partners.samples.length < 12) partners.samples.push(`${code}=${String(fee)}`);
    if (dryRun) continue;
    try {
      const patch: Rec = {};
      if (existingPriv == null) patch[`v4/partners_private/${code}/fee_rate`] = fee; // 이미 있으면 미기입(편집분 보존)
      if (live.fee_rate != null) patch[`partners/${key}/fee_rate`] = null;
      if (over.fee_rate != null) patch[`v4/partners/${key}/fee_rate`] = null;
      if (Object.keys(patch).length) await update(ref(db), patch);
      partners.removed++;
    } catch (e) { errors.push(`partner ${code}: ${(e as Error)?.message || String(e)}`); }
  }

  // ── 회원 email ──
  const liveU = ((await get(ref(db, 'users'))).val() as Record<string, Rec> | null) || {};
  const overU = ((await get(ref(db, 'v4/users'))).val() as Record<string, Rec> | null) || {};
  for (const key of new Set([...Object.keys(liveU), ...Object.keys(overU)])) {
    const live = liveU[key] || {};
    const over = overU[key] || {};
    users.scanned++;
    const uid = String(over.uid || live.uid || key);
    // ★private 우선(멱등) — 이미 private에 있으면 유지, base 옛값으로 덮지 않음.
    const existingPrivEmail = ((await get(ref(db, `v4/users_private/${uid}`))).val() as Rec | null)?.email;
    const email = existingPrivEmail ?? over.email ?? live.email;
    if (email == null || email === '') continue;
    users.moved++;
    if (users.samples.length < 12) users.samples.push(uid);
    if (dryRun) continue;
    try {
      const patch: Rec = {};
      if (existingPrivEmail == null) patch[`v4/users_private/${uid}/email`] = email;
      if (live.email != null) patch[`users/${key}/email`] = null;
      if (over.email != null) patch[`v4/users/${key}/email`] = null;
      if (Object.keys(patch).length) await update(ref(db), patch);
      users.removed++;
    } catch (e) { errors.push(`user ${uid}: ${(e as Error)?.message || String(e)}`); }
  }

  return { dryRun, partners, users, retained: RETAINED, errors };
}
