export type F03CanonicalRow = {
  maker: string;
  model: string;
  subModel: string;
  trim: string;
};

export type F03ProjectionInput = {
  maker?: string;
  sourceModel?: string;
  refinedModel?: string;
  refinedSubModel?: string;
  rawName?: string;
  rawFuel?: string;
};

export type F03Projection = F03CanonicalRow & {
  matched: boolean;
  reason: string;
};

const S = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

/**
 * FreePass 차종마스터 표기 규칙.
 *
 * 1) 괄호 문자는 제거하되 괄호 안 내용은 보존한다.
 *    G80 (RG3) -> G80 RG3
 * 2) 모델과 세부모델이 같은 축이면 세부모델은 `기본형`으로 둔다.
 *    GV70 / GV70 -> GV70 / 기본형
 *
 * 공급사 원문을 새 이름으로 추측하는 함수가 아니라, 이미 확인된 F03 행을
 * FreePass 표기로 투영하기 위한 규칙이다.
 */
export function stripF03Parentheses(value: unknown): string {
  return S(value).replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function f03Key(value: unknown): string {
  return stripF03Parentheses(value).toLowerCase().replace(/\s+/g, '');
}

export function normalizeF03CanonicalRow(row: F03CanonicalRow): F03CanonicalRow {
  const maker = stripF03Parentheses(row.maker);
  const model = stripF03Parentheses(row.model);
  let subModel = stripF03Parentheses(row.subModel);
  const trim = stripF03Parentheses(row.trim);
  if (model && subModel && f03Key(model) === f03Key(subModel)) subModel = '기본형';
  return { maker, model, subModel, trim };
}

const genericSubTokens = new Set(['기본형', '더뉴', '뉴', '올뉴', '디올뉴', '신형']);

function distinctiveTokens(model: string, subModel: string): string[] {
  const modelKey = f03Key(model);
  const raw = stripF03Parentheses(subModel)
    .replace(/더\s*뉴/gi, ' ')
    .replace(/디\s*올\s*뉴/gi, ' ')
    .replace(/올\s*뉴/gi, ' ')
    .replace(new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
    .trim();
  const tokens = raw.split(/\s+/).map(f03Key).filter((x) => x.length >= 2 && x !== modelKey && !genericSubTokens.has(x));
  return [...new Set(tokens)];
}

function isEvFuel(value: unknown) {
  return /전기|ev|electric/i.test(S(value));
}

/**
 * 공급사 행을 F03의 확인된 이름축에 붙인다.
 * 확실하지 않으면 matched=false 로 남겨 추측 확정을 하지 않는다.
 */
export function resolveF03Projection(rows: F03CanonicalRow[], input: F03ProjectionInput): F03Projection {
  const normalized = rows.map(normalizeF03CanonicalRow);
  const makerKey = f03Key(input.maker);
  const modelKey = f03Key(input.refinedModel || input.sourceModel);
  const rawKey = f03Key([input.sourceModel, input.rawName, input.refinedSubModel].filter(Boolean).join(' '));
  if (!modelKey) return { maker: '', model: '', subModel: '', trim: '', matched: false, reason: 'MODEL_MISSING' };

  let candidates = normalized.filter((r) => f03Key(r.model) === modelKey && (!makerKey || f03Key(r.maker) === makerKey));
  if (!candidates.length) candidates = normalized.filter((r) => f03Key(r.model) === modelKey);
  if (!candidates.length) return { maker: '', model: '', subModel: '', trim: '', matched: false, reason: 'MODEL_NOT_IN_F03' };

  const exactExisting = f03Key(input.refinedSubModel);
  if (exactExisting && exactExisting !== modelKey) {
    const exact = candidates.filter((r) => f03Key(r.subModel) === exactExisting);
    if (exact.length) candidates = exact;
  }

  const distinctSubs = [...new Map(candidates.map((r) => [f03Key(r.subModel), r.subModel])).values()];
  if (distinctSubs.length > 1) {
    const markerMatches = distinctSubs.filter((sub) => {
      if (f03Key(sub) === f03Key('기본형')) return false;
      const tokens = distinctiveTokens(candidates[0]?.model || '', sub);
      return tokens.length > 0 && tokens.every((t) => rawKey.includes(t));
    });
    if (markerMatches.length === 1) {
      candidates = candidates.filter((r) => f03Key(r.subModel) === f03Key(markerMatches[0]));
    } else {
      const evSubs = distinctSubs.filter((s) => /일렉트리파이드|electric/i.test(s));
      const defaultRows = candidates.filter((r) => f03Key(r.subModel) === f03Key('기본형'));
      if (isEvFuel(input.rawFuel) && evSubs.length === 1) {
        candidates = candidates.filter((r) => f03Key(r.subModel) === f03Key(evSubs[0]));
      } else if (!isEvFuel(input.rawFuel) && defaultRows.length && evSubs.length === distinctSubs.length - 1) {
        candidates = defaultRows;
      } else {
        return { maker: candidates[0]?.maker || '', model: candidates[0]?.model || '', subModel: '', trim: '', matched: false, reason: 'SUBMODEL_AMBIGUOUS' };
      }
    }
  }

  const subKey = f03Key(candidates[0]?.subModel);
  const sameSub = candidates.filter((r) => f03Key(r.subModel) === subKey);
  const trims = [...new Map(sameSub.map((r) => [f03Key(r.trim), r.trim])).values()].filter(Boolean);
  const trim = trims.length === 1 ? trims[0] : '';
  const first = sameSub[0];
  return {
    maker: first.maker,
    model: first.model,
    subModel: first.subModel,
    trim,
    matched: true,
    reason: trims.length <= 1 ? 'F03_EXACT_AXIS' : 'F03_SUBMODEL_ONLY',
  };
}

export type DriveEvidence = 'AWD' | 'RWD' | 'FWD' | '2WD' | '';

export function explicitDriveFromSource(value: unknown): DriveEvidence {
  const s = S(value).toUpperCase();
  if (/AWD|4WD|4MATIC|4MOTION|XDRIVE|QUATTRO|사륜/.test(s)) return 'AWD';
  if (/RWD|후륜/.test(s)) return 'RWD';
  if (/FWD|전륜/.test(s)) return 'FWD';
  if (/2WD/.test(s)) return '2WD';
  return '';
}

export function driveConflicts(source: DriveEvidence, refined: unknown): boolean {
  if (!source) return false;
  const current = explicitDriveFromSource(refined);
  if (!current) return false;
  if (source === current) return false;
  if (source === '2WD') return current === 'AWD';
  if (current === '2WD') return source === 'AWD';
  return true;
}
