// ============================================================
// moduli/prigionieri.js
// Logica specifica per PRIGIONIERI (UNI 5909, 5911, libero)
// ============================================================

import {
  MAT_INOX,
  parseDia, getDiametroMedio, getDiametroNominale, getDensita,
  calcolaPeso, getCostoMateriale,
  calcolaMarcatura, calcolaBonifica, getModPeso, setupCosto, parseQta
} from '../lib/calcolo_comune.js';

// --- RADICE (m) ---------------------------------------------

function getRadice(TP, tipo, dia, m1_custom) {
  if (tipo === 'prig') return m1_custom;
  if (tipo === '5909') return parseFloat(dia);
  if (tipo === '5911') {
    const key = String(dia);
    const diaNum = parseFloat(dia);
    if (TP.radice_5911[key] !== undefined) return TP.radice_5911[key];
    if (diaNum >= TP.radice_5911_grandi.soglia)
      return diaNum * TP.radice_5911_grandi.moltiplicatore;
    throw new Error(`Radice 5911 non trovata per diametro ${dia}`);
  }
  throw new Error(`Tipo prigioniero "${tipo}" non riconosciuto`);
}

// --- FILETTO (b) --------------------------------------------

function getFiletto(TP, tipo, dia, lungh, b1_custom) {
  if (tipo === 'prig') return b1_custom;
  const key  = String(dia);
  const diaNum = parseFloat(dia);
  const entry  = TP.filetto_5909_5911[key];

  if (entry === undefined) {
    // Diametri grandi: formula dia*2+12
    if (diaNum > TP.filetto_grandi_formula.soglia)
      return diaNum * 2 + 12;
    throw new Error(`Filetto non trovato per diametro ${dia}`);
  }

  if (typeof entry === 'number') return entry;

  // Diametri con soglia lunghezza
  if (entry.soglia2 !== undefined) {
    // dia 24 ha tre fasce
    if (lungh <= entry.soglia1) return entry.corto;
    if (lungh <= entry.soglia2) return entry.medio;
    return entry.lungo;
  }
  return lungh <= entry.soglia ? entry.corto : entry.lungo;
}

// --- TAGLIO -------------------------------------------------

function calcolaTaglio(diaz, mat, TP) {
  const tiers = MAT_INOX.includes(mat)
    ? TP.taglio.inox_altro
    : TP.taglio.standard;
  for (const r of tiers) {
    if (diaz <= r.fino_a) return r.costo;
  }
  throw new Error(`Diametro barra ${diaz} fuori range per taglio`);
}

// --- TORNITURA ----------------------------------------------

function calcolaTempoTornitura(
  lungh_fil, lungh_liscia,
  differenza_fil, differenza_liscia,
  mat, materiale_speciale, div, T
) {
  const t_fil    = (lungh_fil    / div) * Math.ceil(differenza_fil    / 3);
  const t_liscia = (lungh_liscia / div) * Math.ceil(Math.max(differenza_liscia, 0) / 3);
  let tempo = t_fil + t_liscia + 20;

  // Materiali speciali
  if (mat === 'altro') {
    const k = T.materiali_speciali_k?.[materiale_speciale];
    if (k) tempo *= k;
  }

  return Math.max(tempo, 90);
}

// --- RULLATURA ----------------------------------------------

function calcolaTempoRullatura(dian, b, mat, TP) {
  const tiers = MAT_INOX.includes(mat)
    ? TP.rullatura_inox_altro
    : TP.rullatura_standard;

  for (const r of tiers) {
    if (dian <= r.dian_a && b <= r.b_a) return r.secondi;
  }
  throw new Error(`Combinazione dian=${dian} b=${b} fuori range per rullatura prigionieri`);
}

// --- CALCOLO PRINCIPALE -------------------------------------

