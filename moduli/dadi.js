// ============================================================
// moduli/dadi.js
// Logica specifica per DADI (UNI 5587, 5588, 5589)
// ============================================================

import {
  MAT_INOX,
  parseDia, getDiametroNominale, getDensita,
  calcolaPeso, getCostoMateriale,
  calcolaMarcatura,
  getModPeso, setupCosto, parseQta
} from '../lib/calcolo_comune.js';

// --- CHIAVE ESAGONALE ---------------------------------------

function getChiave(TD, dia, chiave_tipo) {
  const key = String(dia);

  // Metrici — chiave unica indipendente dal tipo
  if (TD.chiavi_metriche[key] !== undefined) {
    return TD.chiavi_metriche[key];
  }
  // Pollici — dipende dal tipo (p o l)
  if (chiave_tipo === 'l' && TD.chiavi_pollici_l[key] !== undefined) {
    return TD.chiavi_pollici_l[key];
  }
  if (TD.chiavi_pollici_p[key] !== undefined) {
    return TD.chiavi_pollici_p[key];
  }
  throw new Error(`Chiave non trovata per diametro "${dia}"`);
}

// --- ALTEZZA DADO -------------------------------------------

function getAltezza(TD, UNI, dia, dian) {
  const key = String(dia);
  if (UNI === '5587') return dian;   // alto: altezza = diam nominale
  if (UNI === '5588') {
    const v = TD.altezze_5588[key];
    if (v === undefined) throw new Error(`Altezza 5588 non trovata per M${dia}`);
    return v;
  }
  if (UNI === '5589') {
    const v = TD.altezze_5589[key];
    if (v === undefined) throw new Error(`Altezza 5589 non trovata per M${dia}`);
    return v;
  }
  throw new Error(`UNI "${UNI}" non riconosciuto`);
}

// --- TAGLIO -------------------------------------------------

function calcolaTempoTaglio(dian, mat, TD) {
  let t = null;
  for (const r of TD.tempi_taglio) {
    if (dian <= r.fino_a) { t = r.secondi; break; }
  }
  if (t === null) throw new Error(`Diametro ${dian} fuori range per taglio dadi`);
  if (mat === 'altro')            t *= 3;
  else if (MAT_INOX.includes(mat)) t *= 2;
  return t;
}

// --- TORNITURA ----------------------------------------------

function calcolaTempoTornitura(altez, dian, mat, TD) {
  const m = TD.moltiplicatori_tornitura;
  const grande = dian >= m.soglia_grande;
  let molt;
  if (mat === 'altro')            molt = grande ? m.altro_grande   : m.altro_piccolo;
  else if (MAT_INOX.includes(mat)) molt = grande ? m.inox_grande    : m.inox_piccolo;
  else                            molt = grande ? m.standard_grande : m.standard_piccolo;
  return (altez + 3) * molt;
}

// --- FRESATURA ----------------------------------------------

function calcolaTempoFresatura(altez, mat, TD) {
  const m = TD.moltiplicatori_fresatura;
  let molt;
  if (mat === 'altro')            molt = m.altro;
  else if (MAT_INOX.includes(mat)) molt = m.inox;
  else                            molt = m.standard;
  return (altez + 3) * molt;
}

// --- STAMPAGGIO ---------------------------------------------

function calcolaTempoStampaggio(dian, mat, TD) {
  let t = null;
  for (const r of TD.tempi_stampaggio) {
    if (dian <= r.fino_a) { t = r.secondi; break; }
  }
  if (t === null) throw new Error(`Diametro ${dian} fuori range per stampaggio`);
  if (mat === 'altro')            t *= 3;
  else if (MAT_INOX.includes(mat)) t *= 2;
  return t;
}

// --- PRIMA TORNITURA ----------------------------------------

function calcolaPrimaTornitura(dia_disp, spigolo, altez, dian, mat, qta, TD) {
  const diff = dia_disp - spigolo;
  const serve = diff > 5 || (diff > 4 && qta > 20);
  if (!serve) return { serve: false, tempo: 0 };

  const div = MAT_INOX.includes(mat) ? 3 : 4;
  let tempo = ((altez + 3) / div) * Math.ceil(diff / 3);
  if (mat === 'altro') tempo *= 3;
  return { serve: true, tempo };
}

// --- TRATTAMENTO TERMICO ------------------------------------

