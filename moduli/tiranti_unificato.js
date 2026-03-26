// ============================================================
// moduli/tiranti_unificato.js
// Logica unificata per TIRANTI:
//   - dia_disp <= diam + 0.1  →  senza tornitura (smusso)
//   - dia_disp >  diam + 0.1  →  con tornitura (no smusso)
// ============================================================

import {
  MAT_INOX,
  parseDia, getDiametroMedio, getDiametroNominale, getDensita,
  calcolaPeso, getCostoMateriale,
  calcolaTempoTaglio, modulaCostoTaglio, taglioFin,
  calcolaTempoSmusso, smussoCosto, smussoFin,
  calcolaTempoRullatura, rullaturaFin,
  calcolaMarcatura,
  getModPeso, setupCosto, parseQta
} from '../lib/calcolo_comune.js';

// --- Helper tornitura (da tiranti_torniti.js) ----------------

function calcolaTempoTornitura(diam_medio, dia_disp, lungh, mat, materiale_speciale, T) {
  const differenza = dia_disp - diam_medio;
  const div = MAT_INOX.includes(mat) ? 3 : 4;
  const passate = Math.ceil(differenza / 3);
  let tempo = (lungh / div) * passate;
  if (mat === 'altro') {
    const k = T.materiali_speciali_k[materiale_speciale];
    if (!k) throw new Error(`Specifica un materiale_speciale valido per "altro" (F53, 660, 718)`);
    tempo *= k;
  }
  return Math.max(tempo, 90);
}

function calcolaTempoSportello(dian) {
  return dian < 45 ? 15 : 25;
}

function torniFin(tempo_torn, sportello, co1, co2, dian, qta, FANTINA) {
  const costo_pieno   = (tempo_torn + sportello) * (dian < 45 ? co1 : co2);
  const costo_fantina = (tempo_torn / 2) * co1;
  const costo = FANTINA ? costo_fantina : costo_pieno;
  return costo * qta < 10 ? 10 / qta : costo;
}

function calcolaMatPlus(valore_mat, qta, qta_x, dian, lungh, mod_qta_fn) {
  const mod = mod_qta_fn(dian, lungh);
  const q = qta_x > 0 ? qta_x : qta;
  return valore_mat * (q + mod) / q;
}

function getModQta(dian, lungh) {
  let mod;
  if (dian < 12)      mod = 3;
  else if (dian < 20) mod = 2;
  else                mod = 1;
  if (dian < 20  && lungh >= 300) mod = 1;
  if (dian >= 20 && lungh >= 300) mod = 0;
  return mod;
}

// --- Calcolo principale -------------------------------------

