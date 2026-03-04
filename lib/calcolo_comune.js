// ============================================================
// calcolo_comune.js
// Funzioni condivise da tutti i moduli di calcolo.
// Riceve i dati da comune.json (passato come oggetto T).
// ============================================================

// Materiali che si comportano come inox/inossidabile nei calcoli
// (tempi più lunghi, nessuna troncatrice, attrezzatura extra).
export const MAT_INOX = ['inox', 'AISI 304', 'AISI 316', 'B8 cl.2', 'B8M cl.2', 'altro'];

// --- DIAMETRI -----------------------------------------------

export function getDiametroMedio(T, dia, passo) {
  const metrici = T.diametri_medi_metrici[String(dia)];
  if (metrici) {
    const v = metrici[passo] ?? metrici['G'] ?? metrici['F'];
    if (v === undefined) throw new Error(`Passo "${passo}" non disponibile per M${dia}`);
    return v;
  }
  const pollici = T.diametri_medi_pollici[String(dia)];
  if (pollici) {
    const v = pollici[passo];
    if (v === undefined) throw new Error(`Combinazione ${dia} / ${passo} non disponibile`);
    return v;
  }
  throw new Error(`Diametro "${dia}" non trovato nelle tabelle`);
}

export function getDiametroNominale(T, dia) {
  // Se è un numero metrico, il nominale coincide con il diametro stesso
  if (T.diametri_medi_metrici[String(dia)]) return parseFloat(dia);
  const v = T.diametri_nominali_pollici[String(dia)];
  if (v === undefined) throw new Error(`Diametro nominale non trovato per "${dia}"`);
  return v;
}

export function parseDia(dia_raw) {
  // Restituisce la chiave giusta (stringa per pollici, numero per metrici)
  const CODICI_POLLICI = new Set([
    '5/16','3/8','7/16','1/2','9/16','5/8','3/4','7/8',
    '1000','1108','1104','1308','1102','1508','1304',
    '1708','2000','2104','2102','2304','3000','3104'
  ]);
  if (CODICI_POLLICI.has(String(dia_raw))) return String(dia_raw);
  const n = parseFloat(dia_raw);
  if (isNaN(n)) throw new Error(`Diametro non riconosciuto: ${dia_raw}`);
  return n;
}

// --- DENSITÀ ------------------------------------------------

export function getDensita(T, mat, dens_altro = 7.85) {
  const d = T.densita[mat];
  if (d === null) return dens_altro;   // "altro" → valore utente
  if (d === undefined) throw new Error(`Materiale "${mat}" non trovato`);
  return d;
}

// --- PESO ---------------------------------------------------

export function calcolaPeso(diam_mm, lungh_mm, densita_gcm3) {
  return ((Math.PI * (diam_mm / 2) ** 2 * lungh_mm) / 1e6) * densita_gcm3;
}

// --- COSTO MATERIALE ----------------------------------------

export function getCostoMateriale(T, mat, override = null) {
  // override = valore inserito dall'utente nel campo
  if (override !== null && override > 0) return override;
  const c = T.costi_materiali[mat];
  if (c === undefined) throw new Error(`Costo materiale non trovato per "${mat}"`);
  return c;
}

// --- TAGLIO -------------------------------------------------

export function calcolaTempoTaglio(dian, lungh, mat, materiale_speciale, T) {
  const AVANZ_TRONC = 2;

  function avanzSeghetto(lungh) {
    return Math.round(10 + Math.max(0, (lungh - 100) * 0.05));
  }

  function taSeghetto(dian, lungh, mat, materiale_speciale) {
    const T_ref = 25, D_ref = 16;
    let k;
    const std = ['B7', 'B7M', '42CD4', 'L7', 'B16'];
    if (MAT_INOX.includes(mat) && mat !== 'altro') {
      k = 1.0;
    } else if (std.includes(mat)) {
      k = 0.85;
      if (dian < 45 && lungh < 350) return null; // usa troncatrice
    } else if (mat === 'altro') {
      k = T.materiali_speciali_k[materiale_speciale];
      if (!k) throw new Error(`Specifica un materiale_speciale valido per "altro" (F53, 660, 718)`);
    } else {
      throw new Error(`Materiale "${mat}" non ammesso nel taglio`);
    }
    return Math.round(T_ref * (dian ** 2 / D_ref ** 2) * k * 10) / 10;
  }

  function taTronc(dian) {
    if (dian <= 12) return 4;
    if (dian <= 22) return 5;
    if (dian <= 30) return 6;
    if (dian <= 33) return 7;
    if (dian <= 36) return 8;
    if (dian <= 39) return 9;
    if (dian <= 44) return 10;
    return 12;
  }

  const ts = taSeghetto(dian, lungh, mat, materiale_speciale);
  return ts !== null
    ? ts + avanzSeghetto(lungh)
    : taTronc(dian) + AVANZ_TRONC;
}

