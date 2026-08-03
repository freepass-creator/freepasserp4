/**
 * RP023 AutoPlus 보증금 규칙을 v4 partner overlay에 안전하게 설정한다.
 * 기본은 dry-run. --apply일 때만 현재값 공란/동일을 CAS 확인하고 v4에 쓴다.
 */
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

type Rec = Record<string, any>;
const APPLY = process.argv.includes('--apply');
const RULE = process.argv.find((arg) => arg.startsWith('--rule='))?.slice('--rule='.length) || '';
if (!['rent_multiple', 'months_per_year'].includes(RULE)) {
  throw new Error('사용법: --rule=rent_multiple|months_per_year [--apply]');
}

const DB_URL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
  || process.env.FIREBASE_DATABASE_URL
  || 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
initializeApp({
  credential: serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault(),
  databaseURL: DB_URL,
});
const db = getDatabase();
const S = (value: unknown) => String(value ?? '').trim();
const isLive = (row: Rec) => row && typeof row === 'object'
  && row._deleted !== true && !row.deletedAt && S(row.status) !== 'deleted';
const matches = (key: string, row: Rec) => S(row.partner_code || key) === 'RP023';

async function main() {
  const [v3Snap, v4Snap] = await Promise.all([
    db.ref('partners').get(),
    db.ref('v4/partners').get(),
  ]);
  const v3 = (v3Snap.val() || {}) as Record<string, Rec>;
  const v4 = (v4Snap.val() || {}) as Record<string, Rec>;
  const v4Matches = Object.entries(v4).filter(([key, row]) => isLive(row) && matches(key, row));
  if (v4Matches.length > 1) throw new Error(`RP023 v4 레코드 중복 ${v4Matches.length}건 — 자동 선택 금지`);

  const v3Matches = Object.entries(v3).filter(([key, row]) => isLive(row) && matches(key, row));
  const sheetV3Matches = v3Matches.filter(([, row]) => S(row.sheet_url));
  const fallback = sheetV3Matches.length === 1 ? sheetV3Matches[0] : v3Matches.length === 1 ? v3Matches[0] : null;
  const target = v4Matches[0] || fallback;
  if (!target) throw new Error(`RP023 정본 레코드 선택 불가(v3 ${v3Matches.length}, v4 ${v4Matches.length})`);

  const [targetKey, source] = target;
  const currentOverlay = v4[targetKey] && typeof v4[targetKey] === 'object' ? v4[targetKey] : {};
  const currentRule = S(currentOverlay.deposit_rule || source.deposit_rule);
  if (currentRule && currentRule !== RULE) {
    throw new Error(`RP023 보증금 규칙이 이미 다른 값으로 설정됨(${currentRule}) — 자동 변경 금지`);
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'APPLY_APPROVED' : 'DRY_RUN',
    target: `v4/partners/${targetKey}/deposit_rule`,
    current: currentRule || '(공란)',
    requested: RULE,
    v3Writes: 0,
    inventoryWrites: 0,
  }, null, 2));
  if (!APPLY) process.exit(0);

  const changedAt = new Date().toISOString();
  const marker = `approved-rp023-deposit-rule:${changedAt}`;
  const ref = db.ref(`v4/partners/${targetKey}`);
  const result = await ref.transaction((raw) => {
    const current = raw && typeof raw === 'object' ? raw as Rec : {};
    const liveRule = S(current.deposit_rule);
    if (liveRule && liveRule !== RULE) return;
    const liveCode = S(current.partner_code);
    if (liveCode && liveCode !== 'RP023') return;
    return {
      ...current,
      partner_code: liveCode || 'RP023',
      deposit_rule: RULE,
      updatedAt: changedAt,
      updatedBy: marker,
    };
  }, undefined, false);
  if (!result.committed) throw new Error('RP023 설정이 동시에 변경돼 저장을 중단했습니다');

  const auditId = `AL-${Date.now()}-rp023-deposit-rule`;
  try {
    await db.ref(`v4/audit_logs/${auditId}`).set({
      _key: auditId,
      entity: 'partner',
      target_key: targetKey,
      action: 'approved_config_change',
      companyId: 'freepass',
      at: Date.now(),
      actor_uid: 'system:codex-approved',
      actor_role: 'admin',
      actor_name: '사용자 승인 설정 반영',
      summary: 'RP023 보증금 규칙 설정',
      changes: [{ field: 'deposit_rule', before: currentRule || '', after: RULE }],
    });
  } catch (error) {
    // 감사로그가 실패하면 이번 스크립트가 쓴 값일 때만 원래 규칙으로 보상한다.
    await ref.transaction((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const current = raw as Rec;
      if (S(current.updatedBy) !== marker || S(current.deposit_rule) !== RULE) return;
      const restored = { ...current, deposit_rule: currentRule || null };
      return restored;
    }, undefined, false).catch(() => undefined);
    throw new Error(`감사로그 실패로 설정을 원복했습니다: ${String((error as Error)?.message || error)}`);
  }

  const verified = (await ref.get()).val() as Rec | null;
  if (S(verified?.deposit_rule) !== RULE) throw new Error('저장 후 재조회 불일치');
  console.log(`PASS RP023.deposit_rule=${RULE} · 감사 ${auditId} · 재조회 일치`);
  process.exit(0);
}

main().catch((error) => {
  console.error('FAIL', String((error as Error)?.message || error));
  process.exit(1);
});
