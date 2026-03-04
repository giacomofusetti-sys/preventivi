// ============================================================
// moduli/tiranti_occhio.js
// Logica specifica per TIRANTI A OCCHIO (UNI 6058 / libero)
// ============================================================

import {
  MAT_INOX,
  parseDia, getDiametroMedio, getDiametroNominale, getDensita,
  calcolaPeso, getCostoMateriale,
  calcolaTempoRullatura, rullaturaFin,
  calcolaMarcatura, calcolaBonifica,
  getModPeso, setupCosto, parseQta
} from '../lib/calcolo_comune.js';

// --- DIAMETRO TESTA -----------------------------------------

function getDiaTesta(tipo, dian, dia_testa_custom) {
  // Per 6058 e per libero senza override: default = dian × 2
  if (tipo === '6058' || dia_testa_custom <= 0) return dian * 2;
  return dia_testa_custom;
}

// --- DIAMETRO FORO ------------------------------------------

function getDiaForo(dia, dian, dia_foro_custom) {
  if (dia_foro_custom > 0) return dia_foro_custom;

  // Tabella fori standard (per diametro nominale)
  const FORI = {
    6:  5,   8:  6,   10: 8,
    12: 10,  '1/2': 10,
    14: 12,
    16: 14,  '5/8': 14,
    18: 16,
    20: 18,  '3/4': 18,
    22: 18,  '7/8': 18,
    24: 20,
    27: 22,  '1000': 22,
    30: 25,  '1108': 25,
    33: 30,  '1104': 30,
    36: 33,
    39: 36,  '1102': 36,
    42: 39,  '1508': 39,
    45: 42,  '1304': 42,
    48: 45,
    52: 48,  '2000': 48,
    56: 52,  '2104': 52,
    60: 56,
    64: 60,  '2102': 60,
    68: 64,
    72: 68,  '2304': 68,
  };

  const key = isNaN(parseFloat(dia)) ? String(dia) : parseFloat(dia);
  const v = FORI[key];
  if (v !== undefined) return v;
  // Fallback: se non in tabella, usa dian × 0.8 (approssimazione)
  return Math.round(dian * 0.8);
}

// --- TAGLIO (costo diretto da tabella, come prigionieri) ----

function calcolaTaglioCosto(diaz, mat) {
  if (MAT_INOX.includes(mat)) {
    if (diaz <= 20)  return 0.30;
    if (diaz <= 33)  return 0.40;
    if (diaz <= 52)  return 0.50;
    if (diaz <= 56)  return 0.70;
    if (diaz <= 63)  return 0.80;
  } else {
    if (diaz <= 20)  return 0.20;
    if (diaz <= 33)  return 0.30;
    if (diaz <= 52)  return 0.40;
    if (diaz <= 56)  return 0.50;
    if (diaz <= 63)  return 0.60;
    if (diaz <= 85)  return 1.00;
  }
  throw new Error(`Diametro barra ${diaz} fuori range per taglio`);
}

// --- TORNITURA ----------------------------------------------

function calcolaTempoTornitura(diam_medio, dia_disp, lungh, mat, materiale_speciale, T) {
  const differenza = dia_disp - diam_medio;
  const div = MAT_INOX.includes(mat) ? 3 : 4;
  const passate = Math.ceil(differenza / 3);
  let tempo = (lungh / div) * passate;

  if (mat === 'altro') {
    const k = T.materiali_speciali_k?.[materiale_speciale];
    if (!k) throw new Error(`Specifica un materiale_speciale valido per "altro" (F53, 660, 718)`);
    tempo *= k;
  }

  const minimo = dian => dian < 45 ? 90 : 100;
  return Math.max(tempo, minimo(diam_medio));
}

// --- FRESATURA (interpolazione su diametro testa) -----------

function interpolaLineare(valore, tabella) {
  const keys = Object.keys(tabella).map(Number).sort((a, b) => a - b);
  const vals  = keys.map(k => tabella[k]);

  // Valore esatto
  if (tabella[valore] !== undefined) return tabella[valore];

  // Fuori range inferiore: estrapola dai primi due
  if (valore < keys[0]) {
    const [x1, x2] = [keys[0], keys[1]];
    const [y1, y2] = [vals[0], vals[1]];
    return y1 + (y2 - y1) * ((valore - x1) / (x2 - x1));
  }
  // Fuori range superiore: estrapola dagli ultimi due
  if (valore > keys[keys.length - 1]) {
    const [x1, x2] = [keys[keys.length - 2], keys[keys.length - 1]];
    const [y1, y2] = [vals[keys.length - 2], vals[keys.length - 1]];
    return y1 + (y2 - y1) * ((valore - x1) / (x2 - x1));
  }
  // Interpolazione interna
  for (let i = 0; i < keys.length - 1; i++) {
    if (keys[i] < valore && valore < keys[i + 1]) {
      const [x1, x2] = [keys[i], keys[i + 1]];
      const [y1, y2] = [vals[i], vals[i + 1]];
      return y1 + (y2 - y1) * ((valore - x1) / (x2 - x1));
    }
  }
  return null;
}