export function modulaCostoTaglio(ta_raw, qta, mat, costo_mat_kg, peso) {
  const messages = [];
  let ta = ta_raw;
  if (qta > 10) {
    const limite = qta <= 20 ? 2.00 : 1.00;
    if (mat !== 'altro') {
      if (ta_raw > limite) messages.push(`💡 Taglio limitato a ${limite}€ (qta=${qta})`);
      ta = Math.min(ta_raw, limite);
    } else {
      ta = Math.min(ta_raw, ta_raw / 2);
    }
  }
  return { ta, messages };
}

export function taglioFin(ta, qta) {
  return ta * qta < 10 ? 10 / qta : ta;
}

// --- SMUSSO -------------------------------------------------

export function calcolaTempoSmusso(dian, lungh, mat, T) {
  const tiers = MAT_INOX.includes(mat)
    ? T.smusso.inox_altro
    : T.smusso.standard;

  let base = null;
  for (const r of tiers) {
    if (dian <= r.fino_a) { base = r.secondi; break; }
  }
  if (base === null) throw new Error(`Diametro ${dian} fuori range per smusso`);

  let mult = 1;
  for (const r of T.smusso.moltiplicatori_lunghezza) {
    if (lungh >= r.da && lungh < r.a) { mult = r.mult; break; }
  }
  return base * mult;
}

export function smussoCosto(tempo_s, dian, co1, co2) {
  return tempo_s * (dian < 56 ? co1 : co2);
}

export function smussoFin(sm, qta) {
  return sm * qta < 10 ? 10 / qta : sm;
}

// --- RULLATURA ----------------------------------------------

export function calcolaTempoRullatura(dian, lung_fil, passo, mat, T) {
  const tiers = MAT_INOX.includes(mat)
    ? T.rullatura.inox_altro
    : T.rullatura.standard;

  let t = null;
  for (const r of tiers) {
    if (dian <= r.fino_a) { t = lung_fil / r.divisore; break; }
  }
  if (t === null) throw new Error(`Diametro ${dian} fuori range per rullatura`);

  if (passo === 'F' || passo === 'UNF') t *= 1.2;

  // Minimi
  for (const r of T.rullatura.minimi) {
    if (dian >= r.dian_da && dian < r.dian_a) {
      t = Math.max(t, r.minimo); break;
    }
  }
  return t;
}

export function rullaturaFin(t_rull, co1, co2, dian, qta) {
  const ru = t_rull * (dian < 45 ? co1 : co2);
  return ru * qta < 10 ? 10 / qta : ru;
}

// --- MARCATURA ----------------------------------------------

export function calcolaMarcatura(dian, lungh, qta, co1, marcatura_complessa) {
  const tempo       = marcatura_complessa ? 50 : (lungh <= 300 ? 10 : 20);
  const tempo_setup = marcatura_complessa ? 600 : 150;
  const costo_raw   = tempo * co1;
  const setup       = (tempo_setup * co1) / qta;
  const costo       = (costo_raw + setup) * qta < 10 ? 10 / qta - setup : costo_raw;
  return { costo, setup, tempo, tempo_setup };
}

// --- BONIFICA -----------------------------------------------

export function calcolaBonifica(peso, qta, dian, lungh, mat, T) {
  if (mat !== '42CD4') return 0;
  // Valori assoluti Python: 1.20 / 1.45 / 1.50 / 1.60, minimi lotto 400 / 420 / 400 / 420
  let mult, minimo;
  if (dian <= 42 && lungh <= dian * 10) { mult = 1.20; minimo = 400; }
  else if (dian <= 42)                  { mult = 1.45; minimo = 420; }
  else if (lungh <= dian * 10)          { mult = 1.50; minimo = 400; }
  else                                  { mult = 1.60; minimo = 420; }
  const tot = peso * mult * qta;
  return tot < minimo ? minimo / qta : peso * mult;
}

// --- MODIFICATORE PESO --------------------------------------

export function getModPeso(peso, q, T) {
  const totale = peso * q;
  for (const r of T.modificatore_peso) {
    if (totale >= r.totale_da) return r.coefficiente;
  }
  return 1.09;
}

// --- SETUP (approntamento) ----------------------------------

export function setupCosto(secondi, co1, qta) {
  return (secondi * co1) / qta;
}

// --- PARSE QTÀ (es. "300+240+850") -------------------------

export function parseQta(raw) {
  const s = String(raw).trim();
  if (!/^[\d\s+]+$/.test(s)) return NaN;
  const parts = s.split('+').map(p => parseInt(p.trim(), 10));
  if (parts.some(isNaN)) return NaN;
  return parts.reduce((a, b) => a + b, 0);
}