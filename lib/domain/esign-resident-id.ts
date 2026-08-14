const S = (value: unknown) => String(value ?? '').trim();

export type ResidentIdInfo = {
  digits: string;
  birthDate: string;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
};

function centuryForCode(code: string): number | null {
  if (code === '9' || code === '0') return 1800;
  if (['1', '2', '5', '6'].includes(code)) return 1900;
  if (['3', '4', '7', '8'].includes(code)) return 2000;
  return null;
}

/** 주민등록번호에서 유효한 생년월일만 파생한다. 원문이나 뒷자리는 반환하지 않는다. */
export function residentIdInfo(value: unknown): ResidentIdInfo | null {
  const digits = S(value).replace(/\D/g, '');
  if (digits.length !== 13) return null;
  const century = centuryForCode(digits[6]);
  if (century == null) return null;
  const birthYear = century + Number(digits.slice(0, 2));
  const birthMonth = Number(digits.slice(2, 4));
  const birthDay = Number(digits.slice(4, 6));
  if (birthMonth < 1 || birthMonth > 12 || birthDay < 1) return null;
  const lastDay = new Date(Date.UTC(birthYear, birthMonth, 0)).getUTCDate();
  if (birthDay > lastDay) return null;
  return {
    digits,
    birthDate: `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`,
    birthYear,
    birthMonth,
    birthDay,
  };
}

function referenceDateParts(value?: unknown) {
  const match = S(value).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** 기준일의 만 나이. 차량 인도일이 확정되지 않았으면 제출일을 기준으로 계산한다. */
export function residentAgeOn(value: unknown, referenceDate?: unknown): number | null {
  const info = residentIdInfo(value);
  if (!info) return null;
  const reference = referenceDateParts(referenceDate);
  let age = reference.year - info.birthYear;
  if (reference.month < info.birthMonth
    || (reference.month === info.birthMonth && reference.day < info.birthDay)) age -= 1;
  return age >= 0 ? age : null;
}

export function driverAgeRange(value: unknown): { min: number | null; max: number | null } {
  const ages = [...S(value).matchAll(/(\d{2,3})\s*세/g)].map((match) => Number(match[1]));
  const min = ages[0] ? Math.max(21, ages[0]) : 21;
  return {
    min,
    max: ages[1] && ages[1] >= min ? ages[1] : null,
  };
}
