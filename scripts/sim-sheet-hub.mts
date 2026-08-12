import { parseHubTable } from '../lib/domain/sheet-hub-sync';

let passed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL — ${label}`);
  passed++;
  console.log(`✓ ${label}`);
};

const rows = parseHubTable([
  ['구분', '코드', '연동방식', 'ERP 재고', '목록에 선 것', '시트 열기', '정책 수', '입력된 행', 'ERP 가 지금 읽는 곳', '그 주소(복사용)', '우리가 뜬 사본', '해야 할 일'],
  ['빌린카', 'RP021', '우리 제공 시트', '47', '45', '열기', '4', '47', '원본 열기', 'https://docs.google.com/spreadsheets/d/abc123/edit', '사본 열기', '연결 완료'],
]);
check('새 허브는 시트 열기 표시문구가 아니라 복사용 원본 URL을 읽음', rows[0]?.url === 'https://docs.google.com/spreadsheets/d/abc123/edit');
check('새 허브 공급사 코드·이름 유지', rows[0]?.code === 'RP021' && rows[0]?.name === '빌린카');

let htmlBlocked = false;
try { parseHubTable([['<!DOCTYPE html><style>/*# sourceMappingURL=style.css.map */']]); }
catch { htmlBlocked = true; }
check('Google 로그인 HTML을 공급사 행으로 오인하지 않음', htmlBlocked);

console.log(`\n${passed}/3 PASS — supplier hub`);
