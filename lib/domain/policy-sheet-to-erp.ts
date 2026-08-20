/**
 * 공급사 시트 → ERP 원자 — «운영정책» 한 줄 → 정책 레코드 패치 · «회사정보» 탭 → 파트너 레코드 패치.
 *
 * ★원칙(사장님 2026-08-19 「erp에 정책 반영하는 곳도 반영 — 원자 확보」)
 *   · 시트 열 이름 → ERP 필드는 supplier-template-sheet.POLICY_COLUMN_FIELDS 한 곳(정본).
 *   · 값은 시트 규격 글자 그대로 담는다(정책관리 선택지 = 시트 드롭다운, entities.sheetOpts). 숫자 칸(나이·일·회·원)만 숫자로 굳힌다.
 *   · **빈칸은 안 낸다** — 공급사가 아직 안 적은 칸으로 ERP 값을 지우지 않는다.
 *   · ⑩ 제출서류 체크 6칸 + 필요서류 1~4 → esign_required_documents(JSON) 하나로 접는다. 하나도 없으면 안 낸다.
 *   · 규격에 안 맞는 값(normalize 가 review)은 패치에 넣지 않고 review 로 돌려준다 — 사람이 본다.
 */
import { ENTITIES } from '@/lib/intake/entities';
import { COMPANY_INFO_FIELDS } from './company-info-sheet';
import { serializeEsignRequiredDocuments, type EsignRequiredDocument } from './esign-required-documents';
import { POLICY_DISQUALIFICATION_COLUMNS, POLICY_DOCUMENT_CHECKS, POLICY_DOCUMENT_EXTRA_COLUMNS, POLICY_EXTRA_TERM_COLUMNS } from './policy-sheet-layout';
import { POLICY_FIELD_RENAMES, isCheckedValue, normalizePolicyValue } from './policy-value-spec';
import { parseMoneyOrRate } from './policy-money-rate';
import { POLICY_COLUMN_FIELDS } from './supplier-template-sheet';

const S = (v: unknown) => String(v ?? '').trim();

const POLICY_FIELD_TYPE: Record<string, string> = Object.fromEntries(
  (ENTITIES.policy?.fields || []).map((f) => [f.key, f.type]),
);

/** 시트 글자를 ERP 숫자 칸에 맞게 — 「만 26세 이상」→26 · 「7일」→7 · 「3회」→3 · 「200원」→200 · 「없음」→0 · 「제한없음」→null(안 낸다). */
export function sheetNumberFor(field: string, raw: string): number | null {
  const c = raw.replace(/\s|,/g, '');
  if (!c) return null;
  if (/^(제한없음|무제한|협의)$/.test(c)) return null;
  if (/^없음$/.test(c)) return 0;
  const m = c.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  if (/만원$/.test(c)) return Math.round(n * 10_000);   // 숫자 칸에 「10만원」이 오면 원으로
  return n;
}

export type SheetPolicyPatch = {
  patch: Record<string, unknown>;
  /** 규격 밖 값 — 사람이 볼 것. */
  review: { name: string; field: string; raw: string; note: string }[];
  /** 시트가 비어 ERP 값을 그대로 둔 항목 수. */
  blank: number;
};

/** 시트 한 정책 줄(항목→값, 별칭 포함) → ERP 정책 패치. */
export function sheetPolicyToErp(row: Map<string, string>): SheetPolicyPatch {
  const patch: Record<string, unknown> = {};
  const review: SheetPolicyPatch['review'] = [];
  let blank = 0;
  const get = (name: string) => S(row.get(name) ?? row.get(POLICY_FIELD_RENAMES[name] || name));

  for (const { name, field } of POLICY_COLUMN_FIELDS) {
    const raw = get(name);
    if (!raw) { blank++; continue; }
    const norm = normalizePolicyValue(name, raw);
    if (norm.status === 'review') { review.push({ name, field, raw, note: norm.note || '규격 밖' }); continue; }
    const value = norm.value || raw;
    if (POLICY_FIELD_TYPE[field] === 'number') {
      // 「제한없음 / 무제한 / 협의」는 숫자 칸에 담을 수 없다 — ERP 값을 그대로 둔다(빈칸 취급).
      if (/^(제한\s*없음|무제한|협의)$/.test(value)) { blank++; continue; }
      const n = sheetNumberFor(field, value);
      if (n === null) { review.push({ name, field, raw, note: '숫자 칸인데 숫자로 못 굳힘' }); continue; }
      patch[field] = n;
    } else {
      patch[field] = value;
    }
  }

  // 불가조건 1~4 → 하나(사장님 2026-08-19 「불가조건 1 2 3 4로」). 빈칸은 건너뛰고 「·」로 잇는다.
  const disq = POLICY_DISQUALIFICATION_COLUMNS.map((n) => get(n)).filter(Boolean);
  if (disq.length) patch.disqualification_conditions = disq.join(' · ');
  // 기타사항 1~4 → 하나. 계약서 특약 칸에 «한 줄에 하나»로 실리므로 줄바꿈으로 잇는다(사장님 2026-08-20).
  const extra = POLICY_EXTRA_TERM_COLUMNS.map((n) => get(n)).filter(Boolean);
  if (extra.length) patch.policy_extra_terms = extra.join('\n');

  // ⑩ 제출서류 — 체크 → esign_required_documents
  const docs: EsignRequiredDocument[] = POLICY_DOCUMENT_CHECKS
    .filter((d) => isCheckedValue(get(d.name)))
    .map((d) => ({ key: d.key, label: d.name, note: d.note, required: true }));
  // 필요서류 1~4 — 한 칸에 하나씩 직접 적은 것(사장님 2026-08-20). 한 칸에 「·」로 여럿을 적어도 갈라 읽는다.
  POLICY_DOCUMENT_EXTRA_COLUMNS.forEach((name, i) => {
    get(name).split(/[·,/\n]+/).map((x) => x.trim()).filter(Boolean).forEach((label, k) => {
      docs.push({ key: `extra_${i + 1}${k ? `_${k + 1}` : ''}`, label: label.slice(0, 40), note: '', required: true });
    });
  });
  if (docs.length) patch.esign_required_documents = serializeEsignRequiredDocuments(docs);

  return { patch, review, blank };
}

