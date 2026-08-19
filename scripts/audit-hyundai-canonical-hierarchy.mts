import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

type RecordRow = {
  trim_row_key: string;
  maker: string;
  model: string;
  sub_model: string;
  powertrain: string;
  trim: string;
  production_start?: string;
  production_end?: string;
};

type Artifact = { records: RecordRow[] };

const SAFE_SUB_MODEL_MAP: Record<string, string> = {
  '2021 싼타페 TM 부분변경': '더 뉴 싼타페 TM',
  '2026 싼타페 MX5 Black Ink': '디 올 뉴 싼타페 MX5',
  '2026 싼타페 MX5 H-Pick': '디 올 뉴 싼타페 MX5',
  '2026 아반떼 하이브리드 CN7': '더 뉴 아반떼 CN7',
  '2026 아반떼 LPi CN7': '더 뉴 아반떼 CN7',
  '2026 아반떼 LPi 렌터카 CN7': '더 뉴 아반떼 CN7',
  '2026 투싼 NX4 H-Pick': '더 뉴 투싼 NX4',
  '2025 코나 SX2 Black Exterior': '디 올 뉴 코나 SX2',
  '2025 코나 SX2 H-Pick': '디 올 뉴 코나 SX2',
  '2027 코나 SX2': '디 올 뉴 코나 SX2',
  '2024 스타리아 카고 하이브리드': '스타리아 US4',
  '2024 스타리아 라운지 하이브리드': '스타리아 US4',
  '2024 스타리아 투어러 하이브리드': '스타리아 US4',
  '2025 스타리아 리무진 하이브리드': '스타리아 US4',
  '2027 캐스퍼 AX1 승용': '더 뉴 캐스퍼 AX1',
  '2027 캐스퍼 AX1 VAN': '더 뉴 캐스퍼 AX1',
  '2027 아이오닉 5 Long Range': '더 뉴 아이오닉5 NE',
  '2027 아이오닉 5 Standard': '더 뉴 아이오닉5 NE',
  '2027 아이오닉 5 영업용': '더 뉴 아이오닉5 NE',
  '아이오닉 5 Long Range 72.6kWh': '아이오닉5 NE',
  '아이오닉 5 Long Range 77.4kWh': '아이오닉5 NE',
  '아이오닉 5 Standard 58.0kWh': '아이오닉5 NE',
  '아이오닉 5 영업용 2022': '아이오닉5 NE',
  '캐스퍼 일렉트릭 AX1e 트림별 출시계보': '캐스퍼 일렉트릭 AX1e',
};

const artifact = JSON.parse(
  readFileSync('public/data/vehicle-trim-master.json', 'utf8'),
) as Artifact;

const hyundai = artifact.records.filter((row) => row.maker === '현대');
const proposals = hyundai
  .filter((row) => SAFE_SUB_MODEL_MAP[row.sub_model])
  .map((row) => ({
    trim_row_key: row.trim_row_key,
    model: row.model,
    before_sub_model: row.sub_model,
    after_sub_model: SAFE_SUB_MODEL_MAP[row.sub_model],
    powertrain: row.powertrain,
    trim: row.trim,
    production_start: row.production_start || '',
    production_end: row.production_end || '',
  }));

const unresolvedLabels = [...new Set(hyundai
  .map((row) => row.sub_model)
  .filter((label) => /(^|\s)20\d{2}(\s|$)|국내형|출시|계보|Long Range|Standard|영업용/.test(label))
  .filter((label) => !SAFE_SUB_MODEL_MAP[label]))]
  .sort();

const report = {
  report_type: 'hyundai_canonical_hierarchy_audit',
  hierarchy: ['제조사', '모델', '세부모델', '파워트레인', '세부트림'],
  source_record_count: hyundai.length,
  proposed_record_count: proposals.length,
  proposed_label_count: new Set(proposals.map((row) => row.before_sub_model)).size,
  unresolved_label_count: unresolvedLabels.length,
  unresolved_labels: unresolvedLabels,
  proposals,
};

mkdirSync('tmp', { recursive: true });
writeFileSync(
  'tmp/hyundai-canonical-hierarchy-audit.json',
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify({
  source_record_count: report.source_record_count,
  proposed_record_count: report.proposed_record_count,
  proposed_label_count: report.proposed_label_count,
  unresolved_label_count: report.unresolved_label_count,
  unresolved_labels: report.unresolved_labels,
}, null, 2));
