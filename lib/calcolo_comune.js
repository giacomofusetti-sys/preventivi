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

// --- TORNITURA A CONTROLLO NUMERICO (G96) -------------------

/**
 * Tempo di tornitura a controllo numerico di una zona cilindrica, da
 * diametro grezzo a diametro target, in secondi.
 *
 * Il controllo numerico lavora in G96 (velocità di taglio Vc costante):
 * a ogni passata il diametro cambia e con esso il regime di giri
 * n = (Vc·1000) / (π·D). Il tempo per passata è quindi
 *     Tc_min = L / (f · n)
 * dove f è l'avanzamento per giro (mm/giro) e L la lunghezza tornita.
 *
 * L'asportazione avviene per passate da `riduzione_diametro` mm
 * (riferita al diametro, quindi profondità radiale = riduzione/2).
 * L'ultima passata si ferma sul diametro target — può essere più
 * sottile delle precedenti.
 *
 * Parametri Vc / f / riduzione_diametro sono letti da
 *   T.tornitura_controllo.parametri_per_materiale[chiave]
 * dove `chiave` è `mat`, oppure `materiale_speciale` se mat === 'altro'.
 * Lancia Error esplicito se la chiave non è in tabella.
 *
 * Nessun moltiplicatore `materiali_speciali_k` è applicato qui: il
 * rallentamento per materiali difficili è già codificato nei Vc/f
 * di quel materiale.
 *
 * @param {number} D_grezzo - Diametro di partenza della barra (mm).
 * @param {number} D_target - Diametro finito dopo tornitura (mm).
 * @param {number} L - Lunghezza da tornire (mm).
 * @param {string} mat - Materiale principale (chiave in parametri_per_materiale, o 'altro').
 * @param {string} materiale_speciale - Usato solo se mat === 'altro'.
 * @param {object} T - Oggetto comune.json.
 * @returns {number} Tempo tornitura in secondi (0 se D_grezzo <= D_target).
 */
export function tempoTornituraBase(D_grezzo, D_target, L, mat, materiale_speciale, T) {
  if (D_grezzo <= D_target) return 0;

  const chiave = mat === 'altro' ? materiale_speciale : mat;
  const p = T.tornitura_controllo?.parametri_per_materiale?.[chiave];
  if (!p) {
    throw new Error(`Parametri tornitura_controllo non trovati per "${chiave}"`);
  }
  const { Vc, f, riduzione_diametro } = p;

  let tempo_min = 0;
  let D_corrente = D_grezzo;
  while (D_corrente > D_target) {
    D_corrente = Math.max(D_target, D_corrente - riduzione_diametro);
    const n_rpm = (Vc * 1000) / (Math.PI * D_corrente);
    tempo_min += L / (f * n_rpm);
  }
  return tempo_min * 60;
}

/**
 * Tempo di una sfacciatura (intestazione o sottotesta), in secondi.
 *
 * Formula: `((raggio + 5) / v_avanzamento) · 60 + 3`, dove
 *     v_avanzamento_mm_per_min = giri_intestazione · f_intestazione
 *
 *  - il +5 mm è sovrapercorso utensile (entrata + uscita oltre il bordo);
 *  - il +3 s è tempo morto di approccio/distacco utensile;
 *  - `f_intestazione` (mm/giro) è specifico del materiale ed è letto
 *    da T.tornitura_controllo.parametri_per_materiale[chiave];
 *  - `giri_intestazione` (rpm) è letto da T.tornitura_controllo ed è
 *    oggi costante (1000 rpm) per tutti i materiali. Se in futuro
 *    servirà variabile per materiale, basta spostarlo dentro
 *    parametri_per_materiale.
 *
 * Nota storica: la formula originale era `((r+5)/100)·60 + 3`; il "100"
 * equivaleva a 1000 rpm · 0.10 mm/giro, ovvero la combinazione di oggi
 * per gli acciai al carbonio. Con la nuova versione il valore scala
 * col materiale (inox ~0.09, superleghe ~0.07).
 *
 * La risoluzione della chiave è identica a `tempoTornituraBase`:
 * mat === 'altro' → usa materiale_speciale, altrimenti mat.
 * Lancia Error esplicito se la chiave non è in tabella.
 *
 * @param {number} raggio_mm - Raggio da sfacciare (mm).
 * @param {string} mat - Materiale principale (o 'altro').
 * @param {string} materiale_speciale - Usato solo se mat === 'altro'.
 * @param {object} T - Oggetto comune.json.
 * @returns {number} Tempo sfacciatura in secondi.
 */
