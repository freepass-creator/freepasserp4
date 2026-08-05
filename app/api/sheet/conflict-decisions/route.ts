import { NextResponse } from 'next/server';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  isSheetConflictDecisionProtected,
  validSheetConflictDecisionInput,
  type SheetConflictDecision,
  type SheetConflictDecisionInput,
} from '@/lib/domain/sheet-conflict-decision';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DECISION_PATH = 'v4/sheet_conflict_decisions';
const MAX_BATCH = 100;
const text = (value: unknown): string => String(value ?? '').trim();

function rows(raw: unknown): EntityRecord[] {
  return Object.entries((raw || {}) as Record<string, EntityRecord>)
    .filter(([, row]) => row && typeof row === 'object')
    .map(([key, row]) => ({ ...row, _key: text(row._key || row.product_code || row.contract_code || key) }));
}

function mergeRows(v3: EntityRecord[], v4: EntityRecord[]): EntityRecord[] {
  const merged = new Map<string, EntityRecord>();
  for (const row of v3) merged.set(text(row._key), row);
  for (const row of v4) {
    const key = text(row._key);
    merged.set(key, { ...(merged.get(key) || {}), ...row, _key: key });
  }
  return [...merged.values()];
}

async function protectionState(): Promise<{ products: EntityRecord[]; contracts: EntityRecord[] }> {
  const db = firebaseAdminDatabase();
  const [v4Products, v3Contracts, v4Contracts] = await Promise.all([
    db.ref('v4/products').get(),
    db.ref('contracts').get(),
    db.ref('v4/contracts').get(),
  ]);
  return {
    products: rows(v4Products.val()),
    contracts: mergeRows(rows(v3Contracts.val()), rows(v4Contracts.val())),
  };
}

async function requireAdmin(request: Request): Promise<{ uid: string } | Response> {
  try {
    const admin = await verifyAdminBearer(request);
    return admin || NextResponse.json({ error: 'forbidden' }, { status: 403 });
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503 });
  }
}

export async function GET(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  try {
    const snapshot = await firebaseAdminDatabase().ref(DECISION_PATH).get();
    const decisions = Object.values((snapshot.val() || {}) as Record<string, SheetConflictDecision>)
      .filter((item) => item && typeof item === 'object');
    return NextResponse.json({ decisions });
  } catch {
    return NextResponse.json({ error: 'conflict decisions unavailable' }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  let rawInputs: unknown[];
  try {
    const body = await request.json() as { decisions?: unknown[] };
    rawInputs = Array.isArray(body.decisions) ? body.decisions : [];
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!rawInputs.length || rawInputs.length > MAX_BATCH
    || rawInputs.some((item) => !validSheetConflictDecisionInput(item))) {
    return NextResponse.json({ error: 'invalid decision batch' }, { status: 400 });
  }
  const inputs = rawInputs as SheetConflictDecisionInput[];
  const unique = [...new Map(inputs.map((item) => [item.fingerprint, item])).values()];
  try {
    const { products, contracts } = await protectionState();
    const protectedFingerprints = unique
      .filter((item) => isSheetConflictDecisionProtected(item.raw, products, contracts))
      .map((item) => item.fingerprint);
    if (protectedFingerprints.length) {
      return NextResponse.json({
        error: 'contract-protected conflicts cannot be decided here',
        protectedFingerprints,
      }, { status: 409 });
    }

    const now = Date.now();
    const updates: Record<string, unknown> = {};
    for (const item of unique) {
      updates[`sheet_conflict_decisions/${item.fingerprint}`] = {
        fingerprint: item.fingerprint,
        category: item.category,
        decision: item.decision,
        status: 'recorded',
        provider: text(item.provider).slice(0, 100),
        product_key: text(item.productKey).slice(0, 200),
        recorded_at: now,
        recorded_by: admin.uid,
      } satisfies SheetConflictDecision;
    }
    const auditId = `AL-${now}-sheet-conflict-decision`;
    updates[`audit_logs/${auditId}`] = {
      _key: auditId,
      entity: 'sheet_conflict_decision',
      target_key: `batch:${unique.length}`,
      action: 'record_sheet_conflict_decision',
      companyId: text(process.env.SHEET_SYNC_COMPANY_ID || 'freepass'),
      at: now,
      actor_uid: admin.uid,
      actor_role: 'admin',
      summary: `Sheet 소유권·삭제 결정 기록 ${unique.length}건`,
      fingerprints: unique.map((item) => item.fingerprint),
      changes: [],
    };
    await firebaseAdminDatabase().ref('v4').update(updates);
    return NextResponse.json({ recorded: unique.length });
  } catch {
    return NextResponse.json({ error: 'decision recording failed' }, { status: 503 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  let fingerprints: string[];
  try {
    const body = await request.json() as { fingerprints?: string[] };
    fingerprints = [...new Set((Array.isArray(body.fingerprints) ? body.fingerprints : [])
      .map(text).filter((value) => /^SCR-[0-9a-f]{16}$/.test(value)))];
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!fingerprints.length || fingerprints.length > MAX_BATCH) {
    return NextResponse.json({ error: 'invalid fingerprint batch' }, { status: 400 });
  }
  try {
    const current = ((await firebaseAdminDatabase().ref(DECISION_PATH).get()).val()
      ?? null) as Record<string, SheetConflictDecision> | null;
    const eligible = fingerprints.filter((fingerprint) => current?.[fingerprint]?.status === 'recorded');
    if (!eligible.length) return NextResponse.json({ revoked: 0 });
    const now = Date.now();
    const updates: Record<string, unknown> = {};
    for (const fingerprint of eligible) {
      updates[`sheet_conflict_decisions/${fingerprint}/status`] = 'revoked';
      updates[`sheet_conflict_decisions/${fingerprint}/revoked_at`] = now;
      updates[`sheet_conflict_decisions/${fingerprint}/revoked_by`] = admin.uid;
    }
    const auditId = `AL-${now}-sheet-conflict-decision-revoke`;
    updates[`audit_logs/${auditId}`] = {
      _key: auditId,
      entity: 'sheet_conflict_decision',
      target_key: `batch:${eligible.length}`,
      action: 'revoke_sheet_conflict_decision',
      companyId: text(process.env.SHEET_SYNC_COMPANY_ID || 'freepass'),
      at: now,
      actor_uid: admin.uid,
      actor_role: 'admin',
      summary: `Sheet 소유권·삭제 결정 철회 ${eligible.length}건`,
      fingerprints: eligible,
      changes: [],
    };
    await firebaseAdminDatabase().ref('v4').update(updates);
    return NextResponse.json({ revoked: eligible.length });
  } catch {
    return NextResponse.json({ error: 'decision revoke failed' }, { status: 503 });
  }
}
