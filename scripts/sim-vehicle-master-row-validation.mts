import { validateSerializedVehicleMasterRow } from '../lib/domain/vehicle-master-row-validation';

const base = Array.from({ length: 30 }, () => 'x') as unknown[];
base[11] = 1; base[12] = 1; base[20] = 1999; base[21] = 2; base[24] = 5; base[25] = '';
base[19] = '가솔린';
if (validateSerializedVehicleMasterRow(base).length) throw new Error('정상 내연기관 행 거짓 차단');
const ev = [...base]; ev[19] = '전기'; ev[20] = ''; ev[21] = ''; ev[25] = 35.2;
if (validateSerializedVehicleMasterRow(ev).length) throw new Error('정상 전기차 행 거짓 차단');
const evWithoutBattery = [...ev]; evWithoutBattery[25] = '';
if (!validateSerializedVehicleMasterRow(evWithoutBattery).some((issue) => issue.includes('배터리'))) throw new Error('전기차 배터리 누락 허용');
const iceWithoutCc = [...base]; iceWithoutCc[20] = '';
if (!validateSerializedVehicleMasterRow(iceWithoutCc).some((issue) => issue.includes('배기량'))) throw new Error('내연기관 배기량 누락 허용');
for (const fuel of ['하이브리드', 'PHEV', 'EREV']) {
  const electrifiedCombustion = [...base]; electrifiedCombustion[19] = fuel; electrifiedCombustion[25] = 18;
  if (validateSerializedVehicleMasterRow(electrifiedCombustion).length) throw new Error(`${fuel} 정상 행 거짓 차단`);
  electrifiedCombustion[20] = '';
  if (!validateSerializedVehicleMasterRow(electrifiedCombustion).some((issue) => issue.includes('배기량'))) throw new Error(`${fuel} 배기량 누락 허용`);
}
console.log('PASS vehicle master row validation — ICE/EV/HEV/PHEV/EREV 기술축 분기');
