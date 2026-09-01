/**
 * **상품찾기 격자 — «행 수»와 «자식 수»가 같은가.** 읽기 전용. 어긋나면 exit 1.
 *
 * ★★왜 있나 — 2026-08-31 ~ 09-01 이틀 동안 **웹 상품찾기 목록이 통째로 사라지는 사고를 두 번** 냈다.
 *   둘 다 원인이 같다: `.fp-finder-main` 의 **CSS 행 수**와 `app/finder/page.tsx` 의 **자식 수**가 어긋났다.
 *     · 자식 셋(퀵필터가 형제)인데 2행을 배포 → 목록이 «남는 높이 0» 인 암시적 행으로 밀림 → 하루 넘게 0대
 *     · 그걸 되돌린 3행을 자식 둘(퀵필터가 툴바 안)인 새 마크업에 배포 → 가운데 auto 행에 들어가 또 0
 *   **오류가 안 난다.** 타입검사도 빌드도 통과한다. 화면을 열어야만 보인다 — 그래서 하루를 몰랐다.
 *
 *   사장님 2026-09-01 「힘들게 수정해 놓으면 또 바뀌고 그러냐. **그렇게 안 되게끔 해봐.**」
 *   → 주석으로는 또 어긋난다. **세는 자를 둔다.**
 *
 * ⚠ 모바일은 이 격자를 안 쓴다(미디어쿼리가 `display:flex`). 그러니 **웹 자식만** 센다.
 *
 *   npx tsx scripts/check-finder-rows.mts
 */
import { readFileSync } from 'node:fs';

const CSS = 'app/globals.css';
const PAGE = 'app/finder/page.tsx';
/** ⚠ 주석을 먼저 걷는다 — 주석에 적어 둔 `grid-template-rows:none` 을 «값»으로 읽어 한 번 틀렸다. */
const css = readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const page = readFileSync(PAGE, 'utf8');

/** `.fp-finder-main { … grid-template-rows: <값> }` 의 트랙 수. 미디어쿼리(none)·subgrid 는 뺀다. */
function trackCounts(): { rule: string; tracks: number; raw: string }[] {
  const out: { rule: string; tracks: number; raw: string }[] = [];
  const re = /(\.fp-finder-main(?:\.is-sheet-view)?)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const rows = /grid-template-rows\s*:\s*([^;}]+)/.exec(m[2]);
    if (!rows) continue;
    const raw = rows[1].trim();
    if (/^(none|subgrid)$/.test(raw)) continue;         // 모바일·부모격자 정렬용 — 세지 않는다
    // `minmax(0, 1fr)` 안의 쉼표에 속지 않게 괄호 밖 공백으로 센다.
    const flat = raw.replace(/\([^()]*\)/g, 'X');
    out.push({ rule: m[1], tracks: flat.split(/\s+/).filter(Boolean).length, raw });
  }
  return out;
}

/**
 * `<section className={…fp-finder-main…}>` 의 **직계 자식 JSX 원소** 수.
 * prop 으로 넘기는 원소(`quickFilters={<FinderQuickFilters …/>}`)는 자식이 아니다 —
 * 이번 사고의 정체가 바로 그 착각이었다. 그래서 **여는 태그의 깊이**로 센다.
 */
function childCount(): number {
  const at = page.search(/<section[^>]*fp-finder-main/);
  if (at < 0) throw new Error(`${PAGE} 에서 .fp-finder-main 섹션을 못 찾았다`);

  /** `{` 에서 짝이 되는 `}` 자리. 못 찾으면 끝. */
  const matchBrace = (from: number): number => {
    let d = 0;
    for (let i = from; i < page.length; i++) {
      if (page[i] === '{') d++;
      else if (page[i] === '}' && --d === 0) return i;
    }
    return page.length;
  };
  /** 여는 태그 `<X …>` 의 `>` 자리 — 태그 안의 `{…}`(prop) 는 건너뛴다(`() => …` 의 `>` 에 안 속게). */
  const tagEnd = (from: number): number => {
    for (let i = from; i < page.length; i++) {
      if (page[i] === '{') { i = matchBrace(i); continue; }
      if (page[i] === '>') return i;
    }
    return page.length;
  };

  let i = tagEnd(at) + 1;      // 여는 <section …> 을 지난 자리
  let depth = 0;               // 원소 깊이 (0 = 섹션의 직계 자식 자리)
  let kids = 0;
  while (i < page.length) {
    const ch = page[i];
    if (ch === '{') {
      const end = matchBrace(i);
      /**
       * ★**깊이 0 의 중괄호만 «조건부 자식»으로 센다.**
       *   `{!mobile ? <FinderQuickFilters/> : null}` 은 자식이고(옛 마크업이 그랬다),
       *   안쪽 자식들 속의 중괄호까지 세면 과다계수가 된다(처음에 5·6으로 셌다).
       *   JSX 주석 `{/* … *\/}` 은 자식이 아니다.
       */
      if (depth === 0) {
        const inner = page.slice(i + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
        if (/<[A-Za-z]/.test(inner)) kids++;
      }
      i = end + 1;
      continue;
    }
    if (ch === '<') {
      if (page[i + 1] === '/') {                      // 닫는 태그
        const name = /^<\/\s*([A-Za-z][\w.]*)/.exec(page.slice(i, i + 40))?.[1] || '';
        if (name === 'section' && depth === 0) break; // 우리 섹션의 끝
        depth = Math.max(0, depth - 1);
        i = page.indexOf('>', i) + 1;
        continue;
      }
      if (!/^<[A-Za-z]/.test(page.slice(i, i + 2))) { i++; continue; }
      const end = tagEnd(i);
      const selfClosing = page[end - 1] === '/';
      if (depth === 0) kids++;
      if (!selfClosing) depth++;
      i = end + 1;
      continue;
    }
    i++;
  }
  return kids;
}

const rules = trackCounts();
const kids = childCount();

console.log('■ 상품찾기 격자 — 행 수 ↔ 자식 수');
console.log(`   ${PAGE} · .fp-finder-main 직계 자식 ${kids}개`);
let bad = 0;
for (const r of rules) {
  const ok = r.tracks === kids;
  if (!ok) bad++;
  console.log(`   ${ok ? '✓' : '★'} ${r.rule.padEnd(30)} 행 ${r.tracks}  ← ${r.raw}`);
}
if (!rules.length) { console.error('✗ grid-template-rows 규칙을 못 찾았다 — 이 자를 고쳐라'); process.exit(1); }

if (bad) {
  console.error(`\n✗ 행 ${rules.map((r) => r.tracks).join('·')} ≠ 자식 ${kids} — **웹 상품찾기 목록이 화면에서 사라진다.**`);
  console.error('   오류도 안 나고 빌드도 통과한다. 퀵필터를 툴바 안팎으로 옮겼다면 이 값을 같이 고쳐라.');
  process.exit(1);
}
console.log(`\n✓ 행과 자식이 ${kids}로 같다`);
