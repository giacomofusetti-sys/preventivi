// ============================================================
// moduli/tiranti_torniti.js
// Logica specifica per TIRANTI DA TORNIRE
// ============================================================

import {
  parseDia, parseExpr, getDiametroMedio, getDiametroNominale, getDensita,
  calcolaPeso, getCostoMateriale,
  calcolaTempoTaglio, modulaCostoTaglio, taglioFin,
  calcolaTempoRullatura, rullaturaFin,
  calcolaMarcatura,
  getModPeso, setupCosto, parseQta
} from '../lib/calcolo_comune.js';

// --- TORNITURA ----------------------------------------------

function calcolaTempoTornitura(diam_medio, dia_disp, lungh, mat, materiale_speciale, T) {
  const differenza = dia_disp - diam_medio;

  // Divisore in base al materiale
  const div = (mat === 'inox' || mat === 'altro') ? 3 : 4;

  // Passate necessarie (ogni passata toglie max 3mm di differenza)
  const passate = Math.ceil(differenza / 3);

  let tempo = (lungh / div) * passate;

  // Moltiplicatore per materiali speciali
  if (mat === 'altro') {
    const k = T.materiali_speciali_k[materiale_speciale];
    if (!k) throw new Error(`Specifica un materiale_speciale valido per "altro" (F53, 660, 718)`);
    tempo *= k;
  }

  // Minimo 75 secondi
  return Math.max(tempo, 90);
}

function calcolaTempoSportello(dian) {
  return dian < 45 ? 15 : 25;
}

function torniFin(tempo_torn, sportello, co1, co2, dian, qta, FANTINA) {
  const costo_pieno = (tempo_torn + sportello) * (dian < 45 ? co1 : co2);
  const costo_fantina = (tempo_torn / 2) * co1;

  const costo = FANTINA ? costo_fantina : costo_pieno;
  return costo * qta < 10 ? 10 / qta : costo;
}

// --- MATERIALE CON BARRA GIUSTA / FANTINA -------------------

function calcolaMatPlus(valore_mat, qta, qta_x, dian, lungh, mod_qta_fn) {
  const mod = mod_qta_fn(dian, lungh);
  const q = qta_x > 0 ? qta_x : qta;
  return valore_mat * (q + mod) / q;
}

function getModQta(dian, lungh) {
  // Pezzi extra di materiale da considerare
  let mod;
  if (dian < 12)       mod = 3;
  else if (dian < 20)  mod = 2;
  else                 mod = 1;

  // Annulla il modificatore per pezzi lunghi
  if (dian < 20  && lungh >= 300) mod = 1;
  if (dian >= 20 && lungh >= 300) mod = 0;

  return mod;
}

// --- CALCOLO PRINCIPALE -------------------------------------

