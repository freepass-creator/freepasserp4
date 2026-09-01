/**
 * 건물 실측 — 층·부속실의 «문(raw 컨트롤)·창문(하드코딩 높이)» 개수를 센다.
 *
 * 도면 검사기(`check-building`)와 오더 가드(`check-order`)가 **같은 자로 재야** 하므로
 * 세는 법은 여기 한 곳에만 둔다. 두 벌로 세면 「도면은 초록인데 오더는 빨강」이 난다.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const RAW_TAGS = new Set(['button', 'input', 'select', 'textarea']);

export type Measured = { raw: number; height: number; shell: string; files: string[] };

export function rel(path: string) {
  return relative(ROOT, path).replace(/\\/g, '/');
}

function tsxIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx$/.test(entry.name))
    .map((entry) => join(dir, entry.name));
}

export function walkTsx(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next'].includes(entry.name)) walkTsx(path, out);
    } else if (/\.tsx$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** raw 컨트롤은 AST 로 센다 — 문자열·주석 안의 `<button` 을 세지 않기 위해서다. */
export function rawControls(file: string, source: string): number {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (RAW_TAGS.has(node.tagName.getText(sourceFile))) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

/**
 * 높이 하드코딩 — CLAUDE.md 「페이지에서 height 숫자 금지」. 원자가 `ctrlH` 로 정하는 값이다.
 *
 * ★`minHeight: 0` 은 세지 않는다. 그건 치수가 아니라 **flex 관용구**다(flex 자식은 기본으로
 *   안 줄어들어서 0 을 박아야 스크롤이 산다). 이걸 세면 껍데기 3개가 「고칠 것」으로 잘못 뜬다
 *   — 2026-08-30 첫 실측이 실제로 그랬다. 줄자가 과하게 세면 진짜 드리프트가 묻힌다.
 */
export function hardHeights(source: string): number {
  /*
   * 세는 것: `height: 44` · `min-height:48px` 처럼 **px(또는 맨숫자)로 못 박은 치수**.
   * 안 세는 것:
   *   `minHeight: 0`        flex 관용구(치수가 아니다)
   *   `min-height:100vh`    그릇을 화면에 맞추는 말
   *   `line-height:1.5`     ★글자 사이 — 앞이 `-`나 글자면 다른 속성이다.
   *                         (이걸 안 걸러 로그인 한 파일에서만 6건을 잘못 셌다 — 2026-08-30)
   */
  const pattern = /(?<![\w-])(?:min-|max-|min|max)?[Hh]eight\s*:\s*([0-9][0-9.]*)\s*([a-z%]*)/g;
  let count = 0;
  for (const match of source.matchAll(pattern)) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (value > 0 && (unit === '' || unit === 'px')) count += 1;
  }
  return count;
}

export function measure(files: string[]): Measured {
  let raw = 0;
  let height = 0;
  let shell = '없음';
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    raw += rawControls(rel(path), source);
    height += hardHeights(source);
    if (shell === '없음') {
      if (/<WorkPage\b/.test(source)) shell = 'WorkPage';
      else if (/<Page\b/.test(source)) shell = 'Page';
      else if (/EmbeddedApp/.test(source)) shell = 'EmbeddedApp';
      else if (/sign-root/.test(source)) shell = 'sign-root';
      else if (/<LegalView\b/.test(source)) shell = 'LegalView';
    }
  }
  return { raw, height, shell, files: files.map(rel) };
}

/** 층 = app 아래 page.tsx 가 있는 폴더 하나. 그 폴더에 같이 사는 tsx 도 같은 층이다. */
export function floors(): Map<string, Measured> {
  const out = new Map<string, Measured>();
  for (const path of walkTsx(join(ROOT, 'app'))) {
    if (!/[\\/]page\.tsx$/.test(path)) continue;
    const dir = path.replace(/[\\/]page\.tsx$/, '');
    const route = `/${rel(dir).replace(/^app\/?/, '')}`.replace(/\/$/, '') || '/';
    out.set(route, measure(tsxIn(dir)));
  }
  return out;
}

/** 부속실 = 여러 층이 같이 쓰는 방(공용 컴포넌트). 원자 자신은 «규격 그 자체»라 세지 않는다. */
export function rooms(): Map<string, Measured> {
  const out = new Map<string, Measured>();
  const paths = [...walkTsx(join(ROOT, 'components')), ...walkTsx(join(ROOT, 'features'))];
  for (const path of paths) {
    const file = rel(path);
    if (file.startsWith('components/ui/') || file.startsWith('components/sign/')) continue;
    const measured = measure([path]);
    if (measured.raw > 0 || measured.height > 0) out.set(file, measured);
  }
  return out;
}

/** 도면·오더에 적힌 이름 하나(`/login` 또는 `components/WorkPage.tsx`)를 실측한다. */
export function measureTarget(key: string): Measured | null {
  if (key.startsWith('/')) return floors().get(key) || null;
  const path = join(ROOT, key);
  return existsSync(path) ? measure([path]) : null;
}