export function calcolaTiranti(inputs, T) {
  const {
    dia_raw, passo, lungh_raw, qta_raw, qta_x,
    mat, materiale_speciale, dens_altro,
    costo_mat_override,
    // Path semplice (no tornitura)
    PRIGIONIERO, fil_a, fil_b,
    // Determina il path + usati nel path tornito
    dia_disp,
    FANTINA, BARRA_GIUSTA, lungh_barra,
    marcatura_complessa,
    medio_override = 0,
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
  const dia  = parseDia(dia_raw);
  const diam = medio_override > 0 ? medio_override : getDiametroMedio(T, dia, passo);
  const dian = getDiametroNominale(T, dia);

  // Validazione: la barra non può essere inferiore al 95% del diametro medio effettivo
  if (dia_disp < diam * 0.95) throw new Error(
    `Diametro barra (${dia_disp.toFixed(1)} mm) inferiore al minimo accettabile (${(diam * 0.95).toFixed(1)} mm).`
  );

  // --- Lunghezza ---
  const lungh_pezzo = parseFloat(lungh_raw);     // lunghezza reale del pezzo senza scarto
  const lungh       = lungh_pezzo + 5;           // lunghezza con scarto, solo per calcolo peso/taglio

  // --- Densità ---
  const dens = getDensita(T, mat, dens_altro);

  // --- Scelta logica ---
  const ha_tornitura = dia_disp > diam + 0.1;

  if (!ha_tornitura) {
    // ══════════════════════════════════════════════════════
    // PATH SEMPLICE — logica tiranti.js (smusso, no tornitura)
    // ══════════════════════════════════════════════════════

    const peso = calcolaPeso(diam, lungh, dens);

    const costo_mat_kg = getCostoMateriale(T, mat, costo_mat_override);
    const mat_cost     = peso * costo_mat_kg;

    // Taglio
    const tempo_ta = calcolaTempoTaglio(diam, mat);
    const ta_raw   = tempo_ta * co1;
    const { ta, messages } = modulaCostoTaglio(ta_raw, qta, mat, costo_mat_kg, peso);
    const taglio_fin = taglioFin(ta, qta);

    // Smusso
    const smusso_t   = calcolaTempoSmusso(dian, lungh_pezzo, mat, T);
    const sm         = smussoCosto(smusso_t, dian, co1, co2);
    const smusso_fin = smussoFin(sm, qta);

    // Rullatura
    const lung_fil  = PRIGIONIERO ? (fil_a + fil_b) : lungh_pezzo;
    const t_rull    = calcolaTempoRullatura(dian, lung_fil, passo, mat, T);
    const rulla_fin = rullaturaFin(t_rull, co1, co2, dian, qta);

    // Marcatura
    const { costo: marc_fin, setup: setup_marc, tempo: tempo_marc, tempo_setup: tempo_setup_marc } = calcolaMarcatura(dian, lungh_pezzo, qta, co1, marcatura_complessa);

    // Setup
    const setup_taglio = setupCosto(T.setup_secondi.taglio,    co1, qta);
    const setup_smusso = setupCosto(T.setup_secondi.smusso,    co1, qta);
    const setup_rull   = setupCosto(T.setup_secondi.rullatura, co1, qta);

    // Totali
    const costo_lav = taglio_fin + smusso_fin + rulla_fin + marc_fin + setup_marc
                    + setup_taglio + setup_smusso + setup_rull;
    const costo_tot = mat_cost + costo_lav;

    // Peso con modificatore
    const q_peso              = qta_x > 0 ? qta_x : qta;
    const mod_peso            = getModPeso(peso, q_peso, T);
    const peso_principale     = peso * q_peso * mod_peso;
    const peso_principale_reale = peso * q_peso;
    const peso_lotto_completo = qta_x > 0 ? peso * qta : null;

    const tempi_gestionale =
      `\u20AC ${costo_tot.toFixed(2)} - da mat. ${mat} \u00D8 ${dia_disp.toFixed(1)} mm, ${peso_principale.toFixed(2)} kg\n` +
      `TAGLI ${Math.round(tempo_ta)}\n` +
      `SMUSS ${Math.round(smusso_t)}\n` +
      `RULLA ${Math.round(t_rull)}\n` +
      `MARCA ${tempo_marc}\n` +
      `ATAGL ${T.setup_secondi.taglio}\n` +
      `ASMUS ${T.setup_secondi.smusso}\n` +
      `ARULL ${T.setup_secondi.rullatura}\n` +
      `AMARC ${tempo_setup_marc}`;

    return {
      ha_tornitura: false,
      // Costi
      mat_cost,
      taglio_fin, smusso_fin, rulla_fin, marc_fin, setup_marc,
      setup_taglio, setup_smusso, setup_rull,
      costo_lav, costo_tot,
      // Tempi
      tempo_ta, smusso_t, t_rull,
      tempo_marc, tempo_setup_marc,
      // Peso
      peso, diam, dian,
      peso_principale, peso_principale_reale, peso_lotto_completo,
      mod_peso, q_peso,
      // Utility
      qta, qta_x, qta_str,
      mat, messages,
      tempi_gestionale,
    };

  } else {
    // ══════════════════════════════════════════════════════
    // PATH TORNITO — logica tiranti_torniti.js (tornitura, no smusso)
    // ══════════════════════════════════════════════════════

    const peso_grezzo = calcolaPeso(dia_disp, lungh, dens);
    const peso_fin    = calcolaPeso(diam, lungh, dens);

    // Barre intere
    const pezzi_per_barra = Math.floor(lungh_barra / lungh);
    const num_barre  = Math.ceil(qta / pezzi_per_barra);
    const peso_barre = calcolaPeso(dia_disp, lungh_barra, dens) * num_barre;

    // Costo materiale
    const costo_mat_kg = getCostoMateriale(T, mat, costo_mat_override);
    const valore_mat   = costo_mat_kg * peso_grezzo;
    let mat_cost;
    if (BARRA_GIUSTA) {
      mat_cost = (costo_mat_kg * peso_barre) / qta;
    } else if (FANTINA) {
      mat_cost = calcolaMatPlus(valore_mat, qta, qta_x, dian, lungh, getModQta);
    } else {
      mat_cost = valore_mat;
    }

    // Taglio (solo senza fantina)
    let tempo_ta = null, taglio_fin = 0, setup_taglio = 0;
    if (!FANTINA) {
      tempo_ta   = calcolaTempoTaglio(dia_disp, mat);
      const ta_raw = tempo_ta * co1;
      const { ta } = modulaCostoTaglio(ta_raw, qta, mat, costo_mat_kg, peso_grezzo);
      taglio_fin   = taglioFin(ta, qta);
      setup_taglio = setupCosto(T.setup_secondi.taglio, co1, qta);
    }

    // Tornitura
    const tempo_torn = calcolaTempoTornitura(diam, dia_disp, lungh, mat, materiale_speciale, T);
    const sportello  = calcolaTempoSportello(dian);
    const torni_fin  = torniFin(tempo_torn, sportello, co1, co2, dian, qta, FANTINA);
    const tempo_torn_def     = tempo_torn + sportello;
    const tempo_torn_fantina = tempo_torn / 2;
    const setup_torn = FANTINA
      ? setupCosto(T.setup_secondi.tornitura_fantina, co1, qta)
      : setupCosto(T.setup_secondi.tornitura_normale, co1, qta);

    // Rullatura
    const t_rull    = calcolaTempoRullatura(dian, lungh_pezzo, passo, mat, T);
    const rulla_fin = rullaturaFin(t_rull, co1, co2, dian, qta);
    const setup_rull = setupCosto(T.setup_secondi.rullatura, co1, qta);

    // Marcatura, attrezzatura
    const { costo: marc_fin, setup: setup_marc, tempo: tempo_marc, tempo_setup: tempo_setup_marc } = calcolaMarcatura(dian, lungh_pezzo, qta, co1, marcatura_complessa);
    const attrez   = MAT_INOX.includes(mat) ? 0.6 : 0;

    // Totali
    const costo_lav = taglio_fin + torni_fin + rulla_fin + marc_fin + setup_marc + attrez
                    + setup_taglio + setup_torn + setup_rull;
    const costo_tot = mat_cost + costo_lav;

    // Peso con modificatore
    const q_peso              = qta_x > 0 ? qta_x : qta;
    const mod_peso            = getModPeso(peso_grezzo, q_peso, T);
    const peso_principale     = peso_grezzo * q_peso * mod_peso;
    const peso_principale_reale = peso_grezzo * q_peso;
    const peso_lotto_completo = qta_x > 0 ? peso_grezzo * qta : null;

    const riga_mat = `\u20AC ${costo_tot.toFixed(2)} - da mat. ${mat} \u00D8 ${dia_disp.toFixed(1)} mm, ${peso_principale.toFixed(2)} kg`;
    let tempi_gestionale;
    if (FANTINA) {
      tempi_gestionale =
        riga_mat + '\n' +
        `TORN2 ${Math.round(tempo_torn_fantina)}\n` +
        `RULLA ${Math.round(t_rull)}\n` +
        `MARCA ${tempo_marc}\n` +
        `ATOR2 ${T.setup_secondi.tornitura_fantina}\n` +
        `ARULL ${T.setup_secondi.rullatura}\n` +
        `AMARC ${tempo_setup_marc}`;
    } else {
      tempi_gestionale =
        riga_mat + '\n' +
        `TAGLI ${Math.round(tempo_ta)}\n` +
        `TORN1 ${Math.round(tempo_torn_def)}\n` +
        `RULLA ${Math.round(t_rull)}\n` +
        `MARCA ${tempo_marc}\n` +
        `ATAGL ${T.setup_secondi.taglio}\n` +
        `ATOR1 ${T.setup_secondi.tornitura_normale}\n` +
        `ARULL ${T.setup_secondi.rullatura}\n` +
        `AMARC ${tempo_setup_marc}`;
    }

    return {
      ha_tornitura: true,
      // Costi
      mat_cost, attrez,
      taglio_fin, torni_fin, rulla_fin, marc_fin, setup_marc,
      setup_taglio, setup_torn, setup_rull,
      costo_lav, costo_tot,
      // Tempi
      tempo_ta, tempo_torn_def, tempo_torn_fantina, t_rull,
      tempo_marc, tempo_setup_marc,
      // Peso
      peso: peso_grezzo, peso_fin, diam, dian,
      peso_principale, peso_principale_reale, peso_lotto_completo,
      mod_peso, q_peso,
      // Barra
      BARRA_GIUSTA, FANTINA,
      num_barre, peso_barre,
      // Utility
      qta, qta_x, qta_str,
      mat, messages: [],
      tempi_gestionale,
    };
  }
}
