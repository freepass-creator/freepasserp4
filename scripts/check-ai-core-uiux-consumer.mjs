import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const manifestPath = resolve(root, '.ai-core/ui-ux.consumer.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

function fail(code, detail = '') {
  throw new Error(detail ? `${code}:${detail}` : code);
}

async function exists(path) {
  try {
    await access(resolve(root, path));
    return true;
  } catch {
    return false;
  }
}

if (manifest.contract !== 'ai-core-ui-ux-consumer/v1') fail('UIUX_CONSUMER_CONTRACT_INVALID');
if (manifest.ai_core?.repository !== 'freepass-creator/ai-core') fail('UIUX_CORE_REPOSITORY_INVALID');
if (!/^[a-f0-9]{40}$/.test(manifest.ai_core?.revision ?? '')) fail('UIUX_CORE_REVISION_INVALID');
if (!/^1\.[0-9]+\.[0-9]+$/.test(manifest.ai_core?.feature_registry_version ?? '')) fail('UIUX_REGISTRY_VERSION_INVALID');
if (!['CANDIDATE_PR','CANONICAL'].includes(manifest.ai_core?.status)) fail('UIUX_CORE_STATUS_INVALID');

if (!['MAPPED','PILOT','CONFORMANT'].includes(manifest.adoption_status)) fail('UIUX_ADOPTION_STATUS_INVALID');

const featureIds = new Set();
for (const binding of manifest.feature_bindings ?? []) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(binding.feature_id ?? '')) fail('UIUX_FEATURE_ID_INVALID', binding.feature_id);
  if (featureIds.has(binding.feature_id)) fail('UIUX_FEATURE_ID_DUPLICATE', binding.feature_id);
  featureIds.add(binding.feature_id);

  if (!['NATIVE_PRODUCT','AI_CORE_RUNTIME','COMPATIBILITY_BINDING'].includes(binding.implementation)) {
    fail('UIUX_IMPLEMENTATION_KIND_INVALID', binding.feature_id);
  }
  if (!Array.isArray(binding.local_evidence) || binding.local_evidence.length === 0) {
    fail('UIUX_FEATURE_EVIDENCE_REQUIRED', binding.feature_id);
  }
  for (const path of binding.local_evidence) {
    if (!(await exists(path))) fail('UIUX_FEATURE_EVIDENCE_MISSING', `${binding.feature_id}:${path}`);
  }
}

for (const id of manifest.required_feature_ids ?? []) {
  if (!featureIds.has(id)) fail('UIUX_REQUIRED_FEATURE_UNMAPPED', id);
}

for (const path of manifest.local_authorities ?? []) {
  if (!(await exists(path))) fail('UIUX_LOCAL_AUTHORITY_MISSING', path);
}

const verification = manifest.verification ?? {};
if (!Array.isArray(verification.commands) || verification.commands.length === 0) fail('UIUX_VERIFICATION_COMMAND_REQUIRED');
if (!Array.isArray(verification.viewports) || verification.viewports.length === 0) fail('UIUX_VIEWPORTS_REQUIRED');
if (!Array.isArray(verification.input_modes) || verification.input_modes.length === 0) fail('UIUX_INPUT_MODES_REQUIRED');
if (!Array.isArray(verification.locales) || verification.locales.length === 0) fail('UIUX_LOCALES_REQUIRED');

const requiredPilotViewports = [360, 390, 412, 1280, 1440];
const requiredPilotInputModes = ['keyboard','touch','pointer','ime-composition'];
const requiredPilotLocales = ['ko-KR','en-US','de-DE','ar-SA'];

if (['PILOT','CONFORMANT'].includes(manifest.adoption_status)) {
  for (const width of requiredPilotViewports) {
    if (!verification.viewports.includes(width)) fail('UIUX_PILOT_VIEWPORT_MISSING', String(width));
  }
  for (const input of requiredPilotInputModes) {
    if (!verification.input_modes.includes(input)) fail('UIUX_PILOT_INPUT_MODE_MISSING', input);
  }
  for (const locale of requiredPilotLocales) {
    if (!verification.locales.includes(locale)) fail('UIUX_PILOT_LOCALE_MISSING', locale);
  }
}

for (const exception of manifest.exceptions ?? []) {
  if (!featureIds.has(exception.feature_id)) fail('UIUX_EXCEPTION_UNKNOWN_FEATURE', exception.feature_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.review_on ?? '')) fail('UIUX_EXCEPTION_REVIEW_DATE_REQUIRED', exception.feature_id);
}

if (manifest.adoption_status === 'CONFORMANT') {
  if (manifest.ai_core.status !== 'CANONICAL') fail('UIUX_CONFORMANT_REQUIRES_CANONICAL_CORE');
  if (!Array.isArray(manifest.conformance_receipts) || manifest.conformance_receipts.length === 0) {
    fail('UIUX_CONFORMANCE_RECEIPT_REQUIRED');
  }
}

console.log(
  `PASS: AI Core UI/UX consumer map ${manifest.product.id} / ${manifest.adoption_status} / ` +
  `${featureIds.size} features / core ${manifest.ai_core.feature_registry_version}@${manifest.ai_core.revision.slice(0, 12)}`
);