export function tempoSfacciatura(raggio_mm, mat, materiale_speciale, T) {
  const chiave = mat === 'altro' ? materiale_speciale : mat;
  const p = T.tornitura_controllo?.parametri_per_materiale?.[chiave];
  if (!p) {
    throw new Error(`Parametri tornitura_controllo non trovati per "${chiave}"`);
  }
  const giri = T.tornitura_controllo.giri_intestazione;
  const v_avanzamento = giri * p.f_intestazione; // mm/min
  return ((raggio_mm + 5) / v_avanzamento) * 60 + 3;
}

/**
 * Tempo totale di movimentazione del pezzo durante la tornitura, in secondi.
 *
 * La tabella `T.tornitura_controllo.movimentazione_per_peso` fornisce i
 * secondi per singolo gesto in funzione del peso grezzo del pezzo. Le
 * soglie sono inclusive dell'estremo superiore (`fino_a_kg: null` indica
 * l'ultima fascia "oltre soglia"). `num_gesti` moltiplica il tempo base:
 *
 *  - viti:                      ×1 (carico/scarico sul caricatore)
 *  - tiranti/prigionieri torniti non-fantina: ×3
 *    (carico barra + giro per seconda estremità + scarico)
 *
 * @param {number} peso_grezzo_kg - Peso grezzo del pezzo (kg).
 * @param {number} num_gesti - Numero di gesti di movimentazione.
 * @param {object} T - Oggetto comune.json.
 * @returns {number} Tempo movimentazione totale in secondi (0 se num_gesti <= 0).
 */
export function tempoMovimentazione(peso_grezzo_kg, num_gesti, T) {
  if (num_gesti <= 0) return 0;
  const tabella = T.tornitura_controllo.movimentazione_per_peso;
  for (const r of tabella) {
    if (r.fino_a_kg === null || peso_grezzo_kg <= r.fino_a_kg) {
      return r.secondi * num_gesti;
    }
  }
  return 0;
}

// --- FANTINA ------------------------------------------------

// Lista interna dei carbonio per la fantina. Coerente con il campo
// _materiali_inclusi della categoria "carbonio" in comune.json. Tenuta
// locale (non export) perché serve solo a tempoFantina; eventuali
// allineamenti futuri tra liste vivono qui e in comune.json (entrambe
// devono restare sincronizzate).
const MAT_STANDARD_FANTINA = ['42CD4', 'B16', 'B7', 'L7', 'B7M', 'A105'];

/**
 * Tempo macchina di lavorazione fantina per un singolo pezzo, in secondi.
 *
 * La fantina è un tornio semiautomatico con caricatore automatico, che
 * esegue taglio + tornitura (e talvolta intestatura) in un unico ciclo
 * a passaggio pezzo. Tipicamente usata per tiranti e prigionieri lunghi,
 * dove il volume fa premiare la velocità di passaggio rispetto alla
 * precisione del CN.
 *
 * MODELLO
 * -------
 * Per i materiali "carbonio" e "inox" il modello è LINEARE in lunghezza:
 *     tempo = base_sec + pendenza_sec_per_mm · L
 * Parametri calibrati su 24 punti raccolti in officina (ottobre 2025).
 * I residui sono ±2÷3s sui prigionieri, fino a ±10s sui tiranti — la
 * dispersione è ritenuta accettabile come "rumore" del dataset.
 *
 * Per i materiali "altro" (superleghe: 660, 718, F51, 625, Nitronic) il
 * modello di riferimento è PROPORZIONALE in lunghezza, calibrato sul 660:
 *     tempo_660 = 1.35 · L
 * La scelta del modello proporzionale (senza base_sec) è intenzionale:
 * il dataset 660 contiene solo 3 punti tutti su L=90/100/110mm, quindi
 * non c'è informazione affidabile per stimare la base. Forzare un
 * modello con base produrrebbe estrapolazioni assurde per L piccole.
 * Per gli altri materiali "altro" lo scaling avviene moltiplicando
 * per il rapporto materiali_speciali_k[mat_speciale] / materiali_speciali_k['660']
 * (esempio: F51 → 5/6 del tempo 660).
 *
 * RITORNO
 * -------
 * Restituisce SOLO il tempo macchina di un pezzo singolo, in secondi.
 * NON include:
 *   - il setup (gestito dal modulo chiamante come setup_secondi.tornitura_fantina);
 *   - movimentazione esterna (la fantina ha caricatore, non si applica
 *     tempoMovimentazione);
 *   - minimo 90s del CN (questo modello è calibrato su tempi reali
 *     fantina, non riusa il minimo del CN);
 *   - minimo 10€/lotto (è una regola del modulo chiamante, non della funzione).
 * In sintesi: chi sei tra sei mesi e leggi questa funzione, NON aggiungere
 * Math.max(..., 90) né tempoMovimentazione né altri minimi qui dentro.
 * Vivono altrove — di proposito.
 *
 * @param {number} lungh - Lunghezza pezzo (mm). Deve essere > 0.
 * @param {string} mat - Materiale principale del pezzo. Riconosciuto se in
 *   MAT_STANDARD_FANTINA (carbonio), MAT_INOX (inox), o === 'altro' (superlega).
 * @param {string} materiale_speciale - Solo se mat === 'altro': identifica
 *   la specifica superlega (660, 718, F51, 625, Nitronic). Deve essere
 *   chiave di T.materiali_speciali_k.
 * @param {object} T - Oggetto comune.json (legge T.fantina e T.materiali_speciali_k).
 * @returns {number} Tempo fantina in secondi per pezzo singolo.
 */
