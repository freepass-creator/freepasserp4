/** Publish the vehicle-master operating manual into the SSOT workbook. */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MASTER_SHEET_ID } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
const APPLY = process.argv.includes('--apply');
const TAB = '차종마스터_매뉴얼';
const S = (value: unknown) => String(value ?? '').trim();
const headers = ['구분', '규칙', '예시', '완료·검증 조건'];
const rows = [
  ['제조국', '제조사 앞에서 국내 중고차 시장의 국산/수입 분류를 표시', '국산: 현대·기아·제네시스·르노코리아·쉐보레·KG모빌리티 / 그 외 수입', '값은 국산/수입이며 실제 최종조립국·브랜드 본국과 혼합하지 않음'],
  ['목적', '우리 렌터카 상품을 엔카 없이도 독립적으로 분류하는 내부 정본', '공급사 원문 → 차종마스터 조합', '현재 상품과 최근 10년 유통 가능 모델 우선'],
  ['필수 계층', '제조사 → 모델 → 세부모델 → 세부트림', '현대 → 싼타페 → 디 올 뉴 싼타페 MX5 → 캘리그래피', '네 값은 공란 금지'],
  ['선택 속성', '연료·배기량·과급·배터리·구동·구동시스템·인승·차종분류·차체형태·연식·생산기간', '하이브리드 / 1,598cc / AWD / HTRAC / 6인승', '알려진 값은 독립 열에 저장'],
  ['모델', '브랜드가 사용하는 대표 차명만 기록', '쏘나타, 그랜저, 스타리아', '연식·연료·개발코드·트림 금지'],
  ['세부모델', '세대·부분변경·제품군 명칭과 개발코드만 기록', '쏘나타 디 엣지 DN8, 더 뉴 그랜저 GN11', '연식·연료·배기량·구동·인승 금지'],
  ['엔카 세대', '엔카의 3세대·4세대 표기는 계보 판별에만 사용하고 우리 세부모델은 공식 변경명과 개발코드로 기록', 'K5 3세대 → K5 DL3, 더 뉴 K5 3세대 → 더 뉴 K5 DL3', '세대 숫자는 세대 참고값에만 보존하고 세부모델명에서 제외'],
  ['제품군', '차체 제품군이 실제로 갈리면 세부모델에 보존', '스타리아 카고 US4, 스타리아 라운지 US4', '카고·투어러·라운지·리무진을 임의 병합하지 않음'],
  ['세부트림', '순수 판매 트림명만 기록하고 괄호 설명·영문 병기는 제거', '필 [必; Feel] → 필, CVX 럭셔리 (CVX Luxury) → 럭셔리', '연료·배기량·구동·인승·괄호·영문 설명 제거; 공식 트림명이 없으면 기본형'],
  ['한글 표기', '일반 영문 등급어는 한글화. 제조사 공식 라틴 고유명·약어·개발코드는 원문', 'Premium → 프리미엄, Black Exterior → 블랙 익스테리어 / H-PICK·N Line·X Line·GT Line·VIP PACK·FLUX·GN11·AWD 유지', 'N(고성능)과 N Line(트림)은 서로 합치지 않음'],
  ['트림 별칭', '동일 표현은 하나의 정본으로 통합하고 원문은 별칭 보존', 'N라인·엔 라인 → N Line, X라인 → X Line, H-픽·H-Pick → H-PICK', 'N과 N Line은 서로 합치지 않음'],
  ['연료', '가솔린·디젤·LPG·하이브리드·전기·수소 등을 독립 저장', 'LPI 모던 → 연료 LPG / 트림 모던', '차명·트림에 연료가 남지 않음'],
  ['EV 계보', '내연기관 파생 전기차는 세부모델에 EV와 개발코드·FL을 보존', 'G80 EV RG3 / G80 EV RG3 FL', '전동화·Electrified·일렉트리파이드·전기차는 검색 별칭으로 연결'],
  ['전동 유형', 'EV·HEV·PHEV·FCEV를 서로 다른 연료·동력 유형으로 관리', 'EV=순수전기 / HEV=일반 하이브리드', 'EV 검색에 HEV·PHEV가 섞이지 않음'],
  ['EV 필수축', '공식 배터리·FWD/RWD/AWD·인승·트림·생산기간을 독립 저장', '84kWh / RWD / 5인승', '공식 비공개는 미확인으로 보존하고 역산·추정 금지'],
  ['배기량', '정확한 cc를 숫자로 저장', '1.6 → 1,598cc', '공식 제원과 일치하거나 미확인'],
  ['과급', '자연흡기·터보·슈퍼차저 정보를 독립 저장', '가솔린 1.6T → 터보', '배기량이나 트림명에 섞지 않음'],
  ['배터리', '전기차 배터리 용량을 kWh 숫자로 독립 저장', '84.0kWh', '스탠다드·롱레인지 구분 근거 보존'],
  ['표준 구동', 'FWD·RWD·AWD·4WD로 기록; 단순 2WD는 공식 자료가 2WD만 제공할 때만 사용', '아이오닉5 RWD, 싼타페 AWD', 'FWD/RWD 추정 금지'],
  ['구동시스템', '제조사 고유명은 표준 구동과 별도 보존', 'AWD / HTRAC, AWD / 4MATIC', 'xDrive·quattro 등도 같은 방식'],
  ['인승', '승인 인승을 숫자로 독립 저장', '5, 6, 7, 9, 11', '트림명에서 인승 제거'],
  ['차종분류', '국내 시장의 크기 등급을 모델·세대별로 기록', '경형·소형·준중형·중형·준대형·대형', '차체형태·배기량·전동 유형과 혼합 금지; 미확인 0'],
  ['차체형태', '외형 기반 차체를 기록', '세단·SUV·MPV·밴·픽업·화물', '차종분류와 별도 열'],
  ['용도 제외', '현재 범위가 전부 렌터카이므로 차종마스터 열에서 제외', '렌터카·구독 공통', '향후 실제 구분 필요 시 별도 정책축으로 추가'],
  ['변속기', '현재 핵심 차종마스터와 매칭 조건에서 제외하고 원문·추가제원으로만 보존', '자동 8단, DCT 8단', '차종코드 구성에 사용하지 않음'],
  ['질문 규칙', '필수 4축이 같고 선택 속성이 복수일 때만 사용자에게 확인', '연료·구동·인승 중 무엇인가요?', '하나만 가능하면 자동 보완, 복수면 추정 금지'],
  ['확정 규칙', '제조사·모델·세부모델·세부트림과 알려진 선택 속성이 한 행에 모순 없이 일치해야 확정', 'AUTO_UNIQUE', '다중후보·무후보·충돌은 검토 유지'],
  ['근거 역할', '모델·세부모델 계층과 시장 표기는 엔카를 우선 참조하고, 연료·배기량·구동·인승·배터리·기간은 제조사 공식 가격표·카탈로그로 검증', '엔카 세부모델 계보 + 현대·기아 공식 가격표', '세부트림은 엔카 등급과 제조사 가격표를 대조; 충돌 시 공식 제원 우선'],
  ['원문 보존', '공급사·엔카·기존 마스터 표현을 원문별칭에 누적', '2026 싼타페 MX5 H-Pick', '정본 치환 후에도 원문 삭제 금지'],
  ['영구키', '기존 키는 재사용·의미변경하지 않고 잘못된 키는 차단 후 새 키 추가', '기존 blocked 키 ≠ 신규키', '키 드리프트·중복 0'],
  ['모델 범위', '우리 상품에 모델이 하나라도 있으면 최근 10년 렌터카 유통 가능 조합을 모델 단위로 구성', '현대 상품 모델 14종', '현재 상품 직접 참조 키만으로 축소하지 않음'],
  ['정렬', '제조국 국산/수입 → 제조사 → 모델로 묶고, 같은 모델은 생산시작 최신순 → 세부모델 → 연료 → 배기량 → 배터리 → 구동 → 인승 → 세부트림', '신형·신차가 위, 구형이 아래', '모델별 생산시작 단조 내림차순; 생산시작 공란은 맨 아래'],
  ['중복', '필수 계층과 모든 선택 속성이 같으면 하나로 통합하고 기존 키·원문은 함께 보존', 'LPI 모던 / 모던 → 모던', '완전 중복 0'],
  ['금지', '연식·출시·국내형·연료·배기량·구동·인승을 모델·세부모델·세부트림에 임시 삽입 금지', '2026 아반떼 LPi 렌터카 CN7 금지', '오염 감사 0'],
  ['검증', '반영 전 CAS·스냅샷, 반영 후 재조회·키 계약·상품 커버리지·타입검사를 수행', '시트 재읽기 / drift 0', '필수 검증 실패 0'],
];

