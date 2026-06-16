export const VERSION = '1.1.0';
export const VERSION_DATE = '2026-06-12';

const MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];

export function formatDataItaliana(isoDate) {
  const [anno, mese, giorno] = isoDate.split('-');
  return `${parseInt(giorno, 10)} ${MESI[parseInt(mese, 10) - 1]} ${anno}`;
}
