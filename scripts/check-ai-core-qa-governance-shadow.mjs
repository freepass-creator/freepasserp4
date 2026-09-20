import fs from 'node:fs';

const readJson = path => JSON.parse(fs.readFileSync(path,'utf8'));
const read = path => fs.readFileSync(path,'utf8');
const fail = (condition,message) => { if(!condition) throw new Error(message); };

const qaShadow = readJson('contracts/ai-core/qa-p0.shadow.json');
const govShadow = readJson('contracts/ai-core/governance-p0.shadow.json');
const manifest = readJson('scripts/ci-checker-manifest.json');
const pkg = readJson('package.json');
const ci = read('.github/workflows/ci.yml');
const releaseDoc = read('docs/VERCEL-PRODUCTION-RELEASE.md');
const releaseScript = read('scripts/deploy/vercel-production.mts');
const versionRoute = read('app/api/version/route.ts');
const launch = read('LAUNCH_GONOGO.md');

fail(qaShadow.core_source.revision === '584026ecaaac40073aeac5a775a5144bf704d0c8','QA_CORE_CANDIDATE_REVISION_DRIFT');
fail(govShadow.core_source.revision === '8bd7fb26338b32abca914995fcd767c8e131ab03','GOVERNANCE_CORE_CANDIDATE_REVISION_DRIFT');

const required = Object.entries(manifest.required || {});
const manual = Object.entries(manifest.manual || {});
const pending = Object.entries(manifest.pending || {});
const all = [...required,...manual,...pending];

fail(required.length === qaShadow.expected_inventory.required,'QA_REQUIRED_COUNT_DRIFT');
fail(manual.length === qaShadow.expected_inventory.manual,'QA_MANUAL_COUNT_DRIFT');
fail(pending.length === qaShadow.expected_inventory.pending,'QA_PENDING_COUNT_DRIFT');

const duplicate = all.map(([id])=>id).filter((id,i,a)=>a.indexOf(id)!==i);
fail(duplicate.length===0,'QA_CHECKER_DUPLICATE:'+duplicate.join(','));

for(const [id] of all){
  fail(Boolean(pkg.scripts?.[id]),'QA_CHECKER_COMMAND_MISSING:'+id);
}

const proven = required.filter(([,entry])=>entry.known_bad && typeof entry.known_bad === 'object');
const ncPending = required.filter(([,entry])=>!entry.known_bad);
fail(proven.length === qaShadow.expected_inventory.required_negative_control_proven,'QA_NEGATIVE_CONTROL_PROVEN_COUNT_DRIFT');
fail(ncPending.length === qaShadow.expected_inventory.required_negative_control_pending,'QA_NEGATIVE_CONTROL_PENDING_COUNT_DRIFT');

for(const [id,entry] of manual){
  fail(typeof entry.reason === 'string' && entry.reason.trim().length>0,'QA_MANUAL_REASON_MISSING:'+id);
}
for(const [id,entry] of pending){
  fail(typeof entry.reason === 'string' && entry.reason.trim().length>0,'QA_PENDING_REASON_MISSING:'+id);
}

for(const [id,entry] of required){
  const command = String(pkg.scripts[id]);
  const scriptPath = command.match(/(?:tsx|node)\s+(?:--require\s+\S+\s+)?([^\s]+)/)?.[1] || '';
  if(entry.workflow){
    fail(fs.existsSync(entry.workflow),'QA_REQUIRED_WORKFLOW_MISSING:'+id);
    const workflow = read(entry.workflow);
    fail(workflow.includes(id) || (scriptPath && workflow.includes(scriptPath)),'QA_REQUIRED_WORKFLOW_BINDING_MISSING:'+id);
  } else {
    fail(ci.includes(id) || (scriptPath && ci.includes(scriptPath)),'QA_REQUIRED_PRIMARY_CI_BINDING_MISSING:'+id);
  }
}

// Governance release-proof parity: prove ERP4 can populate the candidate fields,
// but do not claim that production was observed in this CI run.
for(const token of [
  'main SHA == freepasserp.com/api/version.sha',
  'www.freepasserp.com/api/version',
  'deploy:verify',
  'deploy:prod'
]){
  fail(releaseDoc.includes(token),'GOVERNANCE_RELEASE_DOC_SEMANTIC_MISSING:'+token);
}
for(const token of [
  "git('rev-parse', 'HEAD')",
  "git('rev-parse', 'origin/main')",
  "vercel('deploy', '--prebuilt', '--prod', '--yes')",
  'verifyLive(expectedSha)',
  '--repair-alias'
]){
  fail(releaseScript.includes(token),'GOVERNANCE_RELEASE_SCRIPT_SEMANTIC_MISSING:'+token);
}
fail(versionRoute.includes('NEXT_PUBLIC_BUILD_SHA'),'GOVERNANCE_VERSION_REVISION_MISSING');
fail(versionRoute.includes('no-store'),'GOVERNANCE_VERSION_CACHE_CONTROL_MISSING');
fail(launch.includes('Promote to Production'),'GOVERNANCE_ROLLBACK_DEPLOYMENT_PATH_MISSING');
fail(launch.includes('RTDB export') || launch.includes('백업'),'GOVERNANCE_ROLLBACK_DATA_PATH_MISSING');

console.log(JSON.stringify({
  status:'SHADOW_PARITY_WITH_GAPS',
  qa:{
    required:required.length,
    manual:manual.length,
    pending:pending.length,
    negative_control_proven:proven.length,
    negative_control_pending:ncPending.length,
    normative_ready:false,
    reason:'28 required checkers still lack proven negative controls under the candidate QA profile'
  },
  governance:{
    release_mapping:'PARITY',
    production_observed:false,
    runtime_smoke_bound:false,
    normative_ready:false
  }
},null,2));