export function tempoFantina(lungh, mat, materiale_speciale, T) {
  if (!(lungh > 0)) {
    throw new Error(`tempoFantina: lungh deve essere > 0, ricevuto ${lungh}`);
  }

  // Classificazione materiale.
  // ATTENZIONE: 'altro' va intercettato PRIMA del check su MAT_INOX, perché
  // MAT_INOX include 'altro' come marker di "materiali difficili".
  let categoria;
  if (mat === 'altro')                          categoria = 'altro';
  else if (MAT_STANDARD_FANTINA.includes(mat))  categoria = 'carbonio';
  else if (MAT_INOX.includes(mat))              categoria = 'inox';
  else throw new Error(`Materiale "${mat}" non classificabile per fantina`);

  // Carbonio / inox: modello lineare base + pendenza · L
  if (categoria === 'carbonio' || categoria === 'inox') {
    const p = T.fantina.parametri_per_categoria[categoria];
    return p.base_sec + p.pendenza_sec_per_mm * lungh;
  }

  // 'altro' (superleghe): proporzionale, calibrato su 660; scaling
  // via rapporto materiali_speciali_k[mat_spec] / materiali_speciali_k['660'].
  if (!materiale_speciale || !(materiale_speciale in T.materiali_speciali_k)) {
    const validi = Object.keys(T.materiali_speciali_k).join(', ');
    throw new Error(
      `tempoFantina: per mat='altro' serve materiale_speciale tra: ${validi}. Ricevuto: ${materiale_speciale ?? '(non specificato)'}`
    );
  }
  const p660 = T.fantina.parametri_per_categoria.altro_660;
  const tempo_660 = p660.pendenza_sec_per_mm * lungh;
  if (materiale_speciale === '660') return tempo_660;

  const k_target = T.materiali_speciali_k[materiale_speciale];
  const k_660    = T.materiali_speciali_k['660'];
  return tempo_660 * (k_target / k_660);
}

// --- FRESATURA ----------------------------------------------

/**
 * Sceglie la fascia "altro" del moltiplicatore fresatura in base al
 * predittore di lavorazione.
 *   - lavorazione='cava': il predittore è ch_x_mm. Le soglie di fascia
 *     sono native nel campo ch_x_max di ciascuna fascia.
 *   - lavorazione='testa': il predittore è chiave_mm. Le 4 fasce vengono
 *     re-mappate sulle soglie testa_chiave_soglie.soglie_chiave (3 valori
 *     + un 4° null implicito per "tutto oltre").
 * In entrambi i casi, l'iterazione cerca la prima fascia con limite ≥
 * predittore (limite null = match catch-all).
 *
 * @private
 */
function getFasciaAltro(materiale_speciale, T, lavorazione, predittore_mm) {
  const M = T.fresatura.moltiplicatori_materiale.altro;
  const fasce = M.fasce_per_materiale[materiale_speciale];
  if (!fasce) {
    throw new Error(
      `Materiale speciale "${materiale_speciale}" non in tabella fresatura. Validi: ${Object.keys(M.fasce_per_materiale).join(', ')}`
    );
  }

  // Soglie max per fascia in base alla lavorazione
  let soglie_max;
  if (lavorazione === 'testa') {
    // Re-map: 3 soglie esplicite + 1 null implicito (tutto oltre)
    soglie_max = [...M.testa_chiave_soglie.soglie_chiave, null];
  } else if (lavorazione === 'cava') {
    soglie_max = fasce.map(f => f.ch_x_max);
  } else {
    throw new Error(`Lavorazione "${lavorazione}" non riconosciuta (atteso 'cava' o 'testa')`);
  }

  for (let i = 0; i < fasce.length; i++) {
    const limite = soglie_max[i];
    if (limite === null || predittore_mm <= limite) {
      return fasce[i].k;
    }
  }
  // Per sicurezza, se nessuna fascia matcha, usa l'ultima (caso null).
  return fasce[fasce.length - 1].k;
}