writeFileSync('tmp/vehicle-master-manual.json', `${JSON.stringify({ headers, rows }, null, 2)}\n`);
if (!APPLY) { console.log(JSON.stringify({ mode: 'dry_run', tab: TAB, rows: rows.length }, null, 2)); process.exit(0); }

const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({ email: S(credentials.client_email), key: S(credentials.private_key), scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com' }).getAccessToken()).token;
if (!token) throw new Error('Sheets token missing');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const api = async (url: string, init: RequestInit = {}) => { const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }); const body = await response.json().catch(() => ({})) as Rec; if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 500)}`); return body; };
const metadata = await api(`${base}?fields=sheets.properties`);
let sheet = (metadata.sheets || []).find((item: Rec) => S(item.properties?.title) === TAB);
let created = false;
if (!sheet) { const added = await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 1, columnCount: 4, frozenRowCount: 1 } } } }] }) }); sheet = { properties: added.replies?.[0]?.addSheet?.properties }; created = true; }
const sheetId = sheet?.properties?.sheetId;
if (!Number.isInteger(sheetId)) throw new Error('sheetId missing');
const range = `'${TAB}'!A1:D${rows.length + 1}`; const snapshotRange = `'${TAB}'!A1:D200`;
const previous = created ? { values: [] } : await api(`${base}/values/${encodeURIComponent(snapshotRange)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
writeFileSync(`tmp/vehicle-master-manual-snapshot-${Date.now()}.json`, `${JSON.stringify(previous, null, 2)}\n`);
try {
  if (!created) await api(`${base}/values/${encodeURIComponent(snapshotRange)}:clear`, { method: 'POST', body: '{}' });
  await api(`${base}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ range, majorDimension: 'ROWS', values: [headers, ...rows] }) });
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.92, green: 0.95, blue: 1 }, textFormat: { bold: true, fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: rows.length + 1 }, properties: { pixelSize: 42 }, fields: 'pixelSize' } },
    ...[120, 420, 300, 280].map((pixelSize, index) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 }, properties: { pixelSize }, fields: 'pixelSize' } })),
  ] }) });
  const verify = await api(`${base}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
  if ((verify.values || []).length !== rows.length + 1 || verify.values?.[0]?.join('|') !== headers.join('|')) throw new Error('Post-read mismatch');
  console.log(JSON.stringify({ mode: 'published_verified', tab: TAB, sheetId, rows: rows.length }, null, 2));
} catch (cause) {
  if (created) await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }) });
  else { await api(`${base}/values/${encodeURIComponent(snapshotRange)}:clear`, { method: 'POST', body: '{}' }); if (previous.values?.length) await api(`${base}/values/${encodeURIComponent(snapshotRange)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ range: snapshotRange, majorDimension: 'ROWS', values: previous.values }) }); }
  throw cause;
}
