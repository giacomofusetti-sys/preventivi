// ============================================================
// moduli/tiranti.js
// Logica specifica per TIRANTI (senza tornitura)
// ============================================================

import {
  parseDia, parseExpr, getDiametroMedio, getDiametroNominale, getDensita,
  calcolaPeso, getCostoMateriale,
  calcolaTempoTaglio, modulaCostoTaglio, taglioFin,
  calcolaTempoSmusso, smussoCosto, smussoFin,
  calcolaTempoRullatura, rullaturaFin,
  calcolaMarcatura,
  getModPeso, setupCosto, parseQta,
  applicaDegradoOperatore,
} from '../lib/calcolo_comune.js';

export function calcolaTiranti(inputs, T) {
  const {
    dia_raw, passo, lungh_raw, qta_raw, qta_x,
    mat, materiale_speciale, dens_altro,
    costo_mat_override,
    PRIGIONIERO, fil_a, fil_b,
  } = inputs;

  const co1 = T.costi_base.co1;
  const co2 = T.costi_base.co2;

  // --- Quantità ---
  const qta = parseQta(qta_raw);
  if (isNaN(qta) || qta <= 0) throw new Error('Quantità non valida');
  const qta_str = String(qta_raw).includes('+')
    ? String(qta_raw).split('+').map(s => s.trim()).join(' + ') + ' = ' + qta
    : null;

  // --- Diametri ---
  const dia   = parseDia(dia_raw);
  const diam  = getDiametroMedio(T, dia, passo);   // diametro medio (mm)
  const dian  = getDiametroNominale(T, dia);        // diametro nominale (mm)

  // --- Lunghezza (+5 mm lavorazione) ---
  const lungh = parseExpr(lungh_raw) + 5;

  // --- Densità e peso ---
  const dens  = getDensita(T, mat, dens_altro);
  const peso  = calcolaPeso(diam, lungh, dens);     // peso su diam medio

  // --- Costo materiale ---
  const costo_mat_kg = getCostoMateriale(T, mat, costo_mat_override);
  const mat_cost     = peso * costo_mat_kg;

  // --- Taglio ---
  const tempo_ta = calcolaTempoTaglio(diam, lungh, mat, materiale_speciale, T);
  const ta_raw   = tempo_ta * co1;
  const { ta, messages } = modulaCostoTaglio(ta_raw, qta, mat, costo_mat_kg, peso);
  const taglio_fin = taglioFin(ta, qta);

  // --- Smusso ---
  const smusso_t   = calcolaTempoSmusso(dian, lungh, mat, T);
  const sm         = smussoCosto(smusso_t, dian, co1, co2);
  const smusso_fin = smussoFin(sm, qta);

  // --- Rullatura ---
  const lung_fil  = PRIGIONIERO ? (fil_a + fil_b) : lungh;
  let t_rull      = calcolaTempoRullatura(dian, lung_fil, passo, mat, T);
  t_rull          = applicaDegradoOperatore(t_rull, qta, T);
  const rulla_fin = rullaturaFin(t_rull, co1, co2, dian, qta);

  // --- Marcatura ---
  const marc_fin = calcolaMarcatura(dian, qta, T);

  // --- Setup (approntamento macchina) ---
  const setup_taglio = setupCosto(T.setup_secondi.taglio,    co1, qta);
  const setup_smusso = setupCosto(T.setup_secondi.smusso,    co1, qta);
  const setup_rull   = setupCosto(T.setup_secondi.rullatura, co1, qta);

  // --- Totali ---
  const costo_lav = taglio_fin + smusso_fin + rulla_fin + marc_fin
                  + setup_taglio + setup_smusso + setup_rull;
  const costo_tot = mat_cost + costo_lav;

  // --- Peso con modificatore ---
  const q_peso              = qta_x > 0 ? qta_x : qta;
  const mod_peso            = getModPeso(peso, q_peso, T);
  const peso_principale     = peso * q_peso * mod_peso;
  const peso_principale_reale = peso * q_peso;
  const peso_lotto_completo = qta_x > 0 ? peso * qta : null;

  // --- Stringa tempi per gestionale ---
  const tempi_gestionale =
    `TAGLI ${Math.round(tempo_ta)}\n` +
    `SMUSS ${Math.round(smusso_t)}\n` +
    `RULLA ${Math.round(t_rull)}\n` +
    `ATAGL ${T.setup_secondi.taglio}\n` +
    `ASMUS ${T.setup_secondi.smusso}\n` +
    `ARULL ${T.setup_secondi.rullatura}`;

  return {
    // Costi unitari
    mat_cost,
    taglio_fin, smusso_fin, rulla_fin, marc_fin,
    setup_taglio, setup_smusso, setup_rull,
    costo_lav, costo_tot,
    // Tempi
    tempo_ta, smusso_t, t_rull,
    // Peso
    peso, diam, dian,
    peso_principale, peso_principale_reale, peso_lotto_completo,
    mod_peso, q_peso,
    // Utility
    qta, qta_x, qta_str,
    mat, messages,
    tempi_gestionale,
  };
}