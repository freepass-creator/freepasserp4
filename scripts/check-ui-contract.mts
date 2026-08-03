/**
 * 업무 화면 UI 계약 가드.
 *
 * 페이지·기능 코드는 공용 UI 원자를 사용한다. raw 컨트롤은 브라우저 네이티브 동작이
 * 실제 기능에 필요한 경우만 파일·태그·개수까지 고정해 허용한다. 숫자 radius는 페이지마다
 * 미묘하게 달라지는 원인이므로 업무 화면에서는 R만 허용한다(0은 사각 표·스켈레톤 경계).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['app', 'components', 'features'];
const RAW = new Set(['button', 'input', 'select', 'textarea']);

type Allow = { reason: string; counts?: Partial<Record<string, number>>; all?: boolean };

const RAW_ALLOW = new Map<string, Allow>([
  ['app/global-error.tsx', { all: true, reason: '루트 레이아웃·globals.css까지 실패한 독립 최종 방어선' }],
  ['app/login/page.tsx', { all: true, reason: '앱 셸 전의 인증·동의 네이티브 폼 섬' }],
  ['app/m/page.tsx', { all: true, reason: '업무 화면이 아닌 모바일 프로모션 미리보기 섬' }],
  ['components/ContractDocs.tsx', { counts: { input: 1 }, reason: '숨김 파일 선택기' }],
  ['components/ChatThread.tsx', { counts: { button: 1, input: 1, textarea: 1 }, reason: '앨범 타일·숨김 파일 선택기·브라우저 자동완성 방지 채팅 입력기' }],
  ['components/PhotoUpload.tsx', { counts: { input: 1 }, reason: '숨김 사진 선택기' }],
  ['features/inventory/InventoryEditorPanes.tsx', { counts: { input: 1 }, reason: '숨김 OCR 파일 선택기' }],
  ['app/settlement/page.tsx', { counts: { input: 1 }, reason: '숨김 정산 엑셀 선택기' }],
]);

const RADIUS_ISLANDS = new Set([
  'app/global-error.tsx',
  'app/login/page.tsx',
  'app/m/page.tsx',
  'app/sign/[token]/page.tsx',
]);

const hits: string[] = [];

function rel(path: string) {
  return relative(ROOT, path).replace(/\\/g, '/');
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', 'data'].includes(entry.name)) walk(path, out);
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(path);
    }
  }
}

const files: string[] = [];
for (const root of ROOTS) walk(join(ROOT, root), files);

for (const path of files) {
  const file = rel(path);
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // aria-* 속성이 여는 태그 밖으로 빠지면 JSX 텍스트가 되어 화면과 스크린리더에
  // 그대로 노출된다. 브라우저 검수에서 발견한 회귀를 정적으로 차단한다.
  const visitAriaText = (node: ts.Node) => {
    if (ts.isJsxText(node) && /\baria-[a-z-]+\s*=/.test(node.getText(sourceFile))) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      hits.push(`${file}:${line + 1}: aria-* 속성이 JSX 텍스트로 노출됨`);
    }
    ts.forEachChild(node, visitAriaText);
  };
  visitAriaText(sourceFile);

  if (!file.startsWith('components/ui/')) {
    const counts: Record<string, number> = {};
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sourceFile);
        if (RAW.has(tag)) counts[tag] = (counts[tag] || 0) + 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const allow = RAW_ALLOW.get(file);
    if (Object.keys(counts).length && !allow) {
      hits.push(`${file}: raw 컨트롤 ${JSON.stringify(counts)} → components/ui 원자 사용`);
    } else if (allow && !allow.all) {
      const expected = allow.counts || {};
      const keys = new Set([...Object.keys(counts), ...Object.keys(expected)]);
      for (const tag of keys) {
        if ((counts[tag] || 0) !== (expected[tag] || 0)) {
          hits.push(`${file}: 허용 raw ${tag} 개수 변경 ${counts[tag] || 0}/${expected[tag] || 0} — 예외 근거 재검토 필요`);
        }
      }
    }
  }

  if (!file.startsWith('components/ui/') && !RADIUS_ISLANDS.has(file)) {
    source.split(/\r?\n/).forEach((line, index) => {
      const match = line.match(/borderRadius:\s*([0-9]+(?:\.[0-9]+)?)/);
      if (match && Number(match[1]) !== 0) {
        hits.push(`${file}:${index + 1}: 숫자 borderRadius ${match[1]} → R 사용`);
      }
    });
  }
}

if (hits.length) {
  console.error(`✗ UI 계약 드리프트 ${hits.length}건\n\n${hits.map((hit) => `  ${hit}`).join('\n')}`);
  process.exit(1);
}

console.log('✓ UI 계약 드리프트 0 — 공용 컨트롤·radius 및 명시 예외 정합성 유지');
