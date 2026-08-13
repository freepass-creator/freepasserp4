/**
 * 민감값 가리기 — **한 곳에서만 가린다.**
 *
 * ★왜 이 파일이 필요한가
 *   `esign-display-fields` 는 칸마다 「어떻게 가릴지」(`MaskKind`)를 이미 정해 두었다.
 *   그런데 **그것을 실행하는 코드가 없었다**(실측 2026-08-12). 「빼먹으면 유출이다」라고
 *   주석에 써 두고 정작 가리는 함수가 없어, 값이 들어오는 순간 원본이 그대로 나가는 상태였다.
 *   지금까지 드러나지 않은 이유는 주민번호·면허번호를 «받지 않아» 칸이 비어 있었기 때문이다.
 *
 * ★가리는 자리와 안 가리는 자리
 *   원본이 필요한 곳은 **세금계산서 발행·보험 접수** 두 군데뿐이고, 그건 권한 있는 사람이
 *   ERP 안에서 조회한다. 계약서 PDF 는 카톡·메일로 돌아다니므로 **가린 값만 싣는다**
 *   (사장님 확정 2026-08-12).
 *
 * ★가려도 «형태»는 남긴다
 *   전부 지우면 손님이 자기 것이 맞는지 확인할 수 없다. 앞자리를 남겨 본인 확인은 되게 하고
 *   뒤를 가려 재사용을 막는다.
 */
import type { MaskKind } from '@/lib/domain/esign-display-fields';

const S = (v: unknown) => String(v ?? '').trim();

/**
 * 주민등록번호 — 앞 7자리까지 보이고 뒤 6자리를 가린다. `900101-1******`
 * 뒤 6자리에 지역·일련·검증번호가 들어 있어 그것만 가려도 재사용을 막는다.
 */
function maskRrn(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return value;                 // 형태를 모르면 손대지 않는다
  return `${digits.slice(0, 6)}-${digits.slice(6, 7)}${'*'.repeat(Math.max(0, digits.length - 7))}`;
}

/** 면허번호 — 지역·연도와 마지막 두 자리만. `11-02-******-54` */
function maskLicense(value: string): string {
  const parts = value.split('-');
  if (parts.length >= 4) {
    return [parts[0], parts[1], '*'.repeat(parts[2].length), parts[parts.length - 1]].join('-');
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return value;
  return `${digits.slice(0, 4)}-${'*'.repeat(digits.length - 6)}-${digits.slice(-2)}`;
}

/** 전화번호 — 가운데만. `010-****-5678` */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 9) return value;
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}-${'*'.repeat(digits.length - 7)}-${tail}`;
}

/**
 * 주소 — 시·군·구까지만. 그 뒤는 집을 특정하므로 자른다.
 * 「서울특별시 강남구 테헤란로 1」 → 「서울특별시 강남구 …」
 */
function maskAddress(value: string): string {
  const m = /^(\S+\s+\S*[시군구])/.exec(value);
  return m ? `${m[1]} …` : value.split(/\s+/).slice(0, 2).join(' ');
}

/** 계좌 — 뒷자리만 가린다. 앞을 남겨야 어느 계좌인지 알아본다. */
function maskAccount(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return value;
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

/** 정해 둔 방식대로 가린다. 값이 비면 그대로 비워 둔다 — 별표만 남기면 값이 있는 줄 안다. */
export function maskBy(kind: MaskKind | undefined, value: unknown): string {
  const raw = S(value);
  if (!raw || !kind || kind === 'none') return raw;
  switch (kind) {
    case 'rrn': return maskRrn(raw);
    case 'license': return maskLicense(raw);
    case 'phone': return maskPhone(raw);
    case 'address': return maskAddress(raw);
    case 'account': return maskAccount(raw);
    default: return raw;
  }
}

/**
 * 계약서에 실을 값 — **원본을 넣지 않는다.**
 * 계약서 PDF 는 카톡·메일로 돌아다닌다. 원본이 필요한 세금계산서·보험 접수는
 * 권한 있는 사람이 ERP 안에서 따로 조회한다.
 */
export const CONTRACT_MASKED_FIELDS: Record<string, MaskKind> = {
  customer_id: 'rrn',
  driver_or_biz_no: 'rrn',
  driver_license_no: 'license',
  drv1_rrn: 'rrn',
  drv2_rrn: 'rrn',
  drv3_rrn: 'rrn',
  drv1_license: 'license',
  drv2_license: 'license',
  drv3_license: 'license',
  guarantor_rrn: 'rrn',
  cms_holder_birth: 'rrn',
};

/** 계약서 필드 뭉치에 마스킹을 입힌다. 여기를 거치지 않은 값은 계약서에 실리면 안 된다. */
export function maskContractFields<T extends Record<string, unknown>>(fields: T): T {
  const out: Record<string, unknown> = { ...fields };
  for (const [key, kind] of Object.entries(CONTRACT_MASKED_FIELDS)) {
    if (S(out[key])) out[key] = maskBy(kind, out[key]);
  }
  return out as T;
}