function calcolaTempoFresatura(mat, dia_testa) {
  const TABELLE = {
    std:  { 20: 140, 30: 190, 48: 250 },
    inox: { 32: 200, 36: 270, 40: 420, 65: 460 },
  };

  const tabella = MAT_INOX.includes(mat)
    ? TABELLE.inox
    : TABELLE.std;

  const t = interpolaLineare(dia_testa, tabella);
  if (t === null) throw new Error(`Diametro testa ${dia_testa} fuori range per fresatura`);
  return Math.max(t, 120);
}

// --- STAMPAGGIO (tempo) -------------------------------------

function calcolaTempoStampaggio(dian, mat) {
  const SOGLIE = [
    [13.99, 12], [17.99, 15], [21.99, 20], [26.99, 25],
    [32.99, 30], [35.99, 35], [38.99, 40], [41.99, 45],
    [44.99, 50], [47.99, 60], [51.99, 70], [55.99, 80],
    [59.99, 90], [65,   100],
  ];
  for (const [soglia, t] of SOGLIE) {
    if (dian <= soglia) {
      return MAT_INOX.includes(mat) ? t * 2 : t;
    }
  }
  throw new Error(`Diametro ${dian} fuori range per stampaggio tirante a occhio`);
}

// --- HELPER minimo ------------------------------------------

function conMinimo(costo, qta) {
  return costo * qta < 10 ? 10 / qta : costo;
}

// --- CALCOLO PRINCIPALE -------------------------------------

