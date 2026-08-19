/**
 * Read-only audit for the manual/blocked vehicle-trim backlog.
 *
 * This intentionally does not infer facts or mutate the Sheet/registry. For
 * blocked rows it only asks whether required policy fields look complete after
 * masking the status gate. This is not a promotion recommendation: `제외` may
 * encode an immutable-key conflict recorded in the evidence note, which still
 * requires row-by-row human review.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  VehicleTrimMasterArtifact,
  VehicleTrimMasterRecord,
} from '../lib/domain/vehicle-trim-master';
import { operationalPromotionFailures } from '../lib/domain/vehicle-trim-operational-policy';

const artifactPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as VehicleTrimMasterArtifact;

const countBy = (records: VehicleTrimMasterRecord[], keyOf: (record: VehicleTrimMasterRecord) => string) =>
  Object.fromEntries([...records.reduce((counts, record) => {
    const key = keyOf(record) || '(공란)';
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));

const failureSignature = (record: VehicleTrimMasterRecord) =>
  operationalPromotionFailures(record).sort().join('+') || 'ready';

const manual = artifact.records.filter((record) => record.usage_tier === 'manual');
const blocked = artifact.records.filter((record) => record.usage_tier === 'blocked');
const hypotheticalReview = blocked.map((record) => ({
  ...record,
  management_status: '검증중' as const,
  verification_status: '1차확인' as const,
  usage_tier: 'manual' as const,
}));
const policyFieldsComplete = hypotheticalReview.filter((record) => !operationalPromotionFailures(record).length);
const policyFieldsCompleteKeys = new Set(policyFieldsComplete.map((record) => record.trim_row_key));
const stillIncomplete = hypotheticalReview.filter((record) => !policyFieldsCompleteKeys.has(record.trim_row_key));

console.log(JSON.stringify({
  source: artifact.source,
  data_as_of: artifact.data_as_of,
  totals: {
    rows: artifact.row_count,
    automatic: artifact.automatic_assignable_count,
    manual: manual.length,
    blocked: blocked.length,
  },
  manual: {
    ready_now: manual.filter((record) => failureSignature(record) === 'ready').length,
    failure_signatures: countBy(manual, failureSignature),
    models: countBy(manual, (record) => `${record.maker}|${record.model}`),
  },
  blocked: {
    status_pairs: countBy(blocked, (record) => `${record.management_status}|${record.verification_status}`),
    policy_fields_complete_but_exclusion_reason_still_requires_review: policyFieldsComplete.length,
    policy_fields_complete_models: countBy(policyFieldsComplete, (record) => `${record.maker}|${record.model}`),
    still_incomplete: stillIncomplete.length,
    incomplete_failure_signatures: countBy(stillIncomplete, failureSignature),
  },
}, null, 2));
