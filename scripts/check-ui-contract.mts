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
  /* app/login/page.tsx 는 2026-08-30 에 공용 원자로 갈아 raw 0 이 됐다(도면 §4 1순위).
     원자 높이(32/40)와 충돌해 예외였던 자리인데, CTRL 에 lg(44/48)를 더해 해소했다.
     ★다시 raw 를 쓰기 시작하면 여기 예외를 되살리지 말고 원자를 고칠 것. */
  ['app/m/page.tsx', { all: true, reason: '업무 화면이 아닌 모바일 프로모션 미리보기 섬' }],
  /* 손님 서명 화면은 착한거래 규격이라 ERP 원자를 «안 쓰는 게» 규격이다(docs/ESIGN-UIUX-SPEC.md).
     raw 는 sign.css 의 .btn/.auth-opt/.sagree/.field 가 제 규격으로 입힌다 —
     ERP 원자가 섞이지 않았는지는 check-esign-uiux 가 매번 「ERP 원자 0개」로 확인한다. */
  ['app/sign/[token]/page.tsx', {
    counts: { button: 14, input: 4, select: 2 },
    reason: '착한거래 규격 화면 — 단계 버튼·숨김 파일 선택기(신분증·얼굴·추가운전자 면허증·요청서류)·선택 칸',
  }],
  /* 견적(`/estimate`)은 **완전 별도 페이지**가 규격이다(사장님 2026-09-06 「모바일에서 보여지는 거 그대로 ·
     완전 별도 페이지라고 얘기할 정도로」 · 설계서 §11·§12 · docs/건물도면.md 로비 행).
     전자계약과 같은 갈래로, raw 는 `components/estimate/estimate.css` 가 제 규격으로 입힌다 —
     **사장님 목업**(`C:\Users\admin\Documents\프리패스-목업-모바일계산기.html`)을 «그대로» 옮긴 값이라
     업무동 원자(32/40·R4)를 쓰면 화면이 달라진다.
     ⚠ 숫자가 달라지면 화면이 목업에서 벗어났다는 뜻이다. 고치기 전에 **목업과 대조**할 것. */
  ['app/estimate/page.tsx', {
    counts: { button: 5, input: 2, select: 3 },
    reason: '견적 독립 면 — 사장님 목업(프리패스-목업-모바일계산기.html) 마크업 그대로. 칩·세그·기간카드·차종검색·잔가입력·신차 브랜드/모델/트림',
  }],
  ['components/sign/atoms.tsx', {
    counts: { button: 2, input: 1 },
    reason: '착한거래 «원자 파일» 자체 — SignOption·SignConsent·SignInput 의 본체(components/ui 와 같은 지위)',
  }],
  ['components/ContractDocs.tsx', { counts: { input: 1 }, reason: '숨김 파일 선택기' }],
  ['components/ChatThread.tsx', { counts: { button: 3, input: 1, textarea: 1 }, reason: '첨부 목록 토글·사진 확대·앨범 타일·숨김 파일 선택기·브라우저 자동완성 방지 채팅 입력기' }],
  ['components/ConsultPanel.tsx', { counts: { input: 1 }, reason: '드롭존과 연결된 숨김 다중 파일 선택기' }],
  ['components/PhotoUpload.tsx', { counts: { input: 1 }, reason: '숨김 사진 선택기' }],
  ['features/inventory/InventoryEditorPanes.tsx', { counts: { input: 1 }, reason: '숨김 OCR 파일 선택기' }],
  ['app/settlement/page.tsx', { counts: { input: 1 }, reason: '숨김 정산 엑셀 선택기' }],
  /**
   * 우클릭 메뉴 한 장 안에서 «상세 보기»는 <a>, «ERP 상세 미연결»은 <span>, 복사 둘은 <button>이다.
   * 셋이 .fp-sheet-view__context-action 한 클래스로 **똑같이 보여야** 하는데, Btn은 bare에서도
   * padding·background·display를 인라인으로 덮어써 클래스를 이긴다 — 원자를 넣으면 그 줄만 어긋난다.
   * 개수를 2로 못 박아 새 raw 컨트롤은 계속 걸리게 둔다. 갚을 빚: components/ui/ContextMenu SSOT 로 옮긴다.
   */
  ['features/finder/SheetView.tsx', { counts: { button: 2 }, reason: '한 클래스로 <a>·<span>과 같은 모양이어야 하는 우클릭 메뉴 항목' }],
]);

// 기능상 native 요소가 필요한 명시 예외: 파일 선택기와 이미지 갤러리의 행/셀 버튼.
RAW_ALLOW.set('components/ChatThread.tsx', { counts: { button: 3, input: 1, textarea: 1 }, reason: '첨부 파일 선택기·갤러리 행/셀 버튼·채팅 입력기' });
RAW_ALLOW.set('components/ConsultPanel.tsx', { counts: { input: 1 }, reason: '상담 첨부 드롭존의 숨김 파일 선택기' });

const RADIUS_ISLANDS = new Set([
  'app/global-error.tsx',
  'app/m/page.tsx',
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
// (2026-08-19 사장님: 계약진행=/contract 는 목록+5단계 진행 화면으로 복귀. 전자계약은 /esign 계약서관리 하나.)
const contractPageSource = readFileSync(join(ROOT, 'app/contract/page.tsx'), 'utf8');
if (!contractPageSource.includes("peekList('contract', co)")) {
  hits.push('app/contract/page.tsx: 같은 세션 계약 캐시로 목록 첫 페인트 유지');
}
const contractRowsReadyAt = contractPageSource.indexOf('setRows(mine);');
const settlementBackgroundAt = contractPageSource.indexOf('void settlementsP.then');
if (contractRowsReadyAt < 0 || settlementBackgroundAt < 0 || contractRowsReadyAt > settlementBackgroundAt) {
  hits.push('app/contract/page.tsx: 계약 목록 표시는 정산 선조회 완료보다 먼저 처리');
}
// 계약서관리(/esign)는 EsignSendCenter 하나가 목록 데이터를 직접 읽는다 — 페이지에서 엔진을 복제하지 않는다.
// 서버가 새 direct 계약을 만든 직후에는 cache health를 확인해 fresh read를 할 수 있으므로,
// `getStore().list(...)` 한 줄 형태가 아니라 같은 store 인스턴스의 목록 read를 확인한다.
const esignCenterSource = readFileSync(join(ROOT, 'components/EsignSendCenter.tsx'), 'utf8');
if (!esignCenterSource.includes('const store = getStore()')
  || !esignCenterSource.includes("store.list('contract', companyId)")) {
  hits.push('components/EsignSendCenter.tsx: 계약 목록 데이터 직접 조립 유지');
}

if (hits.length) {
  console.error(`✗ UI 계약 드리프트 ${hits.length}건\n\n${hits.map((hit) => `  ${hit}`).join('\n')}`);
  process.exit(1);
}

console.log('✓ UI 계약 드리프트 0 — 공용 컨트롤·radius 및 명시 예외 정합성 유지');