/**
 * Risolve il moltiplicatore materiale per la fresatura.
 * Stessa convenzione di classificazione di tempoFantina:
 *   - 'altro' va intercettato PRIMA del check su MAT_INOX
 *   - lista carbonio = MAT_STANDARD_FANTINA (dichiarata sopra)
 *
 * Per i materiali 'altro', il moltiplicatore non è costante ma viene
 * scelto a fasce in base al predittore della lavorazione (delegato a
 * getFasciaAltro).
 *
 * @private
 */
function getMoltiplicatoreFresatura(mat, materiale_speciale, T, lavorazione, predittore_mm) {
  const M = T.fresatura.moltiplicatori_materiale;
  if (mat === 'altro') {
    if (!materiale_speciale) {
      throw new Error(
        `Materiale speciale richiesto per mat='altro' su fresatura. Materiali validi: ${Object.keys(M.altro.fasce_per_materiale).join(', ')}`
      );
    }
    return getFasciaAltro(materiale_speciale, T, lavorazione, predittore_mm);
  }
  if (MAT_STANDARD_FANTINA.includes(mat)) return M.carbonio;
  if (MAT_INOX.includes(mat))             return M.inox;
  throw new Error(`Materiale "${mat}" non classificabile per fresatura`);
}

/**
 * Tempo di fresatura della cava esagonale interna (5931 TCEI o speciale
 * con sub='tcei'), in secondi.
 *
 * MODELLO
 * -------
 * Lineare nel predittore ch_x_mm (dimensione chiave esagono incassato):
 *     base_carbonio = T.fresatura.cava_5931.base_sec + pendenza · ch_x_mm
 *     tempo = base_carbonio · moltiplicatore_materiale
 * Parametri calibrati su 27 punti carbonio+inox (Excel
 * FRESATURA_CAVA-FORCHETTA, ottobre 2025; esclusi 6 LEGHE e 1 outlier
 * A2 M24). Errore medio ~17-18s.
 *
 * Il moltiplicatore per carbonio (1.0) e inox (1.1) è costante. Per i
 * materiali 'altro' è una TABELLA A FASCE indicizzata sul predittore
 * (ch_x per cava, chiave per testa) — vedi
 * T.fresatura.moltiplicatori_materiale.altro per i valori. La crescita
 * per fasce riflette il fenomeno fisico per cui la difficoltà di
 * lavorazione delle superleghe cresce con la dimensione del pezzo
 * (passate piccole, calore, usura utensile).
 *
 * LIMITE DEL MODELLO: la fascia più alta (oltre ch_x=20 per cava, oltre
 * chiave=55 per testa) usa un singolo moltiplicatore costante. Su pezzi
 * molto grandi (M36+) il vero moltiplicatore potrebbe essere superiore,
 * ma con i dati attuali (un solo punto di ancoraggio a ch_x=22 per il
 * 660) non è possibile modellare ulteriormente. Quando arriveranno dati
 * su M36+ in materiali altro, valutare l'aggiunta di una 5° fascia.
 *
 * Il minimo T.fresatura._minimo_secondi (= 90) è applicato come
 * ultimo step, dopo il moltiplicatore.
 *
 * RITORNO
 * -------
 * Tempo macchina di un pezzo singolo, secondi. Include il minimo 90s.
 * NON include setup, costo orario, minimo €/lotto. Quelle responsabilità
 * vivono nel modulo chiamante. Chi sei tra sei mesi e leggi questa
 * funzione, NON aggiungere setup né minimo € qui dentro.
 *
 * @param {number} ch_x_mm - Dimensione chiave esagono incassato (mm). Deve essere > 0.
 * @param {string} mat - Materiale principale del pezzo (carbonio, inox, o 'altro').
 * @param {string} materiale_speciale - Solo se mat === 'altro': identifica
 *   la specifica superlega (660, F51, 718, 625, Nitronic).
 * @param {object} T - Oggetto comune.json (legge T.fresatura).
 * @returns {number} Tempo fresatura cava in secondi (≥ 90).
 */
