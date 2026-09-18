/** 이안카 API → 이안카 원천시트(1fJuFSdaW…, 탭 「이안카」) ALWAYS 칸 채우기
 *  + (있으면) 화면 스크랩 요금표로 빈 요금칸만 FILLIFEMPTY.
 *
 *  손오공-재고시트.mjs 와 같은 역할이다 — 있는 값만 매번 갱신하고, 없는 값(요금·보증금·
 *  제조사/모델 정제)은 절대 지어내지 않는다. 그 칸들은 손대지 않아 기존 값(수기 입력분)을 보존한다.
 *
 *  ALWAYS = API가 사실로 주는 값만: 차량번호(신규 행 키)·배차상태·연식·연료·주행거리·차명(원문).
 *
 *  요금(단기보증/장기보증/1~60개월)은 API에 없다(2026-09-17 다각도 실측 — /api/rates 는
 *  role:b2b 계정에 진짜 403, /api/inventory 는 어떤 방식으로 불러도 요금 0건, JS 번들에도
 *  차종명 자체가 없음. ChatGPT 독립 감사 audit 38도 같은 결론). 대신 이안카-요금스크랩.mjs가
 *  로그인 화면(DOM)에서 차종별 1~60개월 요금을 긁어 lib/wonja/이안카요금.json에 남기면,
 *  그 파일이 있을 때만 «빈 칸만» 채운다 — 기존 수기 입력값은 절대 덮지 않는다(FILLIFEMPTY).
 *  이 요금표는 사람이 수기로 하던 걸 대신하는 부트스트랩 값이지 API 실측이 아니다 —
 *  차종명 매칭이 안 되거나 그 개월 수(사이트 필터가 1·3·5·12·24·36·48·60만 제공 — 6개월은
 *  못 채운다)가 없으면 조용히 건너뛴다.
 *
 *  API에 더는 없는 기존 차는 삭제하지 않고 「출고불가」로 내린다(손오공과 동일 원칙).
 *
 *  ⚠ 실제 시트엔 「차명(원문)」·「연식」 칸이 없다(2026-09-18 실측). 차명원문은 대신
 *  「세부모델」에 채우는데, ChatGPT 독립 감사(audit 40·41)가 지적한 대로 그 칸은 사람이
 *  정제해 둔 identity 값일 수 있어 «비어 있을 때만» 채운다(FILLIFEMPTY) — 절대 덮지 않는다.
 *  연식은 채울 칸이 아예 없어 그대로 둔다(시트에 칸을 새로 만드는 건 별도 승인 필요).
 *
 *    node scripts/이안카-재고시트.mjs            미리보기(라이브 안 건드림)
 *    node scripts/이안카-재고시트.mjs --쓰기      백업 후 반영
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sheet, colL } from '../../sonokong/lib/sheet.mjs';
import { withLease } from '../../sonokong/lib/lease.mjs';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs';
const 탭 = '이안카';
const 쓰기 = process.argv.includes('--쓰기');
const 씻 = (x) => String(x ?? '').replace(/\s/g, '');

function 행빌드(header, 기존, c) {
  const row = header.map((h, i) => (기존 ? (기존[i] ?? '') : ''));
  const put = (names, v) => {
    if (v === '' || v == null) return;
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) row[i] = v;
  };
  put(['차량번호', '차번'], c.차번);
  put(['배차상태', '상태', '판매상태', '출고상태'], c.배차상태);
  put(['연식', '년식'], c.연식);
  put(['연료'], c.연료);
  put(['Km', 'KM', '주행거리'], c.주행거리 ?? '');
  // ⚠ 실제 시트 헤더엔 「차명(원문)」·「연식」 칸 자체가 없다(2026-09-18 실측 — 헤더 40칸에
  // 상태·입고일자·구분·차량번호·차종분류·세부모델·연료·외장·내장·Km·단기보증·1~60개월·
  // 장기보증·트림·옵션·최초등록·소비자가격·제조사·배기량 등만 있음). 어댑터(lib/adapters/ianka.ts)가
  // rawName 못 찾으면 「세부모델」을 subModel로 읽으므로, 차명원문을 세부모델에 채운다.
  // ⚠⚠ ChatGPT 독립 감사(audit 40·41) 지적 — 「세부모델」은 사람이 정제해 둔 identity 칸일 수
  // 있다. put()처럼 무조건 덮으면 기존 13대의 정제값을 API 원문으로 갈아칠 위험이 있다.
  // 「차명(원문)/차명/차량명」이 진짜로 있으면(다른 공급사) 그대로 ALWAYS 덮어쓰되, 세부모델로
  // fallback할 때는 «비어 있을 때만» 채운다(FILLIFEMPTY) — 정제값은 절대 안 건드린다.
  {
    const exact = header.findIndex((h) => ['차명(원문)', '차명', '차량명'].includes(h));
    if (exact >= 0 && c.차명원문) {
      row[exact] = c.차명원문;
    } else {
      const fallback = header.findIndex((h) => h === '세부모델');
      if (fallback >= 0 && c.차명원문 && (row[fallback] === '' || row[fallback] == null)) {
        row[fallback] = c.차명원문;
      }
    }
  }
  // 연식은 채울 곳이 없다 — 칸을 새로 만드는 건 시트 구조 변경이라 사장님 확인 필요(따로 보고).
  return row;
}

function 요금채우기(header, row, 차명, 모델요금) {
  if (!모델요금 || !차명) return 0;
  const 요금 = 모델요금[차명];
  if (!요금) return 0;
  let 채운칸 = 0;
  header.forEach((h, i) => {
    if (row[i] !== '' && row[i] != null) return; // 기존 값(수기 포함) 있으면 손 안 댐
    const m = String(h).trim().match(/^(\d+)개월$/);
    if (m) {
      const rental = 요금[Number(m[1])]?.rental;
      if (rental != null) { row[i] = rental; 채운칸++; }
      return;
    }
    if (h === '단기보증') {
      const deposit = 요금[1]?.deposit ?? 요금[3]?.deposit;
      if (deposit != null) { row[i] = deposit; 채운칸++; }
      return;
    }
    if (h === '장기보증') {
      const 긴기간 = [60, 48, 36, 24, 12].find((n) => 요금[n]?.deposit != null);
      if (긴기간) { row[i] = 요금[긴기간].deposit; 채운칸++; }
    }
  });
  return 채운칸;
}

async function main() {
  const 차량 = JSON.parse(fs.readFileSync(path.join(루트, 'lib/wonja/이안카차량.json'), 'utf8')).차량;
  const s = await sheet(ID);
  const v = await s.values(탭, 'A1:BZ2000', 'FORMATTED_VALUE');
  const header = (v[0] || []).map((h) => String(h ?? '').trim());
  const plateCol = header.findIndex((h) => ['차량번호', '차번'].includes(h));
  if (plateCol < 0) throw new Error(`「${탭}」 탭에 차량번호 열이 없다 — 헤더: ${header.join('·')}`);
  const 기존행 = v.slice(1).filter((r) => 씻(r[plateCol]));
  const 기존맵 = new Map(기존행.map((r) => [씻(r[plateCol]), r]));

  let 모델요금 = null;
  const 요금파일 = path.join(루트, 'lib/wonja/이안카요금.json');
  if (fs.existsSync(요금파일)) {
    try { 모델요금 = JSON.parse(fs.readFileSync(요금파일, 'utf8')).모델요금 ?? null; } catch {}
  }
  const 차명col = header.findIndex((h) => ['차명(원문)', '차명', '차량명', '세부모델'].includes(h));

  const apiPlates = new Set(차량.map((c) => 씻(c.차번)));
  const rows = 차량.map((c) => 행빌드(header, 기존맵.get(씻(c.차번)), c));
  let 요금채운행 = 0, 요금채운칸 = 0;
  if (모델요금 && 차명col >= 0) {
    for (const row of rows) {
      const 칸수 = 요금채우기(header, row, row[차명col], 모델요금);
      if (칸수 > 0) { 요금채운행++; 요금채운칸 += 칸수; }
    }
  }
  const 상태col = header.findIndex((h) => ['배차상태', '상태', '판매상태', '출고상태'].includes(h));
  const 보존행 = 기존행.filter((r) => !apiPlates.has(씻(r[plateCol]))).map((r) => {
    const c = r.slice();
    if (상태col >= 0) c[상태col] = '출고불가';
    return c;
  });
  const allRows = rows.concat(보존행);

  const 신규차번 = 차량.filter((c) => !기존맵.has(씻(c.차번))).map((c) => c.차번);
  const 교집합차번 = 차량.filter((c) => 기존맵.has(씻(c.차번))).map((c) => c.차번);
  const 보존차번 = 보존행.map((r) => r[plateCol]);

  console.log(`[${탭}] 총 ${allRows.length}행 (API ${차량.length}: 신규 ${신규차번.length} · API에없어 보존 ${보존행.length})`);
  console.log('  헤더칸:', header.length);
  if (rows[0]) {
    const idx = (n) => header.indexOf(n);
    console.log('  샘플:', ['차량번호', '배차상태', '연식', '연료'].filter((n) => idx(n) >= 0).map((n) => `${n}=${rows[0][idx(n)]}`).join(' · '));
  }
  console.log(`\n  기존 시트 행 수(차번 있는 행): ${기존행.length}`);
  console.log(`  교집합(API∩기존시트) ${교집합차번.length}대: ${교집합차번.join(', ') || '(없음)'}`);
  console.log(`  신규(API에만 있음) ${신규차번.length}대: ${신규차번.join(', ') || '(없음)'}`);
  console.log(`  보존(기존시트에만 있음, 출고불가 처리) ${보존차번.length}대: ${보존차번.join(', ') || '(없음)'}`);
  if (모델요금) {
    console.log(`\n  요금표(lib/wonja/이안카요금.json, 모델 ${Object.keys(모델요금).length}종) 발견 → 빈 칸만 채움: ${요금채운행}행 · ${요금채운칸}칸`);
    if (요금채운행 === 0) {
      const 개월칸 = header.filter((h) => /개월|보증/.test(h));
      console.log(`  [디버그] 헤더의 개월/보증 칸: ${JSON.stringify(개월칸)}`);
      console.log(`  [디버그] 헤더 전체(${header.length}칸): ${JSON.stringify(header)}`);
      console.log(`  [디버그] 차명col=${차명col} 샘플 차명 3개: ${JSON.stringify(rows.slice(0, 3).map((r) => r[차명col]))}`);
      console.log(`  [디버그] 요금표 모델명 5개: ${JSON.stringify(Object.keys(모델요금).slice(0, 5))}`);
      if (rows[0]) {
        const 샘플차명 = rows[0][차명col];
        console.log(`  [디버그] 첫 행 차명="${샘플차명}" → 매칭됨? ${!!모델요금[샘플차명]}`);
      }
    }
  } else {
    console.log('\n  요금표(이안카요금.json) 없음 — 요금칸은 손 안 댐(기존 수기값 그대로)');
  }

  // ★쓰기 전 눈으로 대조 — 실제로 채워진 행 몇 개를 차번·세부모델·요금과 함께 찍는다.
  if (모델요금 && 차명col >= 0) {
    const 표본 = rows.filter((r) => r[차명col] && 모델요금[r[차명col]]).slice(0, 5);
    console.log(`\n  [표본검수] 요금 매칭된 행 ${표본.length}개(최대 5개 표시):`);
    const idx = (n) => header.indexOf(n);
    for (const r of 표본) {
      const 칸 = ['차량번호', '세부모델', '단기보증', '1개월', '12개월', '60개월', '장기보증']
        .filter((n) => idx(n) >= 0).map((n) => `${n}=${r[idx(n)]}`).join(' · ');
      console.log(`    ${칸}`);
    }
  }

  if (!쓰기) {
    const p = path.join(루트, 'tmp', '이안카재고시트-preview.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ 탭, header, rows: allRows }, null, 1));
    console.log(`\n[미리보기만] 라이브 안 건드림 → ${p}\n실제 반영: node scripts/이안카-재고시트.mjs --쓰기`);
    return;
  }

  const taskId = 'OPS-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-031';
  await withLease(`sheet:${ID}`, { agent: 'claude', taskId, purpose: '이안카 원천시트 배차상태·제원 반영' }, async () => {
    const bp = await s.backup(path.join(루트, 'backups', 'ianka-stock'));
    console.log('백업:', bp);
    const 끝열 = colL(header.length - 1);
    await s.write(`'${탭}'`, `A2:${끝열}2000`, Array.from({ length: 1999 }, () => Array(header.length).fill('')));
    await s.write(`'${탭}'`, `A2:${끝열}${1 + allRows.length}`, allRows);
    console.log(`✅ ${탭} ← ${allRows.length}행`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
}