export function calcolaPrigionieri(inputs, TC, TP) {
  const {
    tipo, dia_raw, passo,
    lungh_raw, parte_liscia,
    m1, b1,
    qta_raw, qta_x,
    mat, materiale_speciale, dens_altro,
    costo_mat_override,
    dia_disp,
    FANTINA, BARRA_GIUSTA, lungh_barra,
    marcatura_complessa,
  } = inputs;

  const co1 = TC.costi_base.co1;
  const co2 = TC.costi_base.co2;

  // --- Quantità ---
  const qta = parseQta(qta_raw);
  if (isNaN(qta) || qta <= 0) throw new Error('Quantità non valida');
  const qta_str = String(qta_raw).includes('+')
    ? String(qta_raw).split('+').map(s => s.trim()).join(' + ') + ' = ' + qta
    : null;

  // --- Diametri ---
  const dia  = parseDia(dia_raw);
  const diam = getDiametroMedio(TC, dia, passo);   // diametro medio filetto
  const dian = getDiametroNominale(TC, dia);        // diametro nominale

  // Diametro parte liscia (se alleggerita, altrimenti = nominale)
  const dian_liscia = (parte_liscia > 0) ? parte_liscia : dian;

  // --- Lunghezza ---
  const lungh = parseFloat(lungh_raw) + 5;

  // --- Radice e filetto ---
  const m_rad = getRadice(TP, tipo, dia, m1);
  const b_fil = getFiletto(TP, tipo, dia, lungh, b1);

  // Lunghezza totale
  const lunghtot = (tipo === 'prig') ? lungh : lungh + m_rad;

  // Lunghezze tratti
  const lungh_fil    = m_rad + b_fil;
  const lungh_liscia = lunghtot - lungh_fil;

  // --- Densità e peso ---
  const dens = getDensita(TC, mat, dens_altro);

  // Peso materiale grezzo (cilindro dia_disp × lunghtot)
  const peso_grezzo = calcolaPeso(dia_disp, lunghtot, dens);

  // Peso finito: parte filettata (diam medio) + parte liscia (dian_liscia)
  const peso_fil    = calcolaPeso(diam,        lungh_fil,    dens);
  const peso_liscia = calcolaPeso(dian_liscia, lungh_liscia, dens);
  const peso_fin    = peso_fil + peso_liscia;

  // Peso barre (per BARRA_GIUSTA)
  const pezzi_per_barra = Math.floor(lungh_barra / lungh);
  const num_barre = Math.ceil(qta / pezzi_per_barra);
  const peso_barre = calcolaPeso(dia_disp, lungh_barra, dens) * num_barre;

  // --- Costo materiale ---
  const costo_mat_kg = getCostoMateriale(TC, mat, costo_mat_override);
  const mat_cost = BARRA_GIUSTA
    ? (costo_mat_kg * peso_barre) / qta
    : costo_mat_kg * peso_grezzo;

  // --- Taglio (solo senza fantina) ---
  let ta_costo = 0, setup_taglio = 0, tempo_taglio = 0;
  if (!FANTINA) {
    ta_costo     = calcolaTaglio(dia_disp, mat, TP);
    tempo_taglio = ta_costo / co1;  // secondi ricavati dal costo
    const ta_fin = ta_costo * qta < 10 ? 10 / qta : ta_costo;
    ta_costo     = ta_fin;
    setup_taglio = setupCosto(TP.setup_secondi.taglio, co1, qta);
  }

  // --- Tornitura ---
  const div = MAT_INOX.includes(mat) ? 3 : 4;
  const differenza_fil    = dia_disp - diam;
  const differenza_liscia = dia_disp - dian_liscia;

  const tempo_torn = calcolaTempoTornitura(
    lungh_fil, lungh_liscia,
    differenza_fil, differenza_liscia,
    mat, materiale_speciale, div, TC
  );

  const tempo_torn_fantina = tempo_torn / 2;

  const to_rate = dian < 45 ? co1 : co2;
  const to_pieno   = tempo_torn * to_rate;
  const to_fantina = tempo_torn_fantina * co1;
  const to_raw     = FANTINA ? to_fantina : to_pieno;
  const to_costo   = to_raw * qta < 10 ? 10 / qta : to_raw;

  const setup_torn = FANTINA
    ? setupCosto(TP.setup_secondi.tornitura_fantina, co1, qta)
    : setupCosto(TP.setup_secondi.tornitura_normale, co1, qta);

  // --- Rullatura ---
  const t_rull   = calcolaTempoRullatura(dian, b_fil, mat, TP);
  const ru_rate  = dian < 45 ? co1 : co2;
  const ru_raw   = t_rull * ru_rate;
  const ru_costo = ru_raw * qta < 10 ? 10 / qta : ru_raw;
  const setup_rull = setupCosto(TP.setup_secondi.rullatura, co1, qta);

  // --- Marcatura ---
  const { costo: marc_fin, setup: setup_marc, tempo_setup: tempo_setup_marc } = calcolaMarcatura(dian, lungh, qta, co1, marcatura_complessa);

  // --- Attrezzatura ---
  const attrez = MAT_INOX.includes(mat) ? 0.6 : 0;

  // --- Bonifica ---
  const bonifica = calcolaBonifica(peso_grezzo, qta, dian, lungh, mat, TC);

  // --- Totali ---
  const costo_lav = ta_costo + to_costo + ru_costo + marc_fin + setup_marc + attrez
                  + setup_taglio + setup_torn + setup_rull;
  const costo_tot = mat_cost + bonifica + costo_lav;

  // --- Modificatore peso ---
  const q_peso              = qta_x > 0 ? qta_x : qta;
  const mod_peso            = getModPeso(peso_grezzo, q_peso, TC);
  const peso_principale     = peso_grezzo * q_peso * mod_peso;
  const peso_principale_reale = peso_grezzo * q_peso;
  const peso_lotto_completo = qta_x > 0 ? peso_grezzo * qta : null;

  // --- Stringa tempi per gestionale ---
  const riga_mat = `\u20AC ${costo_tot.toFixed(2)} - da mat. ${mat} \u00D8 ${dia_disp.toFixed(1)} mm, ${peso_principale_reale.toFixed(2)} kg`;
  let tempi_gestionale;
  if (FANTINA) {
    tempi_gestionale =
      riga_mat + '\n' +
      `TORN2 ${Math.round(tempo_torn_fantina)}\n` +
      `RULLA ${Math.round(t_rull)}\n` +
      `ATOR2 ${TP.setup_secondi.tornitura_fantina}\n` +
      `ARULL ${TP.setup_secondi.rullatura}\n` +
      `AMARC ${tempo_setup_marc}`;
  } else {
    tempi_gestionale =
      riga_mat + '\n' +
      `TAGLI ${Math.round(tempo_taglio)}\n` +
      `TORN1 ${Math.round(tempo_torn)}\n` +
      `RULLA ${Math.round(t_rull)}\n` +
      `ATAGL ${TP.setup_secondi.taglio}\n` +
      `ATOR1 ${TP.setup_secondi.tornitura_normale}\n` +
      `ARULL ${TP.setup_secondi.rullatura}\n` +
      `AMARC ${tempo_setup_marc}`;
  }

  return {
    // Costi
    mat_cost, bonifica, attrez,
    ta_costo, to_costo, ru_costo, marc_fin, setup_marc,
    setup_taglio, setup_torn, setup_rull,
    costo_lav, costo_tot,
    // Tempi
    tempo_taglio, tempo_torn, tempo_torn_fantina, t_rull,
    // Geometria
    diam, dian, dian_liscia,
    m_rad, b_fil, lunghtot,
    lungh_fil, lungh_liscia,
    // Peso
    peso: peso_grezzo, peso_fin,
    peso_principale, peso_principale_reale, peso_lotto_completo,
    mod_peso, q_peso,
    // Barre
    BARRA_GIUSTA, FANTINA,
    num_barre, peso_barre,
    // Utility
    qta, qta_x, qta_str, tipo, mat,
    tempi_gestionale,
  };
}