export function tempoFresaturaCava(ch_x_mm, mat, materiale_speciale, T) {
  if (!(ch_x_mm > 0)) {
    throw new Error(`tempoFresaturaCava: ch_x_mm deve essere > 0, ricevuto ${ch_x_mm}`);
  }
  const p = T.fresatura.cava_5931;
  const tempo_base = p.base_sec + p.pendenza_sec_per_mm * ch_x_mm;
  const k = getMoltiplicatoreFresatura(mat, materiale_speciale, T, 'cava', ch_x_mm);
  const tempo = tempo_base * k;
  const min = T.fresatura._minimo_secondi;
  return Math.max(tempo, min);
}

/**
 * Tempo di fresatura della testa esagonale (5737/5739 con FRESA, e
 * vite speciale con sub='esagonale'/'quadrata'/'prismatica'/'troncopiramidale'),
 * in secondi.
 *
 * MODELLO
 * -------
 * Lineare nel predittore chiave_mm (dimensione chiave esagono testa,
 * o lato/diagonale per le sotto-forme con facce piane):
 *     base_carbonio = T.fresatura.testa_esagonale.base_sec + pendenza · chiave_mm
 *     tempo = base_carbonio · moltiplicatore_materiale
 * Calibrazione: 8 punti carbonio LEGATO da chiave 27-70mm (Excel
 * FRESATURA_CAVA-TE, ottobre 2025). Errore medio ~14s.
 *
 * Il moltiplicatore per carbonio (1.0) e inox (1.1) è costante. Per i
 * materiali 'altro' è una TABELLA A FASCE indicizzata sul predittore
 * (ch_x per cava, chiave per testa) — vedi
 * T.fresatura.moltiplicatori_materiale.altro per i valori. La crescita
 * per fasce riflette il fenomeno fisico per cui la difficoltà di
 * lavorazione delle superleghe cresce con la dimensione del pezzo.
 * Per la testa, le 4 fasce vengono re-mappate sulle soglie
 * testa_chiave_soglie.soglie_chiave (default [27, 40, 55] + null).
 *
 * LIMITE DEL MODELLO: la fascia più alta (oltre ch_x=20 per cava, oltre
 * chiave=55 per testa) usa un singolo moltiplicatore costante. Su pezzi
 * molto grandi (M36+) il vero moltiplicatore potrebbe essere superiore,
 * ma con i dati attuali (un solo punto di ancoraggio a ch_x=22 per il
 * 660) non è possibile modellare ulteriormente. Quando arriveranno dati
 * su M36+ in materiali altro, valutare l'aggiunta di una 5° fascia.
 *
 * Il chiamante (viti.js) usa come `chiave_mm`:
 *   - 5737/5739: dimensione chiave esagono testa (dati_testa.s)
 *   - speciale 'esagonale': dati_testa.s
 *   - speciale 'quadrata':  spec_qu_lato (lato del quadrato)
 *   - speciale 'prismatica': max(spec_pr_lungh, spec_pr_largh)
 *   - speciale 'troncopiramidale': spec_tp_lato_mag
 * Le sotto-forme di pura tornitura (troncoconica, cilindrica, bombata,
 * sferica) NON usano questa funzione: il chiamante salta del tutto la
 * chiamata in quei casi.
 *
 * Il minimo T.fresatura._minimo_secondi (= 90) è applicato dopo il
 * moltiplicatore.
 *
 * RITORNO
 * -------
 * Tempo macchina di un pezzo singolo, secondi. Include il minimo 90s.
 * NON include setup, costo orario, minimo €/lotto.
 *
 * @param {number} chiave_mm - Dimensione chiave esagono testa o lato equivalente (mm). > 0.
 * @param {string} mat - Materiale principale (carbonio, inox, o 'altro').
 * @param {string} materiale_speciale - Solo se mat === 'altro'.
 * @param {object} T - Oggetto comune.json.
 * @returns {number} Tempo fresatura testa in secondi (≥ 90).
 */
export function tempoFresaturaTestaEsagonale(chiave_mm, mat, materiale_speciale, T) {
  if (!(chiave_mm > 0)) {
    throw new Error(`tempoFresaturaTestaEsagonale: chiave_mm deve essere > 0, ricevuto ${chiave_mm}`);
  }
  const p = T.fresatura.testa_esagonale;
  const tempo_base = p.base_sec + p.pendenza_sec_per_mm * chiave_mm;
  const k = getMoltiplicatoreFresatura(mat, materiale_speciale, T, 'testa', chiave_mm);
  const tempo = tempo_base * k;
  const min = T.fresatura._minimo_secondi;
  return Math.max(tempo, min);
}