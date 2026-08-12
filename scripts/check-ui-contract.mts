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
  ['app/sign/[token]/page.tsx', { counts: { input: 2 }, reason: '신분증·셀카의 숨김 파일 선택기' }],
  ['components/ContractDocs.tsx', { counts: { input: 1 }, reason: '숨김 파일 선택기' }],
  ['components/ChatThread.tsx', { counts: { button: 3, input: 1, textarea: 1 }, reason: '첨부 목록 토글·사진 확대·앨범 타일·숨김 파일 선택기·브라우저 자동완성 방지 채팅 입력기' }],
  ['components/ConsultPanel.tsx', { counts: { input: 1 }, reason: '드롭존과 연결된 숨김 다중 파일 선택기' }],
  ['components/PhotoUpload.tsx', { counts: { input: 1 }, reason: '숨김 사진 선택기' }],
  ['features/inventory/InventoryEditorPanes.tsx', { counts: { input: 1 }, reason: '숨김 OCR 파일 선택기' }],
  ['app/settlement/page.tsx', { counts: { input: 1 }, reason: '숨김 정산 엑셀 선택기' }],
]);

// 기능상 native 요소가 필요한 명시 예외: 파일 선택기와 이미지 갤러리의 행/셀 버튼.
RAW_ALLOW.set('components/ChatThread.tsx', { counts: { button: 3, input: 1, textarea: 1 }, reason: '첨부 파일 선택기·갤러리 행/셀 버튼·채팅 입력기' });
RAW_ALLOW.set('components/ConsultPanel.tsx', { counts: { input: 1 }, reason: '상담 첨부 드롭존의 숨김 파일 선택기' });

const RADIUS_ISLANDS = new Set([
  'app/global-error.tsx',
  'app/login/page.tsx',
  'app/m/page.tsx',
  'app/sign/[token]/page.tsx',
]);

const hits: string[] = [];

// 비로그인 둘러보기는 폐기된 진입면이다. 오래된 브랜치 병합으로 버튼이나 guest 인증 우회가
// 되살아나면 상품·회원 화면이 인증 없이 열릴 수 있으므로 UI 게이트에서 함께 차단한다.
const loginSource = readFileSync(join(ROOT, 'app/login/page.tsx'), 'utf8');
const authContextSource = readFileSync(join(ROOT, 'lib/auth-context.tsx'), 'utf8');
if (/로그인 없이 둘러보기|\bdoGuest\b|\bsetGuest\s*\(/.test(loginSource)) {
  hits.push('app/login/page.tsx: 폐기된 비로그인 둘러보기 진입이 다시 추가됨');
}
if (/const\s+authed\s*=.*\bisGuest\s*\(/.test(authContextSource)) {
  hits.push('lib/auth-context.tsx: guest 플래그를 인증 세션으로 인정하면 안 됨');
}

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

  // components/ui 배럴은 'use client' 경계다. 서버 컴포넌트가 여기서 C/FW 같은
  // 객체 토큰을 꺼내 속성 접근하면 배포 런타임에서 client reference 직렬화 오류가 난다.
  const clientComponent = /^\s*['"]use client['"];/.test(source);
  if (file.startsWith('app/') && !clientComponent && /from\s+['"]@\/components\/ui['"]/.test(source)) {
    hits.push(`${file}: 서버 컴포넌트의 client UI 배럴 import → 토큰은 components/ui/tokens, 컴포넌트는 리프 모듈 사용`);
  }

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

// 목록 상태·선택은 좌측 색상 바에 의존하지 않는다. 상태는 아이콘·배지·카운트,
// 선택은 C.selected 배경이라는 모바일/웹 공통 목록 SSOT를 정적 게이트로 고정한다.
const feedRowSource = readFileSync(join(ROOT, 'components/ui/feedrow.tsx'), 'utf8');
const listRowsSource = readFileSync(join(ROOT, 'components/list-rows.tsx'), 'utf8');
if (/\baccent\s*\??:\s*BadgeTone|boxShadow\s*:\s*accent/.test(feedRowSource)) {
  hits.push('components/ui/feedrow.tsx: 목록 좌측 accent 바 금지 — 상태는 아이콘·배지·카운트 사용');
}
if (/\baccent\s*=/.test(listRowsSource)) {
  hits.push('components/list-rows.tsx: FeedListRow 좌측 accent 바 전달 금지');
}

// data-fp-m은 첫 페인트 힌트일 뿐이며 마운트 후 판정은 실제 viewport를 따라야 한다.
// 그렇지 않으면 회전·리사이즈 시 데스크톱 패널이 모바일 폭에 압축된다.
const mobileSource = readFileSync(join(ROOT, 'lib/use-mobile.ts'), 'utf8');
const liveWidthReader = mobileSource.match(/function readWidthMobile[\s\S]*?\n}/)?.[0] || '';
if (!liveWidthReader.includes('window.innerWidth') || liveWidthReader.includes('dataset.fpM')) {
  hits.push('lib/use-mobile.ts: 마운트 후 모바일 판정은 data-fp-m이 아닌 현재 window.innerWidth를 사용');
}

// 문의→계약 이동은 같은 권한 스코프의 계약 캐시를 즉시 보여주고, 목록과 무관한 정산 read가
// 계약 행 표시를 막지 않아야 한다. 모바일 탭 전환이 매번 skeleton으로 돌아가는 회귀를 막는다.
const contractPageSource = readFileSync(join(ROOT, 'app/contract/page.tsx'), 'utf8');
if (!contractPageSource.includes("peekList('contract', co)")) {
  hits.push('app/contract/page.tsx: 같은 세션 계약 캐시로 목록 첫 페인트 유지');
}
const contractRowsReadyAt = contractPageSource.indexOf('setRows(mine);');
const settlementBackgroundAt = contractPageSource.indexOf('void settlementsP.then');
if (contractRowsReadyAt < 0 || settlementBackgroundAt < 0 || contractRowsReadyAt > settlementBackgroundAt) {
  hits.push('app/contract/page.tsx: 계약 목록 표시는 정산 선조회 완료보다 먼저 처리');
}

if (hits.length) {
  console.error(`✗ UI 계약 드리프트 ${hits.length}건\n\n${hits.map((hit) => `  ${hit}`).join('\n')}`);
  process.exit(1);
}

console.log('✓ UI 계약 드리프트 0 — 공용 컨트롤·radius 및 명시 예외 정합성 유지');
