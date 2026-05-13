export const VERSION = '1.0.4';
export const VERSION_DATE = '2026-05-13';

const MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];

export function formatDataItaliana(isoDate) {
  const [anno, mese, giorno] = isoDate.split('-');
  return `${parseInt(giorno, 10)} ${MESI[parseInt(mese, 10) - 1]} ${anno}`;
}
