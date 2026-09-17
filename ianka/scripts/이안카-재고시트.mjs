/** 이안카 API → 이안카 원천시트(1fJuFSdaW…, 탭 「이안카」) ALWAYS 칸 채우기.
 *
 *  손오공-재고시트.mjs 와 같은 역할이다 — 있는 값만 매번 갱신하고, 없는 값(요금·보증금·
 *  제조사/모델 정제)은 절대 지어내지 않는다. 그 칸들은 손대지 않아 기존 값(수기 입력분)을 보존한다.
 *
 *  ALWAYS = API가 사실로 주는 값만: 차량번호(신규 행 키)·배차상태·연식·연료·주행거리·차명(원문).
 *  건드리지 않는 칸: 제조사·모델·세부모델·세부트림·구분·단기보증·장기보증·1~60개월
 *    (2026-09-17 기준 API에 없다 — ianka.mjs 머리말 참고. 생기면 그때 FILLIFEMPTY로 추가한다).
 *
 *  API에 더는 없는 기존 차는 삭제하지 않고 「출고불가」로 내린다(손오공과 동일 원칙).
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
  put(['차명(원문)', '차명', '차량명'], c.차명원문);
  return row;
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

  const apiPlates = new Set(차량.map((c) => 씻(c.차번)));
  const rows = 차량.map((c) => 행빌드(header, 기존맵.get(씻(c.차번)), c));
  const 상태col = header.findIndex((h) => ['배차상태', '상태', '판매상태', '출고상태'].includes(h));
  const 보존행 = 기존행.filter((r) => !apiPlates.has(씻(r[plateCol]))).map((r) => {
    const c = r.slice();
    if (상태col >= 0) c[상태col] = '출고불가';
    return c;
  });
  const allRows = rows.concat(보존행);

  console.log(`[${탭}] 총 ${allRows.length}행 (API ${차량.length}: 신규 ${차량.filter((c) => !기존맵.has(씻(c.차번))).length} · API에없어 보존 ${보존행.length})`);
  console.log('  헤더칸:', header.length);
  if (rows[0]) {
    const idx = (n) => header.indexOf(n);
    console.log('  샘플:', ['차량번호', '배차상태', '연식', '연료'].filter((n) => idx(n) >= 0).map((n) => `${n}=${rows[0][idx(n)]}`).join(' · '));
  }

  if (!쓰기) {
    const p = path.join(루트, 'tmp', '이안카재고시트-preview.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ 탭, header, rows: allRows }, null, 1));
    console.log(`\n[미리보기만] 라이브 안 건드림 → ${p}\n실제 반영: node scripts/이안카-재고시트.mjs --쓰기`);
    return;
  }

  const taskId = 'OPS-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-IANKA';
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
