export function validateSerializedVehicleMasterRow(row: unknown[]): string[] {
  const issues: string[] = [];
  // turbo는 과거 영구키에서 미기재(null)가 유효한 기술축이다. 이를 필수화해
  // null→false로 보정하면 같은 영구키의 의미가 변하므로 필수 열에서 제외한다.
  const required = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 23, 24, 27, 28, 29];
  if (required.some((column) => String(row[column] ?? '').trim() === '')) issues.push('필수 열 공란');
  const electric = String(row[19] ?? '').trim() === '전기';
  const technicalIndexes = electric ? [25] : [20, 21];
  if (technicalIndexes.some((column) => String(row[column] ?? '').trim() === '')) {
    issues.push(electric ? '전기차 배터리 용량 공란' : '내연기관 배기량 공란');
  }
  if (typeof row[11] !== 'number' || typeof row[12] !== 'number' || typeof row[24] !== 'number') issues.push('순번·인승 숫자 형식');
  if (electric) {
    if (typeof row[25] !== 'number' || !(row[25] > 0)) issues.push('배터리 용량 숫자 형식');
  } else if (typeof row[20] !== 'number' || typeof row[21] !== 'number') issues.push('배기량 숫자 형식');
  return issues;
}