export function calcolaTirantiTorniti(inputs, T) {
  const {
    dia_raw, passo, lungh_raw, qta_raw, qta_x,
    mat, materiale_speciale, dens_altro,
    costo_mat_override,
    dia_disp,           // diametro barra grezza (mm)
    FANTINA,            // bool
    BARRA_GIUSTA,       // bool
    lungh_barra,        // lunghezza barra (mm), usata solo se BARRA_GIUSTA
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
  const diam = getDiametroMedio(T, dia, passo);   // diametro medio filetto
  const dian = getDiametroNominale(T, dia);        // diametro nominale

  // --- Lunghezza ---
  const lungh = parseExpr(lungh_raw) + 5;

  // --- Densità ---
  const dens = getDensita(T, mat, dens_altro);

  // --- Pesi ---
  // Peso della barra grezza (da dia_disp)
  const peso_grezzo = calcolaPeso(dia_disp, lungh, dens);
  // Peso del pezzo finito (da diam medio)
  const peso_fin    = calcolaPeso(diam, lungh, dens);

  // --- Numero barre (per BARRA_GIUSTA) ---
  const pezzi_per_barra = Math.floor(lungh_barra / lungh);
  const num_barre = Math.ceil(qta / pezzi_per_barra);
  const peso_barre = calcolaPeso(dia_disp, lungh_barra, dens) * num_barre;

  // --- Costo materiale ---
  const costo_mat_kg = getCostoMateriale(T, mat, costo_mat_override);
  const valore_mat   = costo_mat_kg * peso_grezzo;

  let mat_cost;
  if (BARRA_GIUSTA) {
    // Pago le barre intere diviso la quantità
    mat_cost = (costo_mat_kg * peso_barre) / qta;
  } else if (FANTINA) {
    // Fantina: aggiungo pezzi extra (sfrido)
    mat_cost = calcolaMatPlus(valore_mat, qta, qta_x, dian, lungh, getModQta);
  } else {
    mat_cost = valore_mat;
  }

  // --- Taglio (solo senza fantina) ---
  let tempo_ta   = null;
  let taglio_fin_val = 0;
  let setup_taglio   = 0;
  if (!FANTINA) {
    tempo_ta       = calcolaTempoTaglio(dia_disp, lungh, mat, materiale_speciale, T);
    const ta_raw   = tempo_ta * co1;
    const { ta }   = modulaCostoTaglio(ta_raw, qta, mat, costo_mat_kg, peso_grezzo);
    taglio_fin_val = taglioFin(ta, qta);
    setup_taglio   = setupCosto(T.setup_secondi.taglio, co1, qta);
  }

  // --- Tornitura ---
  const tempo_torn = calcolaTempoTornitura(diam, dia_disp, lungh, mat, materiale_speciale, T);
  const sportello  = calcolaTempoSportello(dian);

  const torni_fin_val = torniFin(tempo_torn, sportello, co1, co2, dian, qta, FANTINA);

  const tempo_torn_def     = tempo_torn + sportello;
  const tempo_torn_fantina = tempo_torn / 2;

  const setup_torn = FANTINA
    ? setupCosto(T.setup_secondi.tornitura_fantina,  co1, qta)
    : setupCosto(T.setup_secondi.tornitura_normale,  co1, qta);

  // --- Rullatura ---
  const t_rull    = calcolaTempoRullatura(dian, lungh, passo, mat, T);
  const rulla_fin = rullaturaFin(t_rull, co1, co2, dian, qta);
  const setup_rull = setupCosto(T.setup_secondi.rullatura, co1, qta);

  // --- Marcatura ---
  const marc_fin = calcolaMarcatura(dian, qta, T);

  // --- Attrezzatura (solo inox/altro) ---
  const attrez = (mat === 'inox' || mat === 'altro') ? 0.6 : 0;

  // --- Totali ---
  const costo_lav = taglio_fin_val + torni_fin_val + rulla_fin + marc_fin + attrez
                  + setup_taglio + setup_torn + setup_rull;
  const costo_tot = mat_cost + costo_lav;

  // --- Peso con modificatore ---
  const q_peso              = qta_x > 0 ? qta_x : qta;
  const mod_peso            = getModPeso(peso_grezzo, q_peso, T);
  const peso_principale     = peso_grezzo * q_peso * mod_peso;
  const peso_principale_reale = peso_grezzo * q_peso;
  const peso_lotto_completo = qta_x > 0 ? peso_grezzo * qta : null;

  // --- Stringa tempi per gestionale ---
  let tempi_gestionale;
  if (FANTINA) {
    tempi_gestionale =
      `TORN2 ${Math.round(tempo_torn_fantina)}\n` +
      `RULLA ${Math.round(t_rull)}\n` +
      `ATOR2 ${T.setup_secondi.tornitura_fantina}\n` +
      `ARULL ${T.setup_secondi.rullatura}`;
  } else {
    tempi_gestionale =
      `TAGLI ${Math.round(tempo_ta)}\n` +
      `TORN1 ${Math.round(tempo_torn_def)}\n` +
      `RULLA ${Math.round(t_rull)}\n` +
      `ATAGL ${T.setup_secondi.taglio}\n` +
      `ATOR1 ${T.setup_secondi.tornitura_normale}\n` +
      `ARULL ${T.setup_secondi.rullatura}`;
  }

  return {
    // Costi
    mat_cost, attrez,
    taglio_fin: taglio_fin_val,
    torni_fin: torni_fin_val,
    rulla_fin, marc_fin,
    setup_taglio, setup_torn, setup_rull,
    costo_lav, costo_tot,
    // Tempi
    tempo_ta, tempo_torn_def, tempo_torn_fantina, t_rull,
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