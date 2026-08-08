/**
 * 차종마스터 트림 목록에서 **트림이 아닌 것**을 걷어낸다. 기본 dry-run, 반영은 --apply.
 *
 * 트림 자리에 메모가 들어가 있다 —
 *   「(삭제 권장: 트림명이 아님 — LPG/구조변경 메모 잔재로 보임)」·「구조변경(LPG 바이퓨얼 개조)」
 * 그리고 설명 괄호가 이름에 붙어 있다 —
 *   「프레스티지 플러스 (MX5 2025년형, 정상 트림)」·「보레고(수출형)」
 * 이 값들이 매칭 후보에 끼면 엉뚱한 트림이 붙고, 차명에 그대로 찍히면 손님이 본다
 * (실측 2026-08-08: 「A6 e-트론 기본 A6 e-트론」 겹말의 원인도 여기다).
 *
 * ★건드리지 않는 것
 *   · 영문 병기는 진짜 트림이다 — 「프리미엄 럭셔리(Premium Luxury)」·「CVX 프리미엄 (CVX Premium)」.
 *     괄호 안이 «설명»일 때만 뗀다(연식·수출형·정상 트림·기념 같은 말이 들어간 것).
 *   · 긴 이름이라고 지우지 않는다 — 「530i M 스포츠 프로 스페셜 에디션」은 실제 트림이다.
 *
 *   npx tsx scripts/clean-master-trims.mts
 *   npx tsx scripts/clean-master-trims.mts --apply
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';

type Trim = string | { name?: string };
type Entry = { sub_model?: string; trims?: Trim[]; variants?: { trims?: Trim[] }[] };
const PATH = 'public/data/vehicle-master.json';
const S = (v: unknown) => String(v ?? '').trim();
const nameOf = (t: Trim) => S(typeof t === 'string' ? t : t?.name);

/** 트림이 아니라 «메모»인 것 — 통째로 뺀다. */
const JUNK = /삭제\s*권장|정식\s*트림\s*아님|트림명\s*아님|구조변경/;

/**
 * 괄호가 «설명»인가. 영문 병기는 트림의 일부라 두고, 연식·구분 설명만 뗀다.
 * 「(수출형)」처럼 괄호가 이름 전부면 그건 트림이 아니다.
 */
const EXPLAIN = /\(([^)]*(?:년형|수출형|택시형|정상\s*트림|표기\s*통일|기념|아님|구분|신설)[^)]*)\)/;

function cleanName(raw: string): string {
  if (JUNK.test(raw)) return '';
  const stripped = raw.replace(EXPLAIN, '').replace(/\s+/g, ' ').trim();
  // 괄호를 떼고 나면 아무것도 안 남는 것(「(수출형)」) 은 트림이 아니다.
  return stripped;
}

const apply = process.argv.includes('--apply');
const raw = readFileSync(PATH, 'utf8');
const doc = JSON.parse(raw) as { entries?: Entry[] } | Entry[];
const entries = (Array.isArray(doc) ? doc : doc.entries) || [];

let removed = 0, renamed = 0, kept = 0;
const removedEx: string[] = [];
const renamedEx: string[] = [];

const cleanList = (list: Trim[] | undefined, sub: string): Trim[] | undefined => {
  if (!Array.isArray(list)) return list;
  const out: Trim[] = [];
  for (const t of list) {
    const before = nameOf(t);
    if (!before) { out.push(t); continue; }
    const after = cleanName(before);
    if (!after) {
      removed++;
      if (removedEx.length < 10) removedEx.push(`${sub} — ${before}`);
      continue;
    }
    if (after !== before) {
      renamed++;
      if (renamedEx.length < 10) renamedEx.push(`${sub} — ${before}  →  ${after}`);
      out.push(typeof t === 'string' ? after : { ...t, name: after });
      continue;
    }
    kept++;
    out.push(t);
  }
  // 이름이 겹치게 된 것은 하나만 남긴다.
  const seen = new Set<string>();
  return out.filter((t) => {
    const n = nameOf(t);
    if (!n) return true;
    if (seen.has(n)) { removed++; return false; }
    seen.add(n);
    return true;
  });
};

for (const e of entries) {
  const sub = S(e.sub_model);
  e.trims = cleanList(e.trims, sub);
  for (const v of e.variants || []) v.trims = cleanList(v.trims, sub);
}

console.log(`\n══ 차종마스터 트림 정리 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
console.log(`  세부모델 ${entries.length}종 · 그대로 둔 트림 ${kept}`);
console.log(`  뺀 것 ${removed} · 이름 다듬은 것 ${renamed}`);
if (removedEx.length) { console.log('\n  뺀 예'); for (const x of removedEx) console.log('    ✗ ' + x); }
if (renamedEx.length) { console.log('\n  다듬은 예'); for (const x of renamedEx) console.log('    · ' + x); }

if (!apply) { console.log('\n※ dry-run. 반영은 --apply\n'); process.exit(0); }

if (!existsSync('tmp/migration-backups')) mkdirSync('tmp/migration-backups', { recursive: true });
copyFileSync(PATH, 'tmp/migration-backups/vehicle-master.before-trim-clean.json');
writeFileSync(PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log('\n  백업 tmp/migration-backups/vehicle-master.before-trim-clean.json');
console.log('  반영 완료\n');
