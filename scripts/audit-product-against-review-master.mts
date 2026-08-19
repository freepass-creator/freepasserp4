/** Read-only audit: compare all live product rows against the normalized review master. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { productReviewHierarchyEvidenceOverride } from '../lib/domain/product-review-hierarchy-evidence';
import {
  buildProductVehiclePartialResolution,
  canonicalProductVehicleDrive,
  type ProductVehiclePartialAxis,
  type ProductVehiclePartialCandidate,
} from '../lib/domain/product-vehicle-partial-resolution';
import { explicitMasterTrimSignals } from '../lib/domain/vehicle-trim-evidence';
import { hasBoundedVehiclePhrase, vehicleEvidenceTokens } from '../lib/domain/vehicle-master-format';

type Rec = Record<string, any>;
const S = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) => S(value).toLowerCase()
  .replace(/n\s*라인/g, 'nline')
  .replace(/premium/g, '프리미엄')
  .replace(/비지니스/g, '비즈니스')
  .replace(/black/g, '블랙')
  .replace(/[\s()[\]{}._/\\-]/g, '');
const tokenSignature = (value: unknown) => (S(value).toLowerCase().replace(/디\s*엣지/g, '디엣지').match(/[가-힣a-z]+|\d+/g) || [])
  .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
  .join('|');
const sameLabel = (left: unknown, right: unknown) => norm(left) === norm(right)
  || (Boolean(S(left)) && tokenSignature(left) === tokenSignature(right));
const PRODUCT_SUBMODEL_ALIAS: Record<string, string> = {
  '기아|셀토스|더 2026 셀토스 SP3': '디 올 뉴 셀토스 SP3',
  '기아|모닝|모닝 JA': '더 뉴 모닝 JA',
};
const PRODUCT_TRIM_ALIAS: Record<string, string> = {
  '현대|쏘나타|비즈니스': '비즈니스 1',
  '르노코리아|아르카나|아르카나 1.6 GTe Iconic': '아이코닉',
  '벤츠|E-클래스|아방가르드': 'E200 아방가르드',
  '제네시스|GV80|기본형': '기본 사양',
};
const canonicalFuel = (value: unknown) => {
  const text = S(value).toUpperCase();
  if (/전기|\bEV\b/.test(text) && !/HEV|PHEV/.test(text)) return '전기';
  if (/PHEV|플러그인/.test(text)) return 'PHEV';
  if (/HEV|하이브리드/.test(text)) return '하이브리드';
  if (/LPG|LPI|LPE/.test(text)) return 'LPG';
  if (/디젤|경유/.test(text)) return '디젤';
  if (/가솔린|휘발유/.test(text)) return '가솔린';
  if (/수소|FCEV/.test(text)) return '수소';
  return S(value);
};
const canonicalDrive = canonicalProductVehicleDrive;
const driveMatches = (source: string, master: string) => source === master
  || (source === '2WD' && ['2WD', 'FWD', 'RWD'].includes(master));
const inProductionPeriod = (month: string, start: string, end: string) => {
  if (!month) return true;
  if (start && month < start.slice(0, 7)) return false;
  if (end && end !== '현재' && month > end.slice(0, 7)) return false;
  return true;
};
const productionStartedBy = (month: string, start: string) => !month || !start || month >= start.slice(0, 7);
const monthIndex = (month: string) => {
  const match = month.slice(0, 7).match(/^(\d{4})-(\d{2})$/);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
};
const plausibleAtFirstRegistration = (month: string, start: string, end: string, endGraceMonths = 12) => {
  if (!productionStartedBy(month, start)) return false;
  if (!month || !end || end === '현재') return true;
  const registration = monthIndex(month);
  const productionEnd = monthIndex(end);
  return registration === null || productionEnd === null || registration <= productionEnd + endGraceMonths;
};
const ccMatches = (source: number, master: number) => !source || !master
  || Math.abs(source - master) <= 50
  || (source % 100 === 0 && Math.round(master / 100) * 100 === source);

const reviewRaw = readFileSync('tmp/hyundai-three-model-review.json', 'utf8');
const reviewArtifactSha256 = createHash('sha256').update(reviewRaw).digest('hex');
const review = JSON.parse(reviewRaw) as { headers: string[]; rows: unknown[][] };
const coverage = JSON.parse(readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8')) as { report_type?: string; source: Rec; master?: Rec; rows: Rec[] };
if (S(coverage.report_type) !== 'product_master_vehicle_coverage_v2_supplier_direct_evidence'
  || S(coverage.source?.evidence_scope) !== 'supplier_direct_prefix_only') {
  throw new Error('supplier-direct coverage v2 보고서가 아니므로 계층 감사를 중단합니다.');
}
const trimArtifactRaw = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const trimArtifactSha256 = createHash('sha256').update(trimArtifactRaw).digest('hex');
if (S(coverage.master?.artifact_sha256) !== trimArtifactSha256) {
  throw new Error('coverage와 영구키 artifact hash 불일치 — 부분특정 감사 중단');
}
const trimArtifact = JSON.parse(trimArtifactRaw) as { records: Rec[] };
const aliasBook = JSON.parse(readFileSync('public/data/master-aliases.json', 'utf8')) as { rules?: Rec[] };
const scopedTrimAlias = (maker: string, model: string, subModel: string, sourceTrim: string) => {
  const matches = (aliasBook.rules || []).filter((rule) => S(rule.kind) === 'trim'
    && S(rule.maker) === maker
    && S(rule.model) === model
    && sameLabel(rule.sub_model, subModel)
    && norm(rule.from) === norm(sourceTrim));
  return matches.length === 1 ? S(matches[0].to) : sourceTrim;
};
const column = Object.fromEntries(review.headers.map((header, index) => [header, index])) as Record<string, number>;
for (const required of ['제조사', '모델', '세부모델', '세부트림', '연료', '배기량cc', '구동', '인승', '생산시작', '생산종료']) {
  if (!Number.isInteger(column[required])) throw new Error(`Review header missing: ${required}`);
}

const details = coverage.rows.map((product) => {
  let maker = S(product.snap_maker || product.source_code_clue?.maker);
  let model = S(product.snap_model || product.source_code_clue?.model);
  const supplierName = S(product.supplier_vehicle_name);
  if ((!maker || !model) && /\bA6\s*C9\b/i.test(supplierName)) { maker = '아우디'; model = 'A6'; }
  const rawSubModel = S(product.snap_sub_model || product.source_clues?.sub_model)
    || (maker === '아우디' && model === 'A6' && /\bA6\s*C9\b/i.test(supplierName) ? 'A6 C9' : '');
  const subModel = PRODUCT_SUBMODEL_ALIAS[`${maker}|${model}|${rawSubModel}`] || rawSubModel;
  const directTrim = S(product.source_clues?.trim || product.audit_axes?.trim);
  const rawTrim = directTrim || S(product.audit_axes?.trim_evidence);
  let trim = PRODUCT_TRIM_ALIAS[`${maker}|${model}|${rawTrim}`] || rawTrim;
  if (maker === 'BMW' && model === '1시리즈' && /120i.*스포츠/i.test(supplierName)) trim = '120i Sport';
  if (maker === 'BMW' && model === 'X1' && /20i.*xdrive.*x라인/i.test(supplierName)) trim = '20i xLine';
  if (maker === '벤츠' && model === 'C-클래스' && /C\s*220\s*d.*avantgarde/i.test(supplierName)) trim = 'C220d 아방가르드';
  if (maker === '아우디' && model === 'A6' && /45\s*TFSI\s*S\s*line/i.test(supplierName)) trim = '45 TFSI S line';
  const fuel = canonicalFuel(product.audit_axes?.fuel || product.source_clues?.powertrain);
  const cc = Number(product.audit_axes?.engine_cc || 0);
  const drive = canonicalDrive(product.audit_axes?.drive || product.source_clues?.powertrain);
  const seatsText = `${S(product.source_clues?.sub_model)} ${S(product.source_clues?.powertrain)} ${S(product.supplier_vehicle_name)}`;
  const seats = Number(seatsText.match(/(\d{1,2})\s*인승/)?.[1] || 0);
  const registrationMonth = S(product.audit_axes?.registration_month);
  const statedYear = Number(product.audit_axes?.stated_year || product.audit_axes?.year || 0);
  const yearEvidenceType = product.audit_axes?.stated_year ? '명시연식'
    : product.audit_axes?.registration_month ? '등록연도' : statedYear ? '추출연식' : '';
  const modelRows = review.rows.filter((row) => S(row[column['제조사']]) === maker && S(row[column['모델']]) === model);
  let hierarchySubModel = subModel;
  let hierarchyTrim = trim;
  const evidenceOverride = productReviewHierarchyEvidenceOverride({
    maker, model, subModel, rawTrim: directTrim, supplierName, fuel, engineCc: cc, drive, registrationMonth,
  });
  let hierarchyEvidenceResolution: Rec | null = null;
  if (evidenceOverride) {
    const validatedRows = modelRows.filter((row) => {
      const aliases = [S(row[column['세부모델']]), ...S(row[column['기존 세부모델']]).split('|')];
      return aliases.some((alias) => sameLabel(alias, evidenceOverride.targetSubModel))
        && norm(row[column['세부트림']]) === norm(evidenceOverride.targetTrim)
        && (!fuel || canonicalFuel(row[column['연료']]) === fuel)
        && (evidenceOverride.ignoredSourceAxes?.includes('engine_cc')
          || !cc || ccMatches(cc, Number(row[column['배기량cc']] || 0)))
        && (evidenceOverride.ignoredSourceAxes?.includes('drive')
          || !drive || driveMatches(drive, canonicalDrive(row[column['구동']])))
        && (!seats || Number(row[column['인승']] || 0) === seats)
        && inProductionPeriod(registrationMonth, S(row[column['생산시작']]), S(row[column['생산종료']]));
    });
    const semantic = new Map<string, unknown[]>();
    for (const row of validatedRows) {
      const signature = ['세부모델', '세부트림', '연료', '배기량cc', '구동', '인승']
        .map((key) => norm(row[column[key]]))
        .join('|');
      if (!semantic.has(signature)) semantic.set(signature, row);
    }
    if (semantic.size === 1) {
      hierarchySubModel = evidenceOverride.targetSubModel;
      hierarchyTrim = evidenceOverride.targetTrim;
      hierarchyEvidenceResolution = {
        rule_id: evidenceOverride.ruleId,
        source_phrase: evidenceOverride.sourcePhrase,
        target_sub_model: hierarchySubModel,
        target_trim: hierarchyTrim,
        candidate_count: semantic.size,
        scope: 'hierarchy_only',
      };
    }
  }
  if (!trim && modelRows.length) {
    const supplierBlob = norm(product.supplier_vehicle_name);
    const embeddedTrims = [...new Set(modelRows.map((row) => S(row[column['세부트림']])).filter((candidate) => {
      const normalized = norm(candidate);
      return normalized.length >= 4 && supplierBlob.includes(normalized);
    }))].sort((left, right) => norm(right).length - norm(left).length);
    if (embeddedTrims.length && (embeddedTrims.length === 1 || norm(embeddedTrims[0]).length > norm(embeddedTrims[1]).length)) {
      trim = embeddedTrims[0];
    }
  }
  if (!hierarchyEvidenceResolution) hierarchyTrim = trim;
  const yearRows = statedYear ? modelRows.filter((row) => {
    const from = Number(row[column['연식시작']] || 0);
    const toRaw = S(row[column['연식종료']]);
    const to = toRaw === '현재' ? 9999 : Number(toRaw || 0);
    return from > 0 && from <= statedYear && to >= statedYear;
  }) : [];
  const yearSubModels = [...new Set(yearRows.map((row) => S(row[column['세부모델']])).filter(Boolean))];
  const inferredSubModel = yearSubModels.length === 1 ? yearSubModels[0] : '';
  let inferredHierarchyRows = inferredSubModel ? yearRows.filter((row) => S(row[column['세부모델']]) === inferredSubModel) : [];
  if (hierarchyTrim) inferredHierarchyRows = inferredHierarchyRows.filter((row) => norm(row[column['세부트림']]) === norm(hierarchyTrim));
  const inferredHierarchySemantic = new Map<string, unknown[]>();
  for (const row of inferredHierarchyRows) {
    const signature = ['세부모델', '세부트림'].map((key) => norm(row[column[key]])).join('|');
    if (!inferredHierarchySemantic.has(signature)) inferredHierarchySemantic.set(signature, row);
  }
  let hierarchyCandidates = modelRows;
  if (hierarchySubModel) hierarchyCandidates = hierarchyCandidates.filter((row) => {
    const aliases = [S(row[column['세부모델']]), ...S(row[column['기존 세부모델']]).split('|')];
    return aliases.some((alias) => sameLabel(alias, hierarchySubModel));
  });
  const hierarchyLineageRows = hierarchyCandidates;
  if (hierarchyTrim) hierarchyCandidates = hierarchyCandidates.filter((row) => norm(row[column['세부트림']]) === norm(hierarchyTrim));
  const hierarchySemantic = new Map<string, unknown[]>();
  for (const row of hierarchyCandidates) {
    const signature = ['세부모델', '세부트림'].map((key) => norm(row[column[key]])).join('|');
    if (!hierarchySemantic.has(signature)) hierarchySemantic.set(signature, row);
  }
  let hierarchyDefault = null as unknown[] | null;
  if (!hierarchyTrim) {
    const defaults = new Map<string, unknown[]>();
    for (const row of hierarchyLineageRows.filter((item) => S(item[column['기존 트림행키']]).split('|').some((key) => /::t01$/.test(key)))) {
      const signature = norm(row[column['세부트림']]);
      if (!defaults.has(signature)) defaults.set(signature, row);
    }
    if (defaults.size === 1) hierarchyDefault = [...defaults.values()][0];
  }
  const currentCode = S(product.current_code);
  const linkedRows = currentCode && !product.current_axis_conflict
    ? modelRows.filter((row) => S(row[column['기존 트림행키']]).split('|').includes(currentCode))
    : [];
  const linkedSemantic = new Map<string, unknown[]>();
  for (const row of linkedRows) {
    const signature = ['세부모델', '세부트림'].map((key) => norm(row[column[key]])).join('|');
    if (!linkedSemantic.has(signature)) linkedSemantic.set(signature, row);
  }
  const linkedCandidate = linkedSemantic.size === 1 ? [...linkedSemantic.values()][0] : null;
  let hierarchyCategory = !maker || !model ? '식별축 부족'
    : hierarchySemantic.size === 1 ? '계층 단일매칭'
      : !hierarchyTrim && hierarchyDefault ? '계층 기본트림 보완'
        : linkedCandidate ? '기존 확정코드 교차연결'
        : hierarchySemantic.size > 1 ? '계층 다중매칭'
          : '계층 무매칭';
  let candidates = modelRows;
  const filters: string[] = [];
  const stageCounts: Record<string, number> = { '제조사·모델': candidates.length };
  let firstZeroStage = candidates.length ? '' : '제조사·모델';
  const refine = (label: string, predicate: (row: unknown[]) => boolean) => {
    const before = candidates.length;
    candidates = candidates.filter(predicate);
    stageCounts[label] = candidates.length;
    if (before && !candidates.length && !firstZeroStage) firstZeroStage = label;
  };
  if (subModel) {
    filters.push('세부모델');
    refine('세부모델', (row) => {
      const aliases = [S(row[column['세부모델']]), ...S(row[column['기존 세부모델']]).split('|')];
      return aliases.some((alias) => sameLabel(alias, subModel));
    });
  }
  const lineageRows = candidates;
  if (trim) { filters.push('세부트림'); refine('세부트림', (row) => norm(row[column['세부트림']]) === norm(trim)); }
  if (fuel) { filters.push('연료'); refine('연료', (row) => canonicalFuel(row[column['연료']]) === fuel); }
  if (cc) { filters.push('배기량'); refine('배기량', (row) => ccMatches(cc, Number(row[column['배기량cc']] || 0))); }
  if (drive) { filters.push('구동'); refine('구동', (row) => driveMatches(drive, canonicalDrive(row[column['구동']]))); }
  if (seats) { filters.push('인승'); refine('인승', (row) => Number(row[column['인승']] || 0) === seats); }
  const periodCompatibleCount = registrationMonth
    ? candidates.filter((row) => inProductionPeriod(registrationMonth, S(row[column['생산시작']]), S(row[column['생산종료']]))).length
    : candidates.length;
  let defaultRows = lineageRows.filter((row) => S(row[column['기존 트림행키']]).split('|').some((key) => /::t01$/.test(key)));
  if (fuel) defaultRows = defaultRows.filter((row) => canonicalFuel(row[column['연료']]) === fuel);
  if (cc) defaultRows = defaultRows.filter((row) => ccMatches(cc, Number(row[column['배기량cc']] || 0)));
  if (drive) defaultRows = defaultRows.filter((row) => driveMatches(drive, canonicalDrive(row[column['구동']])));
  if (seats) defaultRows = defaultRows.filter((row) => Number(row[column['인승']] || 0) === seats);
  const defaultSemantic = new Map<string, unknown[]>();
  for (const row of defaultRows) {
    const signature = ['세부트림', '연료', '배기량cc', '구동', '인승'].map((key) => norm(row[column[key]])).join('|');
    if (!defaultSemantic.has(signature)) defaultSemantic.set(signature, row);
  }
  const defaultCandidate = defaultSemantic.size === 1 ? [...defaultSemantic.values()][0] : null;
  let yearDefaultRows = !hierarchyTrim && inferredSubModel
    ? yearRows.filter((row) => S(row[column['세부모델']]) === inferredSubModel
      && S(row[column['기존 트림행키']]).split('|').some((key) => /::t01$/.test(key)))
    : [];
  if (fuel) yearDefaultRows = yearDefaultRows.filter((row) => canonicalFuel(row[column['연료']]) === fuel);
  if (cc) yearDefaultRows = yearDefaultRows.filter((row) => ccMatches(cc, Number(row[column['배기량cc']] || 0)));
  if (drive) yearDefaultRows = yearDefaultRows.filter((row) => driveMatches(drive, canonicalDrive(row[column['구동']])));
  if (seats) yearDefaultRows = yearDefaultRows.filter((row) => Number(row[column['인승']] || 0) === seats);
  const yearDefaultSemantic = new Map<string, unknown[]>();
  for (const row of yearDefaultRows) {
    const signature = ['세부모델', '세부트림'].map((key) => norm(row[column[key]])).join('|');
    if (!yearDefaultSemantic.has(signature)) yearDefaultSemantic.set(signature, row);
  }
  const yearDefaultCandidate = yearDefaultSemantic.size === 1 ? [...yearDefaultSemantic.values()][0] : null;
  let periodDefaultRows = !hierarchyTrim && registrationMonth
    ? lineageRows.filter((row) => S(row[column['기존 트림행키']]).split('|').some((key) => /::t01$/.test(key))
      && inProductionPeriod(registrationMonth, S(row[column['생산시작']]), S(row[column['생산종료']])))
    : [];
  if (fuel) periodDefaultRows = periodDefaultRows.filter((row) => canonicalFuel(row[column['연료']]) === fuel);
  if (cc) periodDefaultRows = periodDefaultRows.filter((row) => ccMatches(cc, Number(row[column['배기량cc']] || 0)));
  if (drive) periodDefaultRows = periodDefaultRows.filter((row) => driveMatches(drive, canonicalDrive(row[column['구동']])));
  if (seats) periodDefaultRows = periodDefaultRows.filter((row) => Number(row[column['인승']] || 0) === seats);
  const periodDefaultSemantic = new Map<string, unknown[]>();
  for (const row of periodDefaultRows) {
    const signature = ['세부모델', '세부트림'].map((key) => norm(row[column[key]])).join('|');
    if (!periodDefaultSemantic.has(signature)) periodDefaultSemantic.set(signature, row);
  }
  const periodDefaultCandidate = periodDefaultSemantic.size === 1 ? [...periodDefaultSemantic.values()][0] : null;
  if (!hierarchyTrim && defaultCandidate && ['계층 다중매칭', '계층 무매칭'].includes(hierarchyCategory)) {
    hierarchyCategory = '계층 기본트림 보완';
  }
  if (['계층 다중매칭', '계층 무매칭'].includes(hierarchyCategory) && inferredHierarchySemantic.size === 1) {
    hierarchyCategory = yearEvidenceType === '등록연도' ? '등록연도 세부모델 추정매칭' : '연식 세부모델 추정매칭';
  }
  if (['계층 다중매칭', '계층 무매칭'].includes(hierarchyCategory) && yearDefaultCandidate) {
    hierarchyCategory = yearEvidenceType === '등록연도' ? '등록연도 기본트림 추정매칭' : '연식 기본트림 추정매칭';
  }
  if (hierarchyCategory === '계층 다중매칭' && periodDefaultCandidate) {
    hierarchyCategory = '등록연월 기본트림 추정매칭';
  }
  const historicalGap = /스파크 M300|뉴모닝 SA|카니발 R VQ|E-클래스 W123|C-클래스 W202\/W203|SM7|더 뉴 QM6 HZG|올 뉴 렉스턴 Y450/.test(`${model}|${subModel}`);
  const rawConflict = (model === '5시리즈' && /\bE34\b/i.test(rawTrim))
    || (model === 'A6' && /\bC9\b/i.test(subModel) && registrationMonth && registrationMonth < '2025-01')
    || (model === '아반떼' && /\bJ2\b/i.test(subModel) && /인스퍼레이션/.test(trim))
    || (model === '모델 3' && subModel === '모델 3' && /Premium/i.test(rawTrim) && registrationMonth >= '2024-01')
    || (model === 'C-클래스' && /W206/.test(subModel) && registrationMonth && registrationMonth < '2022-01')
    || (model === '쿠퍼' && /쿠퍼 C/.test(subModel) && cc >= 1900);
  let resolutionBucket = !['계층 다중매칭', '계층 무매칭', '식별축 부족'].includes(hierarchyCategory) ? ''
    : hierarchyCategory === '식별축 부족' ? '제조사·모델 원문누락'
      : hierarchyCategory === '계층 다중매칭' ? '기본트림 결정축 부족'
        : rawConflict ? '원문 세대·트림 충돌'
          : historicalGap ? '역사계보 신규근거 필요'
            : '별칭·공식근거 추가검토';

  // 세부트림이 갈리더라도 후보 전체에서 공통인 세부모델·기술축은 보존한다.
  // 생산 종료 직후 등록되는 재고차를 허용하되, 종료 12개월을 넘긴 과거 계보는
  // 현행 세부모델 공통축으로 섞지 않는다.
  const directDrive = canonicalDrive(supplierName);
  const attestedSubModelMatches = modelRows.flatMap((row) => {
    const canonical = S(row[column['세부모델']]);
    const aliases = [canonical, ...S(row[column['기존 세부모델']]).split('|')].filter(Boolean);
    const scores = aliases.filter((alias) => hasBoundedVehiclePhrase(supplierName, alias))
      .map((alias) => vehicleEvidenceTokens(alias).length);
    return canonical && scores.length ? [{ canonical, score: Math.max(...scores) }] : [];
  });
  const maxAttestedSubModelScore = Math.max(0, ...attestedSubModelMatches.map((item) => item.score));
  const attestedSubModels = [...new Set(attestedSubModelMatches
    .filter((item) => item.score === maxAttestedSubModelScore).map((item) => item.canonical))];
  const sourceSubModel = S(product.source_clues?.sub_model)
    || (attestedSubModels.length === 1 ? attestedSubModels[0] : '');
  // snap_sub_model은 점수기 파생값이며 공급사 직접축이 아니다. 부분특정의 hard filter에는
  // supplier-direct 세부모델 또는 검증된 hierarchy-only override만 사용한다.
  const partialSubModel = hierarchyEvidenceResolution ? hierarchySubModel : sourceSubModel;
  const directGradeFamily = maker === '벤츠' && model === 'E-클래스' && /\bE\s*250\b/i.test(supplierName) ? 'E250'
    : maker === '벤츠' && model === 'C-클래스' && /\bC\s*200\b/i.test(supplierName) ? 'C200' : '';
  const directMiniCooperC = maker === '미니' && model === '쿠퍼' && /쿠퍼\s*C\b/i.test(supplierName);
  const directFiveDoor = directMiniCooperC && /5\s*도어/i.test(supplierName);
  const reviewLineageRows = partialSubModel ? modelRows.filter((row) => {
    const aliases = [S(row[column['세부모델']]), ...S(row[column['기존 세부모델']]).split('|')];
    return aliases.some((alias) => sameLabel(alias, partialSubModel));
  }) : modelRows;
  let partialRows = modelRows;
  const partialAxisConflicts: ProductVehiclePartialAxis[] = [];
  const partialHardFailures: string[] = [];
  const narrowPartial = (axis: ProductVehiclePartialAxis | 'registration' | 'year' | 'body', predicate: (row: unknown[]) => boolean) => {
    if (!partialRows.length) return;
    const narrowed = partialRows.filter(predicate);
    if (narrowed.length) partialRows = narrowed;
    else if (axis === 'registration' || axis === 'year' || axis === 'body') {
      partialHardFailures.push(axis);
      partialRows = [];
    }
    else partialAxisConflicts.push(axis);
  };
  if (registrationMonth) narrowPartial('registration', (row) => plausibleAtFirstRegistration(
    registrationMonth, S(row[column['생산시작']]), S(row[column['생산종료']]),
  ));
  if (!registrationMonth && statedYear) narrowPartial('year', (row) => {
    const start = Number(row[column['연식시작']] || 0);
    return !start || start <= statedYear;
  });
  if (partialSubModel) narrowPartial('sub_model', (row) => {
    const aliases = [S(row[column['세부모델']]), ...S(row[column['기존 세부모델']]).split('|')];
    return aliases.some((alias) => sameLabel(alias, partialSubModel));
  });
  if (directGradeFamily) narrowPartial('trim', (row) => norm(row[column['세부트림']]).startsWith(norm(directGradeFamily)));
  if (directMiniCooperC) narrowPartial('sub_model', (row) => sameLabel(row[column['세부모델']], '쿠퍼 C F66/F65'));
  if (directFiveDoor) narrowPartial('body', (row) => /5\s*도어/.test(S(row[column['세부트림']])));
  if (fuel) narrowPartial('fuel', (row) => canonicalFuel(row[column['연료']]) === fuel);
  if (cc && fuel !== '전기') narrowPartial('engine_cc', (row) => ccMatches(cc, Number(row[column['배기량cc']] || 0)));
  if (directDrive) narrowPartial('drive', (row) => driveMatches(directDrive, canonicalDrive(row[column['구동']])));
  if (seats) narrowPartial('seats', (row) => Number(row[column['인승']] || 0) === seats);
  if (hierarchyTrim) narrowPartial('trim', (row) => norm(row[column['세부트림']]) === norm(hierarchyTrim));

  const candidateFromReview = (row: unknown[]): ProductVehiclePartialCandidate => ({
    subModel: S(row[column['세부모델']]),
    trim: S(row[column['세부트림']]),
    fuel: canonicalFuel(row[column['연료']]),
    engineCc: Number(row[column['배기량cc']] || 0) || null,
    drive: canonicalDrive(row[column['구동']]),
    seats: Number(row[column['인승']] || 0) || null,
  });
  const candidateFromArtifact = (record: Rec): ProductVehiclePartialCandidate => ({
    subModel: S(record.sub_model),
    trim: S(record.trim),
    fuel: canonicalFuel(record.fuel),
    engineCc: Number(record.engine_cc || 0) || null,
    drive: canonicalDrive(record.drivetrain),
    seats: Number(record.seats || 0) || null,
    trimRowKey: S(record.trim_row_key),
    usageTier: record.usage_tier,
  });
  const uniquePartialCandidates = (items: ProductVehiclePartialCandidate[]) => {
    const unique = new Map<string, ProductVehiclePartialCandidate>();
    for (const candidate of items) {
      const signature = [candidate.subModel, candidate.trim, candidate.fuel, candidate.engineCc,
        candidate.drive, candidate.seats, candidate.trimRowKey].map(norm).join('|');
      if (!unique.has(signature)) unique.set(signature, candidate);
    }
    return [...unique.values()];
  };
  let partialCandidates = uniquePartialCandidates(partialRows.map(candidateFromReview));

  let familyArtifactRecords = directGradeFamily || directMiniCooperC
    ? trimArtifact.records.filter((record) => S(record.maker) === maker && S(record.model) === model)
    : [];
  if (directGradeFamily) familyArtifactRecords = familyArtifactRecords.filter((record) => norm(record.trim).startsWith(norm(directGradeFamily)));
  if (directMiniCooperC) familyArtifactRecords = familyArtifactRecords.filter((record) => sameLabel(record.sub_model, '쿠퍼 C F66/F65'));
  if (directFiveDoor) familyArtifactRecords = familyArtifactRecords.filter((record) => /5\s*도어/.test(S(record.trim)));
  if (fuel) familyArtifactRecords = familyArtifactRecords.filter((record) => canonicalFuel(record.fuel) === fuel);
  if (cc && fuel !== '전기') familyArtifactRecords = familyArtifactRecords.filter((record) => ccMatches(cc, Number(record.engine_cc || 0)));
  if (directDrive) familyArtifactRecords = familyArtifactRecords.filter((record) => driveMatches(directDrive, canonicalDrive(record.drivetrain)));
  if (seats) familyArtifactRecords = familyArtifactRecords.filter((record) => Number(record.seats || 0) === seats);
  if (registrationMonth) familyArtifactRecords = familyArtifactRecords.filter((record) => productionStartedBy(
    registrationMonth, S(record.production_start),
  ));
  const familyCandidates = uniquePartialCandidates(familyArtifactRecords.map(candidateFromArtifact));

  const sourceTrim = scopedTrimAlias(maker, model, sourceSubModel || subModel, rawTrim);
  let blockedLineageRecords = trimArtifact.records.filter((record) => record.usage_tier === 'blocked'
    && S(record.maker) === maker && S(record.model) === model);
  if (sourceSubModel) blockedLineageRecords = blockedLineageRecords.filter((record) => sameLabel(record.sub_model, sourceSubModel));
  if (fuel) blockedLineageRecords = blockedLineageRecords.filter((record) => canonicalFuel(record.fuel) === fuel);
  if (cc && fuel !== '전기') blockedLineageRecords = blockedLineageRecords.filter((record) => ccMatches(cc, Number(record.engine_cc || 0)));
  if (directDrive) blockedLineageRecords = blockedLineageRecords.filter((record) => driveMatches(directDrive, canonicalDrive(record.drivetrain)));
  if (seats) blockedLineageRecords = blockedLineageRecords.filter((record) => Number(record.seats || 0) === seats);
  if (registrationMonth) blockedLineageRecords = blockedLineageRecords.filter((record) => productionStartedBy(
    registrationMonth, S(record.production_start),
  ));
  if (statedYear) blockedLineageRecords = blockedLineageRecords.filter((record) => {
    const start = Number(record.model_year_start || 0);
    const end = S(record.model_year_end) === '현재' ? 9999 : Number(record.model_year_end || 0);
    return (!start || start <= statedYear) && (!end || statedYear <= end);
  });
  const attestedBlockedTrims = explicitMasterTrimSignals(supplierName, blockedLineageRecords.map((record) => record.trim));
  const blockedTrimTargets = new Set([sourceTrim, ...attestedBlockedTrims].map(norm).filter(Boolean));
  const blockedExactRecords = blockedTrimTargets.size
    ? blockedLineageRecords.filter((record) => blockedTrimTargets.has(norm(record.trim)))
    : [];
  const blockedExactCandidates = blockedExactRecords.length === 1
    ? [candidateFromArtifact(blockedExactRecords[0])]
    : [];
  const blockedLineageCandidates = uniquePartialCandidates(blockedLineageRecords.map(candidateFromArtifact));
  let candidateBasis: 'master_consensus' | 'review_consensus' = 'review_consensus';
  let blockedCandidates: ProductVehiclePartialCandidate[] = blockedExactCandidates;
  if (!blockedCandidates.length && familyCandidates.length) {
    partialCandidates = familyCandidates;
    candidateBasis = 'master_consensus';
  } else if (!blockedCandidates.length && sourceSubModel && !reviewLineageRows.length && blockedLineageCandidates.length) {
    blockedCandidates = blockedLineageCandidates;
  }
  const partialConflict = (rawConflict && !hierarchyEvidenceResolution)
    || (maker === 'KG모빌리티' && model === '렉스턴' && /올\s*뉴\s*렉스턴/i.test(supplierName));
  const partialHierarchyConflict = partialConflict || partialHardFailures.length > 0
    || (partialAxisConflicts.length > 0 && !hierarchyEvidenceResolution);
  const effectivePartialConflictAxes = partialHierarchyConflict && !blockedCandidates.length && !familyCandidates.length
    ? partialAxisConflicts : [];
  if (partialHierarchyConflict) {
    if ((partialHardFailures.length || partialConflict) && !blockedCandidates.length && !familyCandidates.length) partialCandidates = [];
    hierarchyCategory = '계층 무매칭';
    resolutionBucket = partialAxisConflicts.length ? `원문 식별축 충돌:${[...new Set(partialAxisConflicts)].join(',')}`
      : partialHardFailures.length ? `기간·차체축 충돌:${[...new Set(partialHardFailures)].join(',')}`
        : '원문 세대·트림 충돌';
  }
  if (partialCandidates.length > 20 && !fuel && !cc && !directDrive && !seats && !registrationMonth
    && !directGradeFamily && !directMiniCooperC) partialCandidates = [];

  const partialResolution = buildProductVehiclePartialResolution({
    maker,
    model,
    subModel: sourceSubModel,
    trim: rawTrim,
    fuel,
    engineCc: fuel === '전기' ? null : cc || null,
    drive: directDrive,
    seats: seats || null,
  }, partialCandidates, {
    blockedCandidates,
    candidateBasis,
    conflictAxes: partialCandidates.length || blockedCandidates.length ? effectivePartialConflictAxes : [],
  });
  const category = !maker || !model ? '식별축 부족'
    : candidates.length === 1 ? '단일 매칭'
      : candidates.length > 1 ? '다중 매칭'
        : '무매칭';
  const finalCategory = category === '단일 매칭' ? '단일 직접매칭'
    : defaultCandidate && !trim ? '기본트림 안전보완후보'
      : defaultCandidate ? '명시트림 불일치·기본트림 대체검토'
      : category;
  return {
    row: product.row,
    category,
    final_category: finalCategory,
    hierarchy_category: hierarchyCategory,
    stated_year: statedYear || null,
    year_evidence_type: yearEvidenceType || null,
    inferred_sub_model: inferredSubModel || null,
    year_submodel_candidate_count: yearSubModels.length,
    resolution_bucket: resolutionBucket,
    hierarchy_candidate_count: hierarchySemantic.size,
    hierarchy_evidence_resolution: hierarchyEvidenceResolution,
    partial_axis_conflicts: [...new Set(partialAxisConflicts)],
    partial_hard_failures: [...new Set(partialHardFailures)],
    partial_source_conflict: partialHierarchyConflict,
    partial_resolution: partialResolution,
    hierarchy_candidate: partialHierarchyConflict ? null : hierarchySemantic.size === 1 ? (() => {
      const row = [...hierarchySemantic.values()][0];
      return { sub_model: S(row[column['세부모델']]), trim: S(row[column['세부트림']]) };
    })() : inferredHierarchySemantic.size === 1 ? (() => {
      const row = [...inferredHierarchySemantic.values()][0];
      return { sub_model: S(row[column['세부모델']]), trim: S(row[column['세부트림']]) };
    })() : yearDefaultCandidate ? { sub_model: S(yearDefaultCandidate[column['세부모델']]), trim: S(yearDefaultCandidate[column['세부트림']]) }
      : periodDefaultCandidate ? { sub_model: S(periodDefaultCandidate[column['세부모델']]), trim: S(periodDefaultCandidate[column['세부트림']]) }
      : hierarchyDefault ? { sub_model: S(hierarchyDefault[column['세부모델']]), trim: S(hierarchyDefault[column['세부트림']]) }
      : linkedCandidate ? { sub_model: S(linkedCandidate[column['세부모델']]), trim: S(linkedCandidate[column['세부트림']]) } : null,
    maker,
    model,
    source_axes: { sub_model: subModel, trim, fuel, engine_cc: cc || null, drive, seats: seats || null, registration_month: registrationMonth },
    hierarchy_axes: { sub_model: hierarchySubModel, trim: hierarchyTrim },
    filters,
    stage_counts: stageCounts,
    first_zero_stage: firstZeroStage,
    model_candidate_count: modelRows.length,
    candidate_count: candidates.length,
    period_status: !registrationMonth || periodCompatibleCount === candidates.length ? '적합'
      : periodCompatibleCount ? '후보일부적합' : '기간추가확인',
    period_compatible_count: periodCompatibleCount,
    default_candidate_count: defaultSemantic.size,
    default_candidate: defaultCandidate ? {
      trim: S(defaultCandidate[column['세부트림']]), fuel: S(defaultCandidate[column['연료']]),
      engine_cc: defaultCandidate[column['배기량cc']], drive: S(defaultCandidate[column['구동']]),
      seats: defaultCandidate[column['인승']], source_keys: S(defaultCandidate[column['기존 트림행키']]),
    } : null,
    candidates: candidates.slice(0, 20).map((row) => ({
      sub_model: S(row[column['세부모델']]), trim: S(row[column['세부트림']]), fuel: S(row[column['연료']]),
      engine_cc: row[column['배기량cc']], drive: S(row[column['구동']]), seats: row[column['인승']],
      production_start: S(row[column['생산시작']]), production_end: S(row[column['생산종료']]),
      source_keys: S(row[column['기존 트림행키']]),
    })),
  };
});

const counts = Object.fromEntries(['단일 매칭', '다중 매칭', '무매칭', '식별축 부족'].map((category) => [category, details.filter((row) => row.category === category).length]));
const finalCounts = Object.fromEntries(['단일 직접매칭', '기본트림 안전보완후보', '명시트림 불일치·기본트림 대체검토', '다중 매칭', '무매칭', '식별축 부족'].map((category) => [category, details.filter((row) => row.final_category === category).length]));
const hierarchyCounts = Object.fromEntries(['계층 단일매칭', '계층 기본트림 보완', '연식 세부모델 추정매칭', '등록연도 세부모델 추정매칭', '연식 기본트림 추정매칭', '등록연도 기본트림 추정매칭', '등록연월 기본트림 추정매칭', '기존 확정코드 교차연결', '계층 다중매칭', '계층 무매칭', '식별축 부족'].map((category) => [category, details.filter((row) => row.hierarchy_category === category).length]));
const resolutionCounts = Object.fromEntries([...new Set(details.map((row) => row.resolution_bucket).filter(Boolean))].map((bucket) => [bucket, details.filter((row) => row.resolution_bucket === bucket).length]));
const report = {
  report_type: 'product_against_normalized_review_master_v2_supplier_direct_evidence',
  generated_at: new Date().toISOString(),
  source: coverage.source,
  review: {
    rows: review.rows.length,
    headers: review.headers,
    fingerprint_basis: 'tmp/hyundai-three-model-review.json',
    artifact_sha256: reviewArtifactSha256,
  },
  counts,
  final_counts: finalCounts,
  hierarchy_counts: hierarchyCounts,
  resolution_counts: resolutionCounts,
  gates: {
    total_matches_source: details.length === Number(coverage.source?.rows || 0),
    review_unknown_class: review.rows.filter((row) => S(row[column['차종분류']]) === '미확인').length,
    production_sort_violations: review.rows.slice(1).filter((row, index) => {
      const prior = review.rows[index];
      if (['제조국', '제조사', '모델'].some((key) => S(prior[column[key]]) !== S(row[column[key]]))) return false;
      const left = S(prior[column['생산시작']]); const right = S(row[column['생산시작']]);
      return (!left && Boolean(right)) || (Boolean(left) && Boolean(right) && left < right);
    }).length,
    invalid_year_inference: details.filter((row) => ['연식 세부모델 추정매칭', '등록연도 세부모델 추정매칭'].includes(row.hierarchy_category)
      && (row.year_submodel_candidate_count !== 1 || !row.inferred_sub_model || !row.hierarchy_candidate)).length,
    invalid_registration_default_inference: details.filter((row) => ['등록연도 기본트림 추정매칭', '등록연월 기본트림 추정매칭'].includes(row.hierarchy_category)
      && (row.source_axes.trim || !row.source_axes.registration_month || !row.hierarchy_candidate)).length,
    invalid_hierarchy_evidence_resolution: details.filter((row) => row.hierarchy_evidence_resolution
      && (row.hierarchy_evidence_resolution.scope !== 'hierarchy_only'
        || row.hierarchy_evidence_resolution.candidate_count !== 1
        || row.hierarchy_candidate_count !== 1)).length,
    invalid_partial_resolution: details.filter((row) => !S(row.partial_resolution?.display)
      || !S(row.partial_resolution?.statusLabel)
      || !Number.isInteger(row.partial_resolution?.candidateCount)
      || row.partial_resolution.candidateCount < 0
      || (row.partial_resolution.statusLabel === '계층 단일 특정'
        && (row.partial_resolution.unresolvedAxes?.length
          || /미확정|\(입력\)/.test(S(row.partial_resolution.display))))).length,
    invalid_partial_source_conflict: details.filter((row) => {
      if (!row.partial_source_conflict) return false;
      const conflicts = row.partial_resolution?.conflictAxes || [];
      if (!['계층 다중매칭', '계층 무매칭', '식별축 부족'].includes(S(row.hierarchy_category))
        || row.hierarchy_candidate) return true;
      const propertyByAxis: Record<string, string> = {
        sub_model: 'subModel', trim: 'trim', fuel: 'fuel', engine_cc: 'engineCc', drive: 'drive', seats: 'seats',
      };
      return conflicts.some((axis: string) => Boolean(row.partial_resolution?.confirmed?.[propertyByAxis[axis]]));
    }).length,
    invalid_blocked_partial_reference: details.filter((row) => (
      row.partial_resolution?.basis === 'blocked_master_exact'
        ? !S(row.partial_resolution.trimRowKey) || S(row.partial_resolution.usageTier) !== 'blocked'
        : Boolean(S(row.partial_resolution?.trimRowKey))
    )).length,
  },
  details,
};
writeFileSync('tmp/product-against-review-master.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ hierarchy_counts: hierarchyCounts, resolution_counts: resolutionCounts, counts, final_counts: finalCounts, gates: report.gates, detail_path: 'tmp/product-against-review-master.json' }, null, 2));
