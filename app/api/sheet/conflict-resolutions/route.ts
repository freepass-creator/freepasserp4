import { NextResponse } from 'next/server';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  KEEP_EXISTING_PRICES,
  PRICE_PERIOD_CONFLICT,
  isPriceConflictProtected,
  priceConflictIdentity,
  validPriceResolutionInput,
  type SheetConflictResolution,
  type SheetConflictResolutionInput,
} from '@/lib/domain/sheet-conflict-resolution';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESOLUTION_PATH = 'v4/sheet_conflict_resolutions';
const MAX_BATCH = 200;

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

async function currentProtectionState(): Promise<{ products: EntityRecord[]; contracts: EntityRecord[] }> {
  const db = firebaseAdminDatabase();
  const [v3Products, v4Products, v3Contracts, v4Contracts] = await Promise.all([
    db.ref('products').get(),
    db.ref('v4/products').get(),
    db.ref('contracts').get(),
    db.ref('v4/contracts').get(),
  ]);
  return {
    products: mergeRows(rows(v3Products.val()), rows(v4Products.val()))
      .filter((row) => row._deleted !== true && !row.deletedAt && text(row.status) !== 'deleted'),
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
    const snapshot = await firebaseAdminDatabase().ref(RESOLUTION_PATH).get();
    const resolutions = Object.values((snapshot.val() || {}) as Record<string, SheetConflictResolution>)
      .filter((item) => item && typeof item === 'object');
    return NextResponse.json({ resolutions });
  } catch {
    return NextResponse.json({ error: 'conflict resolutions unavailable' }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  let inputs: unknown[];
  try {
    const body = await request.json() as { resolutions?: unknown[] };
    inputs = Array.isArray(body.resolutions) ? body.resolutions : [];
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!inputs.length || inputs.length > MAX_BATCH || inputs.some((item) => !validPriceResolutionInput(item))) {
    return NextResponse.json({ error: 'invalid resolution batch' }, { status: 400 });
  }
  const validInputs = inputs as SheetConflictResolutionInput[];
  const unique = [...new Map(validInputs.map((item) => [item.fingerprint, item])).values()];
  try {
    const { products, contracts } = await currentProtectionState();
    const protectedFingerprints = unique
      .filter((item) => isPriceConflictProtected(item.raw, products, contracts))
      .map((item) => item.fingerprint);
    if (protectedFingerprints.length) {
      return NextResponse.json({
        error: 'contract-protected price conflicts cannot be approved',
        protectedFingerprints,
      }, { status: 409 });
    }

    const now = Date.now();
    const updates: Record<string, unknown> = {};
    for (const item of unique) {
      const identity = priceConflictIdentity(item.raw);
      const product = products.find((row) => text(row.car_number || row.car_number_snapshot).replace(/\s/g, '') === identity.carNumber
        && (!identity.provider || [text(row.provider_company_code), text(row.partner_code), text(row._key).split('_')[0]].includes(identity.provider)));
      updates[`sheet_conflict_resolutions/${item.fingerprint}`] = {
        fingerprint: item.fingerprint,
        category: PRICE_PERIOD_CONFLICT,
        decision: KEEP_EXISTING_PRICES,
        status: 'approved',
        provider: identity.provider.slice(0, 100),
        product_key: text(product?.product_code || product?._key || item.productKey || item.storageKey).slice(0, 200),
        approved_at: now,
        approved_by: admin.uid,
      } satisfies SheetConflictResolution;
    }
    const auditId = `AL-${now}-sheet-price-resolution`;
    updates[`audit_logs/${auditId}`] = {
      _key: auditId,
      entity: 'sheet_conflict_resolution',
      target_key: `batch:${unique.length}`,
      action: 'approve_keep_existing_prices',
      companyId: text(process.env.SHEET_SYNC_COMPANY_ID || 'freepass'),
      at: now,
      actor_uid: admin.uid,
      actor_role: 'admin',
      summary: `기존 가격기간 유지 승인 ${unique.length}건`,
      fingerprints: unique.map((item) => item.fingerprint),
      changes: [],
    };
    await firebaseAdminDatabase().ref('v4').update(updates);
    return NextResponse.json({ approved: unique.length });
  } catch {
    return NextResponse.json({ error: 'resolution approval failed' }, { status: 503 });
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
    const current = (await firebaseAdminDatabase().ref(RESOLUTION_PATH).get()).val() as Record<string, SheetConflictResolution> | null;
    const eligible = fingerprints.filter((fingerprint) => current?.[fingerprint]?.category === PRICE_PERIOD_CONFLICT
      && current[fingerprint].decision === KEEP_EXISTING_PRICES);
    const now = Date.now();
    const updates: Record<string, unknown> = {};
    for (const fingerprint of eligible) {
      updates[`sheet_conflict_resolutions/${fingerprint}/status`] = 'revoked';
      updates[`sheet_conflict_resolutions/${fingerprint}/revoked_at`] = now;
      updates[`sheet_conflict_resolutions/${fingerprint}/revoked_by`] = admin.uid;
    }
    const auditId = `AL-${now}-sheet-price-revoke`;
    updates[`audit_logs/${auditId}`] = {
      _key: auditId,
      entity: 'sheet_conflict_resolution',
      target_key: `batch:${eligible.length}`,
      action: 'revoke_keep_existing_prices',
      companyId: text(process.env.SHEET_SYNC_COMPANY_ID || 'freepass'),
      at: now,
      actor_uid: admin.uid,
      actor_role: 'admin',
      summary: `기존 가격기간 유지 승인 철회 ${eligible.length}건`,
      fingerprints: eligible,
      changes: [],
    };
    await firebaseAdminDatabase().ref('v4').update(updates);
    return NextResponse.json({ revoked: eligible.length });
  } catch {
    return NextResponse.json({ error: 'resolution revoke failed' }, { status: 503 });
  }
}