export function calcolaTirantiOcchio(inputs, T) {
  const {
    tipo,                // '6058' | 'libero'
    dia_raw, passo,
    lungh_raw, qta_raw, qta_x,
    mat, materiale_speciale, dens_altro,
    costo_mat_override,
    dia_testa_custom,    // 0 = usa default
    dia_foro_custom,     // 0 = usa tabella
    dia_disp,
    STAMPAGGIO,
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
  const diam = getDiametroMedio(T, dia, passo);   // diametro medio filetto (mm)
  const dian = getDiametroNominale(T, dia);        // diametro nominale (mm)

  // --- Geometria testa e foro ---
  const testa = getDiaTesta(tipo, dian, dia_testa_custom);
  const foro  = getDiaForo(dia, dian, dia_foro_custom);

  // --- Lunghezze ---
  const lungh      = parseFloat(lungh_raw) + 5;  // lunghezza gambo + sovrametallo
  const lungh_g    = lungh - dian;                // lunghezza da rullare (gambo - nominale)
  const lungh_tot  = (lungh - testa / 2) + testa; // lunghezza tondo di partenza

  // --- Densità ---
  const dens = getDensita(T, mat, dens_altro);

  // ── Pesi ───────────────────────────────────────────────────

  // Peso tondo grezzo (cilindro dia_disp × lungh_tot)
  const peso_grezzo = calcolaPeso(dia_disp, lungh_tot, dens);

  // Volume e peso finito: testa - foro + gambo
  const PI = Math.PI;
  const Vt = PI * (testa / 2) ** 2 * dian;          // volume testa (cilindro pieno)
  const Vf = PI * (foro  / 2) ** 2 * dian;           // volume foro
  const Vg = PI * (dian  / 2) ** 2 * (lungh - testa / 2); // volume gambo
  const peso_fin = ((Vt - Vf + Vg) * dens) / 1e6;   // kg

  // --- Materiale per stampaggio ---
  // Sviluppo testa: volume testa / area tondo = altezza equivalente spezzone
  const area_tondo  = PI * (dia_disp / 2) ** 2;
  const sviluppo_t  = (PI * (testa / 2) ** 2 * (testa / area_tondo));
  const lungh_spz   = sviluppo_t + (lungh - testa / 2);
  const peso_spz    = calcolaPeso(dia_disp, lungh_spz, dens); // peso spezzone per stamp.

  // --- Costo materiale ---
  const costo_mat_kg = getCostoMateriale(T, mat, costo_mat_override);
  const peso_mat     = STAMPAGGIO ? peso_spz : peso_grezzo;
  const mat_cost     = peso_mat * costo_mat_kg;

  // --- Taglio ---
  const ta_raw   = calcolaTaglioCosto(dia_disp, mat);
  const ta_costo = conMinimo(ta_raw, qta);
  const ta_tempo = ta_raw / co1;  // secondi ricavati dal costo
  const setup_taglio = setupCosto(T.setup_secondi.taglio, co1, qta);

  // --- Stampaggio (solo se STAMPAGGIO) ---
  const tempo_stamp = STAMPAGGIO ? calcolaTempoStampaggio(dian, mat) : 0;
  const stamp_rate  = dian < 48 ? co1 : co2;
  const st_raw      = STAMPAGGIO ? tempo_stamp * stamp_rate : 0;
  const st_costo    = STAMPAGGIO ? conMinimo(st_raw, qta) : 0;
  const setup_stamp = STAMPAGGIO ? setupCosto(T.setup_secondi.taglio * 12, co1, qta) : 0;
  // setup stampaggio = 3600s (usiamo il valore del setup tornitura normale)
  const SETUP_STAMP_S = 3600;
  const setup_stamp_fin = STAMPAGGIO
    ? setupCosto(SETUP_STAMP_S, co1, qta) : 0;

  // --- Tornitura ---
  const tempo_torn = calcolaTempoTornitura(diam, dia_disp, lungh, mat, materiale_speciale, T);
  const to_rate    = dian < 45 ? co1 : co2;
  const to_raw     = tempo_torn * to_rate;
  const to_costo   = conMinimo(to_raw, qta);
  const setup_torn = setupCosto(T.setup_secondi.tornitura_normale, co1, qta);

  // --- Fresatura ---
  const tempo_fres = calcolaTempoFresatura(mat, testa);
  const fr_raw     = tempo_fres * co1;
  const fr_costo   = conMinimo(fr_raw, qta);
  const setup_fres = setupCosto(T.setup_secondi.tornitura_normale, co1, qta); // 3600s

  // --- Rullatura ---
  const t_rull    = calcolaTempoRullatura(dian, lungh_g, passo, mat, T);
  const ru_costo  = rullaturaFin(t_rull, co1, co2, dian, qta);
  const setup_rull = setupCosto(T.setup_secondi.rullatura, co1, qta);

  // --- Marcatura ---
  const { costo: marc_fin } = calcolaMarcatura(dian, lungh, qta, co1, false);

  // --- Attrezzatura (inox / altro) ---
  const attrez = MAT_INOX.includes(mat) ? 0.6 : 0;

  // --- Bonifica ---
  // Usiamo peso_mat (spezzone se STAMP, grezzo altrimenti)
  const bonifica = calcolaBonifica(peso_mat, qta, dian, lungh, mat, T);

  // --- Totali ---
  const costo_lav = STAMPAGGIO
    ? ta_costo + st_costo + to_costo + fr_costo + ru_costo + marc_fin + attrez
      + setup_taglio + setup_stamp_fin + setup_torn + setup_fres + setup_rull
    : ta_costo + to_costo + fr_costo + ru_costo + marc_fin + attrez
      + setup_taglio + setup_torn + setup_fres + setup_rull;

  const costo_tot = mat_cost + bonifica + costo_lav;

  // --- Modificatore peso ---
  const q_peso               = qta_x > 0 ? qta_x : qta;
  const mod_peso             = getModPeso(peso_mat, q_peso, T);
  const peso_principale      = peso_mat * q_peso * mod_peso;
  const peso_principale_reale = peso_mat * q_peso;
  const peso_lotto_completo  = qta_x > 0 ? peso_mat * qta : null;

  // --- Stringa tempi per gestionale ---
  let tempi_gestionale;
  if (STAMPAGGIO) {
    tempi_gestionale =
      `TAGLI ${Math.round(ta_tempo)}\n` +
      `STAMP ${Math.round(tempo_stamp)}\n` +
      `TORN1 ${Math.round(tempo_torn)}\n` +
      `FRESA ${Math.round(tempo_fres)}\n` +
      `RULLA ${Math.round(t_rull)}\n` +
      `ATAGL ${T.setup_secondi.taglio}\n` +
      `ASTA2 ${SETUP_STAMP_S}\n` +
      `ATOR1 ${T.setup_secondi.tornitura_normale}\n` +
      `AFRES ${T.setup_secondi.tornitura_normale}\n` +
      `ARULL ${T.setup_secondi.rullatura}`;
  } else {
    tempi_gestionale =
      `TAGLI ${Math.round(ta_tempo)}\n` +
      `TORN1 ${Math.round(tempo_torn)}\n` +
      `FRESA ${Math.round(tempo_fres)}\n` +
      `RULLA ${Math.round(t_rull)}\n` +
      `ATAGL ${T.setup_secondi.taglio}\n` +
      `ATOR1 ${T.setup_secondi.tornitura_normale}\n` +
      `AFRES ${T.setup_secondi.tornitura_normale}\n` +
      `ARULL ${T.setup_secondi.rullatura}`;
  }

  return {
    // Costi
    mat_cost, bonifica, attrez,
    ta_costo, st_costo, to_costo, fr_costo, ru_costo, marc_fin,
    setup_taglio, setup_stamp: setup_stamp_fin, setup_torn, setup_fres, setup_rull,
    costo_lav, costo_tot,
    // Tempi
    ta_tempo, tempo_stamp, tempo_torn, tempo_fres, t_rull,
    // Geometria
    diam, dian, testa, foro,
    lungh_g, lungh_tot, lungh_spz,
    // Peso
    peso: peso_mat, peso_fin,
    peso_principale, peso_principale_reale, peso_lotto_completo,
    mod_peso, q_peso,
    // Flags
    STAMPAGGIO,
    // Utility
    qta, qta_x, qta_str, tipo, mat,
    messages: [],
    tempi_gestionale,
  };
}
