/**
 * **원천대장에 「시트 지도」 탭** — 어떤 시트가 무엇의 정본이고, 무엇을 고치려면 어디를 만져야 하는지 한 장. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「차종마스터 시트에 매뉴얼로 어떤 시트를 반영해서 작업해야 하는지 매뉴얼 만들어줘」
 *   같은 내용을 리포 `docs/SHEET_MAP.md` 에도 쓴다(둘 다 이 파일에서 나온다).
 * ⚠ 이 탭은 기계가 통째로 다시 쓴다. 사람 메모는 「AI 인계」·「사용안내」에.
 *
 *   npx tsx scripts/publish-sheet-map-tab.mts            # 문서만
 *   npx tsx scripts/publish-sheet-map-tab.mts --apply    # 원천대장 탭까지
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID } from '../lib/domain/product-master-sheet';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';
import { VEHICLE_REFINE_FLOW } from '../lib/domain/vehicle-refine-flow';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { MIRROR_OWNER_RULE } from '../lib/domain/mirror-sheet-mapping';
import { EXTERNAL_LEGACY_ORIGINS, LEGACY_SHEETS, ENCAR_MASTER_SHEET_ID } from '../lib/domain/legacy-sheets';
import { CORE_BOOKS, STATUS_HELP, rosterRowFor, sheetUrl, type SheetIdentityInput } from '../lib/domain/sheet-identity';
import { LEGACY_SHEET_PREFIX, SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const TAB = '시트 지도';
const url = (id: string, gid?: number) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid !== undefined ? `#gid=${gid}` : ''}`;
const MASTER = DEFAULT_PRODUCT_MASTER_SHEET_ID;
const SALES = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
const HUB = '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : {};
};

/** [묶음, 항목, 내용, 링크/도구] */
const R: string[][] = [];
const row = (a = '', b = '', c = '', d = '') => R.push([a, b, c, d]);
row('시트 지도 — 무엇이 어디의 정본이고, 고치려면 어디를 만지나', '', '', `갱신 ${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} KST`);
row('', '★AI 운영 매뉴얼', '어떤 AI가 와도 같은 방식으로 일하기 위한 한 장 — 이 문서의 「AI 운영 매뉴얼」 탭(모든 시트에 같은 글, 정본 lib/domain/ai-operating-manual.ts). 시트 지도·정본 서열·차명 정제 흐름·AI 칸 규칙·매일 순서·금지·고치는 곳·규격·교훈.', 'npx tsx scripts/publish-ai-manual-tab.mts --apply');
row('', '원칙', '값은 한 곳에만 산다. 같은 값이 두 시트에 있으면 이 표가 정한 정본이 이기고, 나머지는 기계가 찍는 사본이다. 사본을 손으로 고치면 다음 발행에 사라진다.', '');
row('', '★원본 vs 정제시트 (사장님 2026-08-18)', '「MMDD 공급사 프리패스 재고 [제공]」 = 우리가 만들어 주고 공급사가 직접 적는 시트 → **그 시트가 원본이자 정제시트**(17곳). 「MMDD … [정제]」 = 공급사 자체 시트·홈페이지(원본)를 우리가 옮겨 담는 시트(아이카·오토플러스·이안카·아이언, 원본은 mirror-sources 표·각 시트 숨김 탭 「정제시트 안내」에). 문패·발행기·상품마스터는 **언제나 정제시트**를 읽는다. 앞 날짜 = 배포일(제공: 만든 날 · 정제: 전환한 날). 아이언은 원본시트가 홈페이지로 대체됐다. ★2026-08-19 부터 지금 읽는 21곳은 이름 끝 「[연동중]」, 옛 우리 시트는 이름 앞 「[구버전·폐기]」+첫 탭 「⚠ 구버전 — 안 씀」, 외부 원본은 이름 그대로(아래 0. 시트 명부).', '드라이브 검색 「프리패스 재고」 · 이름 규칙 supplierSheetName · rename-supplier-sheets · retire-legacy-sheets');
row();
// ★0. 시트 명부 — 사장님 2026-08-19 「현재 쓰고 있는 시트를 알아볼 수 있게 표기 · 구버전은 폐기 · 외부는 원본만 · 시트마다 구성/바라보는 곳/주는 곳 매뉴얼화」
//   상태 표식: 이름 끝 「[연동중]」 = 지금 읽는 시트 · 이름 앞 「[구버전·폐기]」 = 안 씀(첫 탭 「⚠ 구버전 — 안 씀」) · 외부 원본은 이름 안 건드림. 시트마다 「이 시트는」 탭(publish-sheet-identity-tab).
row('0. 시트 명부 (전체 — 상태 · 바라보는 곳 → 주는 곳)', '시트 · 종류 · 코드 · 소유', '바라보는 곳(입력) → 주는 곳(출력)', '링크 · 비고');
row('', '상태 어휘', Object.entries(STATUS_HELP).map(([k, v]) => `${k} = ${v}`).join('  /  '), '시트마다 「이 시트는」 탭 · 표기 도구 rename-supplier-sheets(연동중) · retire-legacy-sheets(구버전·폐기)');
{
  const idOf = (u: string) => (String(u).match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || '';
  const hubVals = ((await call(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}/values/A1:Z200`)).values || []) as string[][];
  const hubRows = hubVals.map((r) => r.map(S));
  const hi = hubRows.findIndex((r) => r.some((c) => /공급사코드|코드/.test(c)) && r.some((c) => /시트주소|주소|URL/i.test(c)));
  const hdr = hubRows[hi] || []; const ci = hdr.findIndex((c) => /공급사코드|코드/.test(c)); const ui = hdr.findIndex((c) => /시트주소|주소|URL/i.test(c));
  const codeBySheet = new Map<string, string>();
  for (const r of hubRows.slice(hi + 1)) { const id = idOf(r[ui] || ''); if (id && r[ci]) codeBySheet.set(id, S(r[ci])); }
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,owners(emailAddress))&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  const suppliers = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: S(f.name), owner: S(f.owners?.[0]?.emailAddress) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const mirrorById = new Map(MIRROR_SOURCES.map((m) => [m.to, m] as const));
  const inputs: SheetIdentityInput[] = [
    ...CORE_BOOKS.map((b) => ({ id: b.id, name: b.name, kind: b.kind, status: '정본(운영)' as const, owner: b.owner })),
    ...suppliers.map((s) => ({ id: s.id, name: s.name, kind: (mirrorById.has(s.id) ? '정제시트' : '제공시트') as SheetIdentityInput['kind'], status: '연동중' as const, owner: s.owner, code: codeBySheet.get(s.id), label: supplierSheetLabel(s.name), mirror: mirrorById.get(s.id) })),
    ...MIRROR_SOURCES.filter((m) => m.kind === 'sheet' && m.from).map((m) => ({ id: m.from!, name: `${m.name} 원본(공급사 시트)`, kind: '외부 원본' as const, status: '외부 원본' as const, code: m.code, label: m.name, owner: '공급사' })),
    ...EXTERNAL_LEGACY_ORIGINS.map((e) => ({ id: e.id, name: e.name, kind: '외부 원본' as const, status: '외부 원본' as const, code: e.code, label: e.name, owner: e.owner })),
    ...LEGACY_SHEETS.map((l) => ({ id: l.id, name: `${LEGACY_SHEET_PREFIX}${l.name}`, kind: l.kind, status: '구버전·폐기' as const, code: l.code, owner: l.owner, legacy: l })),
  ];
  for (const x of inputs) {
    const r = rosterRowFor(x);
    row(r.status, [r.name, r.kind, r.code, r.owner].filter(Boolean).join(' · '), `입력: ${r.reads}  →  출력: ${r.feeds}`, `${r.url}${r.note ? `  · ${r.note}` : ''}`);
  }
  row('', '아이언 원본', 'ironrentcar.com(홈페이지 수집) → 0818 아이언 프리패스 재고 [정제] [연동중]', 'apply-ironrentcar-sync · sync-mirror-all');
  row('', '백업', '「공급사시트 백업 2026-08-10」 폴더(옛 공급사 시트 17개 사본) — 읽지 않는다', 'https://drive.google.com/drive/folders/1zEY1g3e7mmxTS4u4nhlcQg4r4LsB01fO');
  console.log(`  시트 명부 ${inputs.length}줄(정본 ${CORE_BOOKS.length} · 연동중 ${suppliers.length} · 외부 원본 ${inputs.filter((i) => i.status === '외부 원본').length} · 구버전 ${LEGACY_SHEETS.length})`);
}
row();
row('1. 시트 목록', '시트', '무엇의 정본인가 · 누가 만지나', '위치');
row('', '「○○ 프리패스 재고」 21곳', '공급사 재고(차량번호·상태·기간별 대여료/보증금·정책코드)와 정책 조건의 정본. 재고·정책 탭은 공급사가, 정제칸(차종코드~차종분류)은 프리패스가. 탭: 재고 · (구독재고) · 정책 · 작성 안내 · [숨김] AI 인계. 열 차례는 웰릭스 표준(대여료 블록만 공급사 구조가 다를 수 있다 — 손오공 구독·오토플러스 2만/3만).', '드라이브 검색 「프리패스 재고」');
row('', '**정제시트** = 자체시트·홈페이지를 쓰는 공급사의 「○○ 프리패스 재고」', `아이카(원본 시트 1LqW…) · 오토플러스(1TJB…) · 이안카(1fJu…) · 아이언(ironrentcar.com) — 공급사는 자기 것을 계속 쓰고, 우리가 30분마다 정제시트로 옮겨 담는다(${MIRROR_OWNER_RULE}). 문패는 넷 다 정제시트를 가리킨다(2026-08-18). 상품마스터·판매시트는 정제시트만 읽는다 — 「상품마스터로 올 때는 어찌됐든 정제시트 통해서」. 원본 주소는 코드 mirror-sources.ts 한 표.`, 'npx tsx scripts/sync-mirror-all.mts --apply · 자체시트인데 아직 문패가 자기 시트인 곳: 손오공·리더스·스타·렌트존·우리캐피탈·SA(오플은 판매시트 오플 탭 통째 복사)');
row('', '「공급사시트정리」(문패)', '공급사코드 → 발행기가 읽을 시트 주소. 여기 적힌 주소가 그 공급사의 재고 정본이다.', url(HUB));
row('', '「프리패스 상품리스트」(판매시트)', '영업자가 보는 표. 기계가 찍는 사본 — 손으로 고치지 않는다. 탭 3개(2026-08-19 회귀): 상품리스트(21곳 − 오플 − 손오공 구독) · 손오공구독(보증금 반납형·기간별 반납형+인수형) · 오플구독(12개월 2만km … 36개월 3만km) — 같은 발행기, 갈래 탭은 공통 대여료 블록 대신 그 공급사 기간별 대여료, 같은 차는 한 탭에만 · [숨김] AI 인계(@매핑=열 구성 정본 · @제외) · AI 정제(치환 사전) · 이 시트는.', url(SALES));
row('', '원천대장 「차종마스터」', 'ERP 차종코드(mf- 트림행키) 보관. 상품마스터 「차종코드」가 여기를 가리킨다. 이름·기간 등 차명 사전은 아래 엔카 차종마스터. 코드는 삭제·재사용·의미변경 금지. 이 탭에 엔카 줄을 쓰지 않는다.', url(MASTER, 1159482177));
row('', '엔카 차종마스터', '차명·제원 사전(정본). 탭 「안내」·「차종마스터」·「세부모델」. 키 M/SM/T/U. 공급사 행키+기본스펙·사본 탭은 여기서 나온다.', url(ENCAR_MASTER_SHEET_ID));
row('', '원천대장 「차종마스터_규격검토」→「차종마스터_규격채택」', '검토(제조사·모델·세부모델·세부트림 3축)와 그 채택본. 판매시트 차명은 채택 이름을 쓴다. 검토 값을 고치면 채택본 재게시가 따라와야 한다.', url(MASTER, 271777427));
row('', '원천대장 「상품마스터」', '차량번호 → 차종코드 정본(ERP 가 읽는 입력). 상태·대여료·보증금은 갱신기(live) → 발행된 상품리스트 값으로 맞춤(⑤′) — 영업자 표와 같다. 코드는 결정 파일 → guarded writer 로만 박는다.', url(MASTER, 1357902468));
row('', '원천대장 「공급사 데이터 매뉴얼」·「공급사 열 매핑」·「공급사연동」', '공급사별 정본·읽는 탭·헤더행·우선순위·차명 조합·가격/상태 규칙·원본 URL, 원본 열 매핑, 연동 상태.', url(MASTER, 1773021401));
row('', '리포 data/product-vehicle-review-decisions.json', '차량번호별 3축 검토 결정(CODE/TRIPLE/PARTIAL/HOLD). 코드 없는 차의 차명은 여기서 나간다.', 'C:\\dev\\freepasserp4');
row();
row('2. 흐름 — 매일', '순서', '무엇이 무엇을 읽어 무엇을 찍나', '명령');
row('', '★한 방', '공급사가 고친 것을 일괄 반영: 정제칸 채움 → 못 정한 차 결정 → 상품리스트·인수형 발행 → 상품마스터 갱신 → 상품마스터 ← 상품리스트 맞춤(ERP 정확 일치) → 검수(돈·정제칸·빈 칸·ERP 일치 게이트). 한 단계 실패하면 멈춘다. AI 에게 「일일 반영 돌려」.', 'npx tsx scripts/run-daily.mts --apply (미리보기: --apply 빼고 · 미러 포함: --with-mirror · 가드 통과: --force-shrink)');
row('', '① 원본 → 정제시트', `아이카·오토플러스·이안카(시트)·아이언(홈페이지)을 정제시트로 옮긴다(${MIRROR_OWNER_RULE}). 줄별 조건 칸(대인·대물·자차…)은 정책 탭 정책코드로. 30분마다 mirror-sync.yml, 발행 직전 sheet-sync.yml — 둘 다 main 에 있어야 돈다.`, 'npx tsx scripts/sync-mirror-all.mts --apply (한 곳: sync-mirror-sheet / 정책: sync-mirror-policies)');
row('', '② 정제칸', '새 차의 정제칸(파워트레인·세부트림…)을 빈 칸만 채운다.', 'npx tsx scripts/fill-supplier-ai-columns.mts --apply');
row('', '③ 판매시트 발행', '20곳 재고 → 상품리스트. 차명은 상품마스터 코드→규격채택 이름, 코드 없으면 3축 결정, 그다음 정제칸·원문. 정책 43칸은 우리 제공시트 「정책」 탭. 돈·상태는 공급사 글자 그대로.', 'npx tsx scripts/publish-origin-tab.mts --apply');
row('', '④ 손오공구독·오플구독 탭(탭 3개, 2026-08-19 회귀)', '상품리스트(21곳 − 오플 − 손오공 구독) · 손오공구독(공통 대여료 블록 자리에 보증금 반납형·12~60개월 반납형·보증금 인수형·36/48/60개월 인수형) · 오플구독(그 자리에 12개월 2만km … 36개월 3만km). 같은 발행기(--only)라 차명·나머지 열이 같고, 같은 차는 한 탭에만(@제외 RP023·RP012:구독). 표준 칸은 별칭으로 되찾는다(sales-published-tabs.ts). ⚠ 2026-08-18 하루는 한 탭이었다(오플 12개월←12개월3만·24/36개월←2만 별칭은 표준 칸에 남아 있다). 옛 메모: 오플 탭·옛 손오공구독 탭은 지웠다.', 'publish-sonogong-tab --apply');
row('', '⑤ 돈 대조', '공급사시트 ↔ 상품리스트 금액. 어긋난 칸 0 이어야 한다.', 'npx tsx scripts/audit-sheet-vs-sales.mts');
row('', '⑥ ERP', '상품마스터 → ERP v4 (Vercel cron 02:00 KST). ★영업자 표 = ERP: 상품마스터 live 갱신 뒤 **발행된 상품리스트 값으로 상품마스터를 한 번 더 맞춘다**(sync-product-master-from-sales — 상태·1~60개월 대여료·보증금 · 「-」는 비움 · 보증금은 숫자일 때만 · 번호미정은 못 실림) → --audit-only 게이트 0 어긋남(2026-08-18 21:40 첫 적용 106칸). 2026-08-18 19:35 탭 이름을 되돌려 정상화(「상품마스터」=코드 규격 50열 정본 · 「상품 차종매칭」=검토 조회 뷰) 후 live 갱신 첫 적용: 21곳 627대 → 650줄(새 63·상태 171·요금 94·부재 23→출고불가). @제외는 판매시트 규칙이라 상품마스터에선 재고 아닌 탭만 뺀다(오플·손오공 구독 포함).', 'PLAN.md 「상품시트 ↔ ERP 연동」 · sync-product-master-live');
row('', '자동화', '.github/workflows/sheet-sync.yml — main 에 올라가야 매일 돈다(2026-08-18 현재 feat/sales-sheet-manual 에만 있음).', '');
row();
row('2-1. 차명 정제 흐름 (사장님 2026-08-18 — 「차종마스터·상품마스터에 매칭 → 정제시트에 박음 → 상품시트로」)', '단계', '무엇을', '어디서/명령');
for (const f of VEHICLE_REFINE_FLOW) row('', f.step, f.what, f.where);
row();
row('3. 무엇이 틀렸을 때 어디를 고치나', '증상', '고치는 곳', '그다음');
row('', '차 이름(모델·세부모델·트림)이 틀림', '코드가 있는 차: 상품마스터 차종코드(결정 파일 CODE → plan-product-vehicle-review-decisions → apply-product-master-vehicle-coverage --apply). 코드 없는 차: 결정 파일 TRIPLE/PARTIAL.', '판매시트 재발행');
row('', '마스터의 차종 이름·기간이 틀림', '차종마스터_규격검토(Gemini) → 규격채택 재게시(apply-vehicle-master-review-adoption).', '판매시트 재발행');
row('', '대여료·보증금·상태가 틀림', '그 공급사 재고 정본 — 우리 시트에 직접 쓰는 공급사면 「프리패스 재고」 재고 탭, 정제시트 공급사(아이카·오플·이안카·아이언)면 **공급사 원본/홈페이지**(정제시트에서 고쳐도 다음 미러가 원본으로 되돌린다 — 상태·대여료·차명·옵션은 live). 판매시트에서 고치지 않는다.', '①③⑤');
row('', '정제시트 공급사의 차명·옵션이 틀림', '원본 시트/홈페이지에서 고친다(다음 미러가 정제시트 왼쪽을 덮는다). 정제칸·정책코드·색·연식·가격은 정제시트에서(once·ours).', '① stamp');
row('', '정제시트 공급사의 색·연식을 고침', '정제시트 재고 탭에서 고친다(처음 한 번 옮긴 뒤로는 우리 기록 — 미러가 되돌리지 않는다). 정제칸·정책코드도 정제시트에서.', '');
row('', '정책 조건(보험·연령·주행…)이 틀림/빔', '그 공급사 「프리패스 재고」 정책 탭(표기 규격은 정책 탭 머리글 메모·docs/SUPPLIER_POLICY_SHEET_MANUAL.md). 차에 정책코드가 없으면 「프리패스 기본」으로 떨어진다.', '③');
row('', '판매시트 열이 빠지거나 자리가 다름', '판매시트 [숨김] AI 인계 @매핑(코드의 SALES_MAPPING 이 예비). 뺀 열은 SALES_RETIRED_COLUMNS.', 'publish-handover-tab --apply → ③');
row('', '공급사 시트 주소가 바뀜', '문패 「공급사시트정리」.', '③');
row('', '공급사 시트 양식이 어긋남', 'audit-supplier-schema 로 확인 → unify-supplier-columns(열 차례)·paint-supplier-period-columns(대여료 배경)·normalize-policy-values(정책 표기).', '');
row('', '영업자가 다운로드 못 함', '판매시트 공유 설정 「뷰어 다운로드·인쇄·복사」 켜기(copyRequiresWriterPermission=false).', '');
row();
row('4. 권한', '', '팀제이피케이(teamjpk.com) 도메인 = 모든 시트 편집. 공급사 제공시트 = 링크 가진 누구나 편집(공급사 담당자만 링크). 판매시트 = 링크 뷰어(다운로드 허용). 서비스계정 firebase-adminsdk-fbsvc@freepasserp3 = 읽기.', '');
row('5. 글꼴·규격', '', 'Roboto 9pt · 기간별 대여료 배경색 = 판매시트 COL_BG · 금액 「50만원·5천만원·1억5천만원」 · 나이 「만 21세까지」 · 거리 「연 20,000km」 · 가·부 「가능/불가/협의」.', 'lib/domain/policy-value-spec.ts');

const md = ['# 시트 지도 — 무엇이 어디의 정본이고, 고치려면 어디를 만지나', '', `기준일 2026-08-19 · 원천대장 「${TAB}」 탭과 같은 내용(\`scripts/publish-sheet-map-tab.mts\`).`, '', '| 묶음 | 항목 | 내용 | 위치/명령 |', '|---|---|---|---|',
  ...R.slice(1).filter((r) => r.some(Boolean)).map((r) => `| ${r.map((c) => c.replace(/\|/g, '／')).join(' | ')} |`), ''].join('\n');
writeFileSync('docs/SHEET_MAP.md', md, 'utf8');
console.log(`  문서 갱신 — docs/SHEET_MAP.md (${R.length}줄)`);
if (!APPLY) { console.log('※ 원천대장 탭 반영은 --apply'); process.exit(0); }

const SH = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER}`;
const meta = await call(`${SH}?fields=sheets.properties(sheetId,title,index)`);
let gid = (meta.sheets || []).map((x: Rec) => x.properties).find((p: Rec) => S(p.title) === TAB)?.sheetId;
if (gid === undefined) {
  const added = await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, index: 0, gridProperties: { rowCount: R.length + 10, columnCount: 4, frozenRowCount: 1 } } } }] }) });
  gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
}
await call(`${SH}/values/${encodeURIComponent(`'${TAB}'!A1:Z200`)}:clear`, { method: 'POST', body: '{}' });
await call(`${SH}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: R }) });
const rgb = (hex: string) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
const reqs: Rec[] = [
  { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
  { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: 12, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  ...[200, 260, 620, 360].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
  { updateSheetProperties: { properties: { sheetId: gid, tabColor: rgb('D9E7FD') }, fields: 'tabColor' } },
];
R.forEach((r, i) => { if (i > 0 && r[0]) reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: rgb('D9E7FD'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } }); });
await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
console.log(`  ✓ 원천대장 「${TAB}」 탭 ${R.length}줄 반영 — ${url(MASTER, gid)}`);