/** 「회사정보」 탭(A=항목 · B=값) → 파트너 패치. 빈칸은 안 낸다. */
export function companyInfoToPartner(rows: string[][]): { patch: Record<string, string>; blank: string[] } {
  const patch: Record<string, string> = {};
  const blank: string[] = [];
  const byLabel = new Map(rows.map((r) => [S(r[0]), S(r[1])] as const));
  for (const f of COMPANY_INFO_FIELDS) {
    let v = byLabel.get(f.label) || '';
    // 값 칸에 우리 안내 문구(「입력(여기에 적어 주세요)」)가 그대로면 빈칸
    if (/여기에 적어/.test(v)) v = '';
    if (!v) { blank.push(f.label); continue; }
    if (f.field === 'business_number' || f.field === 'corporate_registration_no') v = v.replace(/[^\d-]/g, '');
    patch[f.field] = v;
  }
  return { patch, blank };
}

/** 같은 뜻이면 같은 글자로 — 시트/ERP 값 대조용(원자 비교는 여기 하나로). */
export function foldPolicyValue(v: unknown): string {
  let t = S(v).replace(/\s+/g, '');
  if (!t) return '';
  if (/^차량가(액|기준)$/.test(t)) return '차량가액';
  if (/^(없음|해당없음|-|0|0원|0%)$/.test(t)) return '없음';
  if (/^(가능|가능함|o|O)$/.test(t)) return '가능';
  if (/^(불가|불가능|x|X)$/.test(t)) return '불가';
  // 「1인까지」/「1인」 · 「월 5만원」/「5만원」/「1인당 월 5만원」 — 단위 말은 접는다
  const persons = t.match(/^(\d+)인(까지)?$/);
  if (persons) return `인${Number(persons[1])}`;
  // 운전자 범위 — 「계약자 본인+직계가족」/「본인+직계가족」 · 「계약자 본인만」/「계약자 본인」
  t = t.replace(/^계약자(?=본인)/, '').replace(/^(본인[^만]*)만$/, '$1');
  const money = parseMoneyOrRate(t.replace(/^1인당/, '').replace(/^월(?=\d)/, ''), { legacy: 'won' });
  if (money.kind === 'won') return money.won === 0 ? '없음' : String(money.won);
  if (money.kind === 'none') return '없음';
  if (money.kind === 'rate') return String(money.rate);
  if (money.kind === 'months') return `개월${money.months}`;
  const num = t.replace(/[,원]/g, '');
  if (/^\d+$/.test(num)) return Number(num) >= 18 && Number(num) <= 99 && num.length === 2 ? `만${num}` : String(Number(num));
  if (/^0?\.\d+$/.test(t)) return `${Number(t)}`;
  const km = t.match(/(\d[\d,.]*)(만)?k?m/i);
  if (km) { const base = Number(km[1].replace(/,/g, '')); return `주행${km[2] ? base * 10000 : base}`; }
  const age = t.match(/^만?(\d{2})세/);
  if (age) return `만${age[1]}`;
  const days = t.match(/^(\d+)일$/);
  if (days) return String(Number(days[1]));
  const cnt = t.match(/^(?:연간?)?(\d+)회$/);
  if (cnt) return String(Number(cnt[1]));
  return t.toLowerCase();
}
