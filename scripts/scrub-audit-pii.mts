/**
 * 감사 로그에 이미 평문으로 쌓인 PII 일회성 마스킹.
 *
 * 신규 유입은 audit.ts scrubPii 로 막았지만, 이미 적재된 before/after JSON·changes 에는
 * 주민등록번호·면허번호·주소가 그대로 남아 있다. 감사 로그엔 만료·파기 수단이 없으므로 여기서 지운다.
 * 값만 '***' 로 바꾸고 **레코드는 지우지 않는다** — 감사 기록 자체는 남아야 한다.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/scrub-audit-pii.mts          # dry-run
 *   ... --apply    실제 마스킹(변경 전 원본은 tmp/audit-pii-backup-*.jsonl 에 남긴다)
 *   ... --node=audit_logs   v3 라이브 감사노드(erp3 가 아직 쓴다 — 명시해야 건드린다)
 *
 * 실측(2026-07-31): v4/audit_logs 45건 중 PII 0건 · v3 audit_logs 16,827건 중 27건에 customer_phone.
 * 주민등록번호·면허번호는 어느 쪽에도 아직 없다 — 서명 계약이 v4 로 안 넘어왔기 때문이고,
 * 오픈하면 바로 쌓이기 시작하므로 audit.ts 의 scrubPii 가 그 전에 들어가 있어야 한다.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, writeFileSync } from 'node:fs';

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
initializeApp({
  credential: saPath ? cert(JSON.parse(readFileSync(saPath, 'utf8'))) : applicationDefault(),
  databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
});
const db = getDatabase();
const APPLY = process.argv.includes('--apply');
/** 대상 노드. 기본 v4. v3 라이브(audit_logs)는 erp3 가 아직 쓰는 노드라 명시해야 건드린다. */
const NODE = (process.argv.find((a) => a.startsWith('--node=')) || '--node=v4/audit_logs').split('=')[1];

const PII_FIELDS = [
  'customer_id', 'driver_license_no', 'customer_address', 'customer_phone', 'customer_name',
  'emergency_name', 'emergency_phone', 'sign_signature',
  'account_number', 'bank_account', 'resident_id', 'passport_no',
];
const PII_SET = new Set(PII_FIELDS);

/** JSON 문자열 안의 민감키 값을 *** 로. 파싱 실패하면 정규식 폴백(잘린 JSON 대비 — slice(0,1200) 때문에 흔하다). */
function scrubJsonText(s: string): { out: string; hit: boolean } {
  if (!s) return { out: s, hit: false };
  try {
    const o = JSON.parse(s);
    let hit = false;
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (PII_SET.has(k) && o[k] != null && o[k] !== '' && o[k] !== '***') { o[k] = '***'; hit = true; }
      }
      if (hit) return { out: JSON.stringify(o), hit };
    }
    return { out: s, hit: false };
  } catch {
    let out = s; let hit = false;
    for (const k of PII_FIELDS) {
      // "key":"…값…" — 이스케이프와 **닫는 따옴표가 잘려 없는 경우**(slice(0,1200)) 둘 다 잡는다.
      const re = new RegExp('("' + k + '"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*("|$)', 'g');
      out = out.replace(re, (_m, p1) => { hit = true; return p1 + '"***"'; });
    }
    return { out, hit };
  }
}

type Rec = Record<string, any>;

async function main() {
  const snap = await db.ref(NODE).get();
  const all: Record<string, Rec> = snap.val() || {};
  const keys = Object.keys(all);
  console.log(`감사 로그 ${keys.length}건 · ${APPLY ? '적용' : 'DRY-RUN'}\n`);

  const updates: Record<string, unknown> = {};
  const backup: string[] = [];
  let hitRecords = 0;
  const byField = new Map<string, number>();

  for (const k of keys) {
    const r = all[k];
    if (!r || typeof r !== 'object') continue;
    let touched = false;
    const patch: Rec = {};

    for (const f of ['before', 'after'] as const) {
      const cur = typeof r[f] === 'string' ? r[f] : '';
      const { out, hit } = scrubJsonText(cur);
      if (hit) { patch[f] = out; touched = true; }
    }
    // changes 배열의 from/to 도 값 원문을 담는다
    if (Array.isArray(r.changes)) {
      const next = r.changes.map((c: Rec) => {
        if (!c || typeof c !== 'object') return c;
        if (!PII_SET.has(String(c.key))) return c;
        const from = c.from && c.from !== '—' && c.from !== '***' ? '***' : c.from;
        const to = c.to && c.to !== '—' && c.to !== '***' ? '***' : c.to;
        if (from !== c.from || to !== c.to) { touched = true; byField.set(String(c.key), (byField.get(String(c.key)) || 0) + 1); }
        return { ...c, from, to };
      });
      if (touched) patch.changes = next;
    }
    if (!touched) continue;
    hitRecords++;
    backup.push(JSON.stringify({ _key: k, before: r.before, after: r.after, changes: r.changes }));
    for (const [pk, pv] of Object.entries(patch)) updates[`${NODE}/${k}/${pk}`] = pv;
  }

  console.log(`민감정보 남아있는 레코드 ${hitRecords}건 · 갱신 경로 ${Object.keys(updates).length}개`);
  if (byField.size) console.log('changes 항목별:', [...byField].map(([a, b]) => `${a} ${b}`).join(' · '));
  if (!hitRecords) { console.log('지울 게 없다.'); return; }

  const stamp = String(process.env.FP4_STAMP || 'run');
  const backupPath = `tmp/audit-pii-backup-${stamp}.jsonl`;
  writeFileSync(backupPath, backup.join('\n'));
  console.log(`원본 백업 → ${backupPath} (${backup.length}줄)`);

  if (!APPLY) { console.log('\nDRY-RUN — 쓰지 않았다. 적용하려면 --apply'); return; }
  // set() 금지 — 멀티패스 update 로 해당 필드만.
  const paths = Object.keys(updates);
  for (let i = 0; i < paths.length; i += 500) {
    const chunk: Record<string, unknown> = {};
    for (const p of paths.slice(i, i + 500)) chunk[p] = updates[p];
    await db.ref().update(chunk);
    console.log(`  ${Math.min(i + 500, paths.length)}/${paths.length}`);
  }
  console.log('✓ 마스킹 완료');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