function calcolaTrattamento(peso_fin, prezzo_kg, qta, forfait, attivo) {
  if (!attivo) return 0;
  const tot = peso_fin * prezzo_kg * qta;
  return tot <= forfait ? forfait / qta : peso_fin * prezzo_kg;
}

// --- HELPER minimo lotto ------------------------------------

function conMinimo(costo, qta) {
  return costo * qta < 10 ? 10 / qta : costo;
}

// --- CALCOLO PRINCIPALE -------------------------------------

export function calcolaDadi(inputs, TC, TD) {
  const {
    UNI, dia_raw, passo, chiave_tipo,
    altez_override,
    qta_raw, qta_x,
    mat, materiale_speciale, dens_altro,
    costo_mat_override,
    dia_disp,
    STAMPAGGIO,
    TRATTAMENTO_TERMICO, prezzo_kg, forfait,
    marcatura_complessa,
  } = inputs;

  const coeff = TC.costi_base.co1;
  const co1   = coeff;

  // --- Quantità ---
  const qta = parseQta(qta_raw);
  if (isNaN(qta) || qta <= 0) throw new Error('Quantità non valida');
  const qta_str = String(qta_raw).includes('+')
    ? String(qta_raw).split('+').map(s => s.trim()).join(' + ') + ' = ' + qta
    : null;

  // --- Diametro ---
  const dia  = parseDia(dia_raw);
  const dian = getDiametroNominale(TC, dia);

  // --- Chiave e spigolo ---
  const chiave  = getChiave(TD, dia, chiave_tipo);
  const spigolo = chiave * 1.154;

  // --- Altezza ---
  const altez = (altez_override && altez_override > 0)
    ? altez_override
    : getAltezza(TD, UNI, dia, dian);

  // --- Densità ---
  const dens = getDensita(TC, mat, dens_altro);

  // --- Peso materiale grezzo (cilindro dia_disp × altez+3) ---
  const peso_grezzo = calcolaPeso(dia_disp, altez + 3, dens);

  // --- Costo materiale ---
  const costo_mat_kg = getCostoMateriale(TC, mat, costo_mat_override);

  // --- Peso materiale stampato (se STAMPAGGIO) ---
  const area_tondo = (dia_disp * dia_disp * Math.PI) / 4;
  const lato       = chiave / 1.732;
  const sviluppo   = ((lato * lato * 0.866 * 6 * altez) / 2) / area_tondo;
  const peso_stamp = calcolaPeso(dia_disp, sviluppo + 5, dens);

  const mat_cost = STAMPAGGIO
    ? peso_stamp * costo_mat_kg
    : peso_grezzo * costo_mat_kg;

  const peso = STAMPAGGIO ? peso_stamp : peso_grezzo;

  // --- Taglio ---
  const tempo_ta = calcolaTempoTaglio(dian, mat, TD);
  const ta       = conMinimo(tempo_ta * coeff, qta);
  const setup_ta = setupCosto(TD.setup_secondi.taglio, coeff, qta);

  // --- Prima tornitura (solo senza stampaggio) ---
  const pt = !STAMPAGGIO
    ? calcolaPrimaTornitura(dia_disp, spigolo, altez, dian, mat, qta, TD)
    : { serve: false, tempo: 0 };
  const pt_costo  = pt.serve ? conMinimo(pt.tempo * coeff, qta) : 0;
  const setup_pt  = pt.serve ? setupCosto(TD.setup_secondi.prima_torn, coeff, qta) : 0;

  // --- Tornitura ---
  const tempo_to = calcolaTempoTornitura(altez, dian, mat, TD);
  const to       = conMinimo(tempo_to * coeff, qta);
  const setup_to = setupCosto(TD.setup_secondi.tornitura, coeff, qta);

  // --- Fresatura (solo senza stampaggio) ---
  const tempo_fr = calcolaTempoFresatura(altez, mat, TD);
  const fr       = !STAMPAGGIO ? conMinimo(tempo_fr * coeff, qta) : 0;
  const setup_fr = !STAMPAGGIO ? setupCosto(TD.setup_secondi.fresatura, coeff, qta) : 0;

  // --- Stampaggio ---
  const tempo_st = STAMPAGGIO ? calcolaTempoStampaggio(dian, mat, TD) : 0;
  const st       = STAMPAGGIO ? conMinimo(tempo_st * coeff, qta) : 0;
  const setup_st = STAMPAGGIO ? setupCosto(TD.setup_secondi.stampaggio, coeff, qta) : 0;

  // --- Marcatura ---
  const { costo: marc_fin, setup: setup_marc, tempo: tempo_marc, tempo_setup: tempo_setup_marc } = calcolaMarcatura(dian, altez, qta, co1, marcatura_complessa);

  // --- Placchette (inox/altro) ---
  const placc = MAT_INOX.includes(mat) ? 0.6 : 0;

  // --- Peso finito (esagono - foro) per trattamento termico ---
  const peso_esa  = ((0.866 * dens * chiave ** 2) / 1000) * (altez / 1000);
  const peso_foro = (Math.PI * (dian / 2) ** 2 * (altez / 1000) * dens) / 1000;
  const peso_fin  = peso_esa - peso_foro;

  // --- Trattamento termico ---
  const tratta = calcolaTrattamento(peso_fin, prezzo_kg, qta, forfait, TRATTAMENTO_TERMICO);

  // --- Totali ---
  let costo_lav, setup_tot;
  if (STAMPAGGIO) {
    costo_lav = tratta + ta + st + to + marc_fin + setup_marc + placc;
    setup_tot = setup_ta + setup_st + setup_to;
  } else {
    costo_lav = tratta + ta + pt_costo + to + fr + marc_fin + setup_marc + placc;
    setup_tot = setup_ta + setup_pt + setup_to + setup_fr;
  }
  const costo_tot = mat_cost + costo_lav + setup_tot;

  // --- Modificatore peso ---
  const q_peso              = qta_x > 0 ? qta_x : qta;
  const mod_peso            = getModPeso(peso, q_peso, TC);
  const peso_principale     = peso * q_peso * mod_peso;
  const peso_principale_reale = peso * q_peso;
  const peso_lotto_completo = qta_x > 0 ? peso * qta : null;

  // --- Stringa tempi per gestionale ---
  const riga_mat = `\u20AC ${costo_tot.toFixed(2)} - da mat. ${mat} \u00D8 ${dia_disp.toFixed(1)} mm, ${peso_principale_reale.toFixed(2)} kg`;
  let tempi_gestionale;
  if (STAMPAGGIO) {
    tempi_gestionale =
      riga_mat + '\n' +
      `TAGLI ${Math.round(tempo_ta)}\n` +
      `STAM2 ${Math.round(tempo_st)}\n` +
      `TORN1 ${Math.round(tempo_to)}\n` +
      `MARCA ${tempo_marc}\n` +
      `ATAGL ${TD.setup_secondi.taglio}\n` +
      `ASTA2 ${TD.setup_secondi.stampaggio}\n` +
      `ATOR1 ${TD.setup_secondi.tornitura}\n` +
      `AMARC ${tempo_setup_marc}`;
  } else {
    tempi_gestionale =
      riga_mat + '\n' +
      (pt.serve ? `TORN2 ${Math.round(pt.tempo)}\n` : '') +
      `TAGLI ${Math.round(tempo_ta)}\n` +
      `TORN1 ${Math.round(tempo_to)}\n` +
      `FRESA ${Math.round(tempo_fr)}\n` +
      `MARCA ${tempo_marc}\n` +
      (pt.serve ? `ATOR2 ${TD.setup_secondi.prima_torn}\n` : '') +
      `ATAGL ${TD.setup_secondi.taglio}\n` +
      `ATOR1 ${TD.setup_secondi.tornitura}\n` +
      `AFRES ${TD.setup_secondi.fresatura}\n` +
      `AMARC ${tempo_setup_marc}`;
  }

  return {
    // Costi
    mat_cost, tratta, placc,
    ta, pt_costo, to, fr, st, marc_fin, setup_marc,
    setup_ta, setup_pt, setup_to, setup_fr, setup_st,
    costo_lav, setup_tot, costo_tot,
    // Tempi
    tempo_ta, tempo_to, tempo_fr, tempo_st,
    tempo_marc, tempo_setup_marc,
    pt_tempo: pt.tempo, pt_serve: pt.serve,
    // Geometria
    dian, chiave, spigolo, altez,
    // Peso
    peso, peso_fin, peso_principale, peso_principale_reale, peso_lotto_completo,
    mod_peso, q_peso,
    // Flags
    STAMPAGGIO, TRATTAMENTO_TERMICO,
    // Utility
    qta, qta_x, qta_str, mat,
    tempi_gestionale,
  };
}
