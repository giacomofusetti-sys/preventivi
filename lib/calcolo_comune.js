// ============================================================
// calcolo_comune.js
// Funzioni condivise da tutti i moduli di calcolo.
// Riceve i dati da comune.json (passato come oggetto T).
// ============================================================

// NOTA: nonostante il nome, MAT_INOX rappresenta i "materiali
// difficili" (inox + superleghe 'altro'), usati per selezionare
// tabelle tempo più lente in smusso, rullatura, tornitura,
// fresatura, raddrizzatura, brocciatura ecc.
// Se una lavorazione deve distinguere inox e 'altro' (es.
// calcolaSbavatura), va gestita con logica esplicita nel punto
// d'uso. Non rimuovere 'altro' senza un refactor globale.
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
  const n = parseExpr(dia_raw);
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

export function calcolaTempoTaglio(dian, mat) {
  const SOGLIA = 61.30;
  const isInox  = MAT_INOX.includes(mat) && mat !== 'altro';
  const isAltro = mat === 'altro';

  if (dian <= SOGLIA) {
    if (isInox)       return dian / 2 * 1.35;
    else if (isAltro) return dian;
    else              return dian / 2;  // acciai al carbonio
  } else {
    if (isInox)       return dian * 2;
    else if (isAltro) return dian * 4;
    else              return dian;
  }
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

// --- PARSE ESPRESSIONE MATEMATICA ---------------------------
// Parser sicuro per espressioni con +, -, *, /, parentesi.
// Accetta anche numeri semplici e virgole come separatore decimale.
// NON usa eval().

export function parseExpr(raw) {
  const s = String(raw).replace(/,/g, '.').replace(/\s+/g, '').trim();
  if (s === '') return NaN;
  // Numero semplice: scorciatoia
  const simple = Number(s);
  if (!isNaN(simple) && !/[+\-*/()]/.test(s.slice(1))) return simple;
  // Tokenizer
  const tokens = [];
  const re = /(\d+\.?\d*|\.\d+|[+\-*/()])/g;
  let m, last = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index !== last) return NaN; // caratteri non validi
    tokens.push(m[0]);
    last = re.lastIndex;
  }
  if (last !== s.length) return NaN;
  let pos = 0;
  function peek() { return tokens[pos]; }
  function next() { return tokens[pos++]; }
  // expr = term (('+' | '-') term)*
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  // term = factor (('*' | '/') factor)*
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  // factor = '(' expr ')' | number | unary-minus
  function factor() {
    if (peek() === '(') {
      next(); // '('
      const v = expr();
      if (next() !== ')') return NaN;
      return v;
    }
    if (peek() === '-') {
      next();
      return -factor();
    }
    const t = next();
    if (t === undefined) return NaN;
    const n = Number(t);
    if (isNaN(n)) return NaN;
    return n;
  }
  const result = expr();
  if (pos !== tokens.length) return NaN;
  return result;
}

// --- PARSE QTÀ (es. "300+240+850") -------------------------

export function parseQta(raw) {
  const s = String(raw).trim();
  if (!/^[\d\s+]+$/.test(s)) return NaN;
  const parts = s.split('+').map(p => parseInt(p.trim(), 10));
  if (parts.some(isNaN)) return NaN;
  return parts.reduce((a, b) => a + b, 0);
}

// --- DEGRADO OPERATORE --------------------------------------

/**
 * Applica il degrado di performance dell'operatore al tempo/pezzo di una
 * lavorazione ripetitiva (es. stampaggio, rullatura).
 *
 * Curva "lineare": la performance cala linearmente da 1 (inizio turno) a
 * (1 + degrado_massimo) (fine turno). Il fattore istantaneo è:
 *     f(t) = 1 + degrado_massimo * (t / T_turno)
 * Integrando su un lotto di durata D si ottiene il tempo totale.
 *
 *  - Se D ≤ T_turno:
 *       tempo_totale = D * (1 + (degrado_massimo / 2) * (D / T_turno))
 *  - Se D > T_turno: ogni turno completo riparte da zero (operatore
 *       riposato a inizio turno). Ciascun turno completo contribuisce
 *       con fattore medio (1 + degrado_max/2); l'ultimo turno parziale
 *       si integra normalmente.
 *
 * La formula del caso D > T_turno è una generalizzazione del caso
 * sotto soglia: con 0 turni completi il contributo turni è 0 e il
 * residuo coincide con l'intero lotto, riproducendo esattamente il
 * primo ramo.
 *
 * Estendibilità: oggi è supportato solo `tipo_curva = "lineare"`. Per
 * aggiungere in futuro curve diverse (es. "quadratica") basta aggiungere
 * un nuovo ramo nello switch sotto. Un valore non riconosciuto lancia
 * un errore esplicito.
 *
 * @param {number} tempoSecondiPerPezzo - Tempo standard della singola operazione (s).
 * @param {number} quantita - Numero di pezzi del lotto.
 * @param {object} T - Oggetto caricato da comune.json (legge T.degrado_operatore).
 * @returns {number} Nuovo tempo/pezzo comprensivo di degrado (s).
 */
export function applicaDegradoOperatore(tempoSecondiPerPezzo, quantita, T) {
  const { tipo_curva, degrado_massimo, durata_turno_ore } = T.degrado_operatore;

  if (tipo_curva !== 'lineare') {
    throw new Error(`tipo_curva non supportato: ${tipo_curva}`);
  }

  const T_turno_sec = durata_turno_ore * 3600;
  const durataLottoSec = tempoSecondiPerPezzo * quantita;

  // Quanti turni interi entrano e quanto tempo avanza
  const turniCompleti = Math.floor(durataLottoSec / T_turno_sec);
  const tempoResiduoSec = durataLottoSec - turniCompleti * T_turno_sec;

  // Contributo dei turni interi: ciascuno ha fattore medio (1 + degrado_max/2)
  const contributoTurniCompleti =
    turniCompleti * T_turno_sec * (1 + degrado_massimo / 2);

  // Contributo del turno parziale finale: integrale da 0 a tempoResiduoSec
  const rapporto = tempoResiduoSec / T_turno_sec;
  const fattoreMedioResiduo = 1 + (degrado_massimo / 2) * rapporto;
  const contributoResiduo = tempoResiduoSec * fattoreMedioResiduo;

  const tempoTotaleConDegradoSec = contributoTurniCompleti + contributoResiduo;

  return tempoTotaleConDegradoSec / quantita;
}