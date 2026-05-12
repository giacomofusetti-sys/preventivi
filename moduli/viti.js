// ============================================================
// viti.js — Viti M8-M48 (UNI 5737, 5739, 5931)
// Tipi: 5737 = esagonale con gambo, 5739 = esagonale tutta filettata
//       5931 = testa cilindrica con cava esagonale
// Modalità: STAMPAGGIO ON = testa stampata | OFF = testa fresata/tornita
// ============================================================

import {
  MAT_INOX,
  parseDia,
  parseExpr,
  getDiametroNominale,
  getDiametroMedio,
  calcolaPeso,
  parseQta,
  setupCosto,
  applicaDegradoOperatore,
  tempoTornituraBase,
  tempoSfacciatura,
  tempoMovimentazione,
  tempoFresaturaCava,
  tempoFresaturaTestaEsagonale,
  calcolaSmusso,
  interpola,
} from '../lib/calcolo_comune.js';

const MAT_STANDARD = ['42CD4', 'B16', 'B7', 'L7', 'B7M', 'A105'];

// ─── HELPERS INTERNI ─────────────────────────────────────────

function lookup(table, key) {
  return table[String(key)] ?? null;
}

function tierValue(tiers, value, field = 'secondi') {
  for (const r of tiers) {
    if (value <= r.fino_a) return r[field];
  }
  return null;
}

// ─── LUNGHEZZA FILETTO ────────────────────────────────────────

function calcolaLunghFiletto(tipo, dia, lungh, filetto_override, TV) {
  if (filetto_override > 0) return filetto_override;
  if (tipo === '5739')    return lungh; // tutta filettata
  if (tipo === 'speciale') return lungh; // default: tutta filettata (override se specificato)

  const key = String(dia);

  if (tipo === '5737') {
    const t = TV.lunghezze_filetto_5737[key];
    if (!t) return lungh; // fallback
    if (t.soglia1 !== undefined) {
      // 3 fasce
      if (lungh <= t.soglia1) return t.corto;
      if (lungh <= t.soglia2) return t.medio;
      return t.lungo;
    } else if (t.soglia !== undefined && t.corto !== undefined) {
      // 2 fasce (pollici e grandi metrici)
      return lungh <= t.soglia ? t.corto : t.lungo;
    } else {
      // solo 2 fasce senza corto (M42+)
      return lungh <= t.soglia ? t.medio : t.lungo;
    }
  }

  if (tipo === '5931') {
    const t = TV.lunghezze_filetto_5931[key];
    if (!t) return lungh;
    return lungh > t.soglia ? t.lungo : lungh;
  }

  return lungh;
}

// ─── DATI TESTA ───────────────────────────────────────────────

function getDatiTesta(tipo, dia, mat, chiave_tipo, TV) {
  const key = String(dia);
  if (tipo === '5737' || tipo === '5739') {
    const s    = lookup(TV.chiavi_metriche, key)
              ?? (chiave_tipo === 'l'
                  ? lookup(TV.chiavi_pollici_l, key)
                  : lookup(TV.chiavi_pollici_p, key));
    const h    = lookup(TV.altezze_testa_esagonale, key);
    if (!s || !h) throw new Error(`Testa esagonale non trovata per dia ${dia}`);
    const lato = s / 1.732;
    // Volume testa esagonale = 6 triangoli × (lato² × 0.866 / 2) × altezza
    const vol_testa = (lato * lato * 0.866 * 6) * h / 2;
    return { s, h, lato, vol_testa, tipo_testa: 'esagonale' };
  }
  if (tipo === '5931') {
    const dk = lookup(TV.diametri_testa_cava, key);
    const hc = lookup(TV.altezze_testa_cava, key)
            ?? parseFloat(dia);          // fallback = dia stesso (per metrici standard)
    const sc = lookup(TV.chiavi_cava_metriche, key);
    const t  = lookup(TV.profondita_cava, key);
    if (!dk) throw new Error(`Testa cava non trovata per dia ${dia}`);
    const dk_eff = MAT_INOX.includes(mat) ? dk + 2 : dk;
    const lato_c = sc ? sc / 1.732 : 0;
    // Volume testa cava = cilindro - scavo esagonale (con compensazione 4.3%)
    const vol_cil  = Math.PI * (dk_eff / 2) ** 2 * hc;
    const vol_scav = lato_c && t ? (lato_c * lato_c * 0.866 * 6) * t / 2 : 0;
    const vol_testa = MAT_INOX.includes(mat)
      ? Math.PI * (dk_eff / 2) ** 2 * hc           // per inox si torna la testa intera
      : (vol_cil - vol_scav) * (1 - 0.043);
    return { dk: dk_eff, hc, sc, t, vol_testa, tipo_testa: 'cava' };
  }
  throw new Error(`Tipo vite non riconosciuto: ${tipo}`);
}

// ─── DATI TESTA SPECIALE (formule volumetriche) ──────────────
// Per la modalità "vite speciale": l'utente sceglie una delle 8
// tipologie e fornisce i parametri geometrici manuali. Il volume
// testa è calcolato direttamente, senza lookup su tabelle.
function getDatiTestaSpeciale(inp) {
  const t = inp.tipo_testa_speciale;
  const SQRT3 = Math.sqrt(3);
  // Area esagono regolare dato il lato: (3√3/2) × lato²
  const areaEsag = (lato) => (3 * SQRT3 / 2) * lato * lato;

  if (t === 'esagonale') {
    const chiave = inp.spec_es_chiave;
    const h      = inp.spec_es_altezza;
    const lato   = chiave / SQRT3;
    const vol_testa = areaEsag(lato) * h;
    return { vol_testa, h_testa: h, tipo_testa: 'speciale', sub: t, s: chiave };
  }

  if (t === 'troncoconica') {
    const R = inp.spec_tc_rmagg;
    const r = inp.spec_tc_rmin;
    const h = inp.spec_tc_altezza;
    const vol_testa = (Math.PI * h / 3) * (R*R + R*r + r*r);
    return { vol_testa, h_testa: h, tipo_testa: 'speciale', sub: t };
  }

  if (t === 'cilindrica') {
    const R = inp.spec_cil_raggio;
    const h = inp.spec_cil_altezza;
    const vol_testa = Math.PI * R * R * h;
    return { vol_testa, h_testa: h, tipo_testa: 'speciale', sub: t };
  }

  if (t === 'quadrata') {
    const lato = inp.spec_qu_lato;
    const h    = inp.spec_qu_altezza;
    const vol_testa = lato * lato * h;
    return { vol_testa, h_testa: h, tipo_testa: 'speciale', sub: t };
  }

  if (t === 'prismatica') {
    const L = inp.spec_pr_lungh;
    const W = inp.spec_pr_largh;
    const h = inp.spec_pr_altezza;
    const vol_testa = L * W * h;
    return { vol_testa, h_testa: h, tipo_testa: 'speciale', sub: t };
  }

  if (t === 'troncopiramidale') {
    const a = inp.spec_tp_lato_min;
    const A = inp.spec_tp_lato_mag;
    const h = inp.spec_tp_altezza;
    const vol_testa = (h / 3) * (A*A + A*a + a*a);
    return { vol_testa, h_testa: h, tipo_testa: 'speciale', sub: t };
  }

  if (t === 'tcei') {
    const dk   = inp.spec_tcei_diam;
    const h    = inp.spec_tcei_altezza;
    const ch   = inp.spec_tcei_chiave;
    const prof = inp.spec_tcei_prof;
    const vol_cil  = Math.PI * (dk/2) * (dk/2) * h;
    const lato_c   = ch / SQRT3;
    const vol_scav = areaEsag(lato_c) * prof;
    const vol_testa = vol_cil - vol_scav;
    return { vol_testa, h_testa: h, tipo_testa: 'speciale', sub: t, dk, sc: ch };
  }

  if (t === 'bombata') {
    const R = inp.spec_bo_raggio;
    const h = inp.spec_bo_altezza;
    const vol_testa = (Math.PI * h / 6) * (3 * R * R + h * h);
    return { vol_testa, h_testa: h, tipo_testa: 'speciale', sub: t };
  }

  throw new Error(`Tipo testa speciale non riconosciuto: ${t}`);
}

// ─── SVILUPPO TESTA (per calcolo spezzone a stampaggio) ───────

function calcolaSviluppoTesta(tipo, dati_testa, area_tondo) {
  if (tipo === '5737' || tipo === '5739' || tipo === '5931' || tipo === 'speciale') {
    return dati_testa.vol_testa / area_tondo;
  }
  return 0;
}

// ─── TORNITURA VITI (modello dichiarativo) ───────────────────
//
// Due rami mutuamente esclusivi:
//
// 1) COPIATORE (macchina semiautomatica): si attiva solo se
//    STAMPAGGIO=true, tipo ∈ {5737, 5931}, NON è 5931 inox/altro,
//    dia_disp > dia_medio (perno da tornire), dia_disp ≤ dia_parte_liscia
//    (parte liscia già a misura di stampaggio). Caso tipico: vite mezzo
//    filetto stampata che richiede solo la riduzione del perno al medio.
//    Formula classica: (L_filettata/div) × ceil(Δ/3) + 5s offset.
//    Niente movimentazione, niente minimo 90s. Il moltiplicatore
//    materiali_speciali_k si applica se mat === 'altro'.
//
// 2) CN (controllo numerico): tutti gli altri casi. Composizione di 5
//    componenti dichiarative:
//      A — Parte LISCIA del gambo (da dia_disp a dia_parte_liscia)
//      B — Parte FILETTATA del gambo (da dia_disp a dia_medio)
//      C — Intestazione del tondo (solo FRESA)
//      D — Sottotesta (se c'è tornitura gambo)
//      E — Testa 5931 inox/altro stampata (3 fasi: E1 intestazione + E2
//          tornitura laterale + E3 fresatura cava gestita altrove)
//    Più movimentazione; minimo 90s applicato se c'è tornitura attiva.

function calcolaTorniturraViti(
  tipo, dian, dia_medio, dia_disp, dia_parte_liscia,
  L_filettata, L_liscia,
  mat, materiale_speciale,
  STAMPAGGIO, dati_testa,
  peso_grezzo,
  T
) {
  // Validazione input: la parte liscia non può eccedere la barra di partenza.
  // Fail-fast prima di qualunque calcolo, così l'errore esce subito con un
  // messaggio comprensibile invece di propagare valori incoerenti a valle.
  if (dia_parte_liscia > 0 && dia_parte_liscia > dia_disp) {
    throw new Error(
      `Parte liscia (Ø ${dia_parte_liscia} mm) non può superare il diametro ` +
      `della barra di partenza (Ø ${dia_disp} mm).`
    );
  }

  // Estensione L_liscia per testa esagonale tornita da tondo grosso:
  // se il tondo è più largo dello spigolo + 5 mm, il tornio abbassa
  // anche il lato della testa (non solo il gambo). L'estensione vale
  // solo per FRESA e per teste esagonali (5737, 5739, speciale-esagonale).
  let L_liscia_eff = L_liscia;
  let ha_extensione_testa_ex = false;
  const testa_esagonale =
    !STAMPAGGIO && (
      tipo === '5737' ||
      tipo === '5739' ||
      (tipo === 'speciale' && dati_testa.sub === 'esagonale')
    );
  if (testa_esagonale) {
    const s = dati_testa.s ?? 0;
    const spigolo = s * 1.154;
    if (s > 0 && dia_disp >= spigolo + 5) {
      const h_testa_esa = dati_testa.h ?? dati_testa.h_testa ?? 0;
      if (h_testa_esa > 0) {
        L_liscia_eff = L_liscia + h_testa_esa;
        ha_extensione_testa_ex = true;
      }
    }
  }

  const materiale_key = mat === 'altro' ? materiale_speciale : mat;

  // Discriminante ramo E (testa 5931 inox/altro stampata)
  const is5931InoxAltro =
    tipo === '5931' &&
    (mat === 'altro' || MAT_INOX.includes(mat)) &&
    STAMPAGGIO;

  // Mezzo filetto: c'è parte liscia da non tornire (5737 sempre; 5931 sopra
  // la soglia tabellata in lunghezze_filetto_5931).
  const is_mezzo_filetto = L_liscia > 0;

  // Territorio "copiatore": stampaggio + 5737/5931 + mezzo filetto +
  // parte liscia al nominale. Il copiatore lavora in 1 passata sul perno
  // (parte filettata) portandolo dal nominale al medio: se la parte liscia
  // è ridotta rispetto al nominale, non sa fare le due geometrie distinte
  // e va al CN.
  //
  // In questo territorio dia_disp deve stare in [dian-0.2, dian]:
  // - sotto: errore esplicito (barra trafilata non adatta)
  // - sopra: si va al CN come oggi
  // - dentro + parte liscia al nominale: copiatore
  // - dentro + parte liscia ridotta: si va al CN (logica V8 carbonio o
  //   V8 inox/altro gestisce automaticamente il caso)
  const is_copiatore_territory =
    STAMPAGGIO &&
    (tipo === '5737' || tipo === '5931') &&
    is_mezzo_filetto;

  if (is_copiatore_territory && dia_disp < dian - 0.2) {
    throw new Error(
      `Diametro disponibile (${dia_disp}mm) sotto soglia copiatore per ${tipo} M${dian} ` +
      `(range ammesso: ${(dian - 0.2).toFixed(1)} - ${dian} mm). ` +
      `Per stampaggio mezzo filetto serve una barra trafilata vicino al diametro nominale.`
    );
  }

  // Tolleranza dia_parte_liscia-dian coerente con quella dia_disp-medio
  // del check ha_smusso (0.5 mm), che identifica "barra già a misura".
  const is_copiatore =
    is_copiatore_territory &&
    dia_disp >= (dian - 0.2) &&
    dia_disp <= dian &&
    Math.abs(dia_parte_liscia - dian) < 0.5;

  // ─── RAMO COPIATORE ────────────────────────────────────────
  // Formula copiatore (1 sola passata sempre, offset fisso, niente moltiplicatori
  // materiali_speciali_k — la macchina lavora carbonio/inox/superleghe a velocità
  // simili sui pezzi piccoli mezzo-filetto):
  //   tempo_gambo = L_filettata / div + 13s
  //   div = 3 per inox/altro/superleghe, 4 per acciai al carbonio
  // Per 5931 inox/altro mezzo filetto a nominale: ibrido — gambo sul copiatore,
  // testa lavorata col ramo E (E1 intestazione + E2 tornitura laterale).
  if (is_copiatore) {
    const div = (MAT_INOX.includes(mat) || mat === 'altro') ? 3 : 4;
    const tempo_gambo_copiatore = L_filettata / div + 13;

    let E1 = 0, E2 = 0;
    if (is5931InoxAltro) {
      // Stessa logica del ramo CN (vedi sotto). dati_testa.dk include il +2 storico.
      const D_testa_eff = dati_testa.dk ?? 0;       // dk_eff (= dk_nominale + 2)
      const D_testa_fin = D_testa_eff - 2;          // diametro testa finito
      const h_testa     = dati_testa.hc ?? 0;
      E1 = tempoSfacciatura(D_testa_fin / 2, mat, materiale_speciale, T);
      E2 = tempoTornituraBase(D_testa_eff, D_testa_fin, h_testa, mat, materiale_speciale, T);
    }

    const tempo_totale_cop = tempo_gambo_copiatore + E1 + E2;

    return {
      tempo_ciclo: tempo_totale_cop,
      mov: 0,
      tempo_totale: tempo_totale_cop,
      min_scattato: false,
      materiale_key,
      componenti: { A: 0, B: tempo_gambo_copiatore, C: 0, D: 0, E1, E2, mov: 0 },
      has_tornitura: true,
      has_intestazione: false,
      has_testa_5931: is5931InoxAltro,
      ha_extensione_testa_ex: false,
      A_include_solo_testa_esagonale: false,
      L_liscia_eff: L_liscia,
      is_copiatore: true,
    };
  }

  // ─── RAMO CN (controllo numerico) ──────────────────────────

  // A — tornitura parte liscia (con eventuale estensione per testa esagonale)
  // Sul CN il gambo riceve sempre una passata di finitura in coda (flag true).
  const A = (dia_disp > dia_parte_liscia && L_liscia_eff > 0)
    ? tempoTornituraBase(dia_disp, dia_parte_liscia, L_liscia_eff, mat, materiale_speciale, T, true)
    : 0;

  // B — tornitura parte filettata (anch'essa parte del gambo, finitura attiva).
  const B = (dia_disp > dia_medio && L_filettata > 0)
    ? tempoTornituraBase(dia_disp, dia_medio, L_filettata, mat, materiale_speciale, T, true)
    : 0;

  // C — intestazione tondo (solo FRESA)
  const C = !STAMPAGGIO
    ? tempoSfacciatura(dia_disp / 2, mat, materiale_speciale, T)
    : 0;

  // E — procedura testa 5931 inox/altro stampata (3 fasi; E3 fresatura cava è altrove)
  // NOTA: dati_testa.dk include già il +2 per inox/altro (dk_eff). Il diametro
  // "finito" target è dati_testa.dk - 2; la tornitura laterale va da dk a dk-2.
  let E1 = 0, E2 = 0;
  if (is5931InoxAltro) {
    // NOTA: getDatiTesta contiene un workaround storico che per
    // inox/altro restituisce già dk+2 invece del dk nominale.
    // Qui lo rispettiamo, ma andrebbe ripulito in futuro (backlog).
    const D_testa_eff = dati_testa.dk ?? 0;       // diametro testa dopo stampaggio (= dk_nominale + 2)
    const D_testa_fin = D_testa_eff - 2;          // diametro testa finito (= dk_nominale)
    const h_testa     = dati_testa.hc ?? 0;
    E1 = tempoSfacciatura(D_testa_fin / 2, mat, materiale_speciale, T);
    E2 = tempoTornituraBase(D_testa_eff, D_testa_fin, h_testa, mat, materiale_speciale, T);
  }
  const E = E1 + E2;

  // D — sottotesta (solo se c'è tornitura gambo e NON è caso E)
  let D_comp = 0;
  if ((A + B) > 0 && !is5931InoxAltro) {
    let raggio_sottotesta = 0;
    if (tipo === '5737' || tipo === '5739') {
      const s = dati_testa.s ?? 0;
      raggio_sottotesta = (s * 1.154) / 2;
    } else if (tipo === '5931') {
      const dk = dati_testa.dk ?? 0;
      raggio_sottotesta = dk / 2;
    } else if (tipo === 'speciale') {
      // Per speciale: usa il "diag" caratteristico della sezione testa.
      const sub = dati_testa.sub;
      if (sub === 'esagonale')      raggio_sottotesta = ((dati_testa.s ?? 0) * 1.154) / 2;
      else if (sub === 'tcei')      raggio_sottotesta = ((dati_testa.dk ?? 0)) / 2;
      // Altre sotto-forme: sottotesta omesso (diag non derivabile in modo uniforme).
    }
    if (raggio_sottotesta > 0) {
      D_comp = tempoSfacciatura(raggio_sottotesta, mat, materiale_speciale, T);
    }
  }

  // Movimentazione (×1 per le viti, sul caricatore automatico)
  const mov = tempoMovimentazione(peso_grezzo, 1, T);

  // Somma e minimo (solo se c'è tornitura)
  const has_tornitura = (A + B + C + E) > 0;
  const tempo_ciclo_raw = A + B + C + D_comp + E1 + E2;       // SENZA mov
  const tempo_raw_with_mov = tempo_ciclo_raw + mov;
  const tempo_min = T.tornitura_controllo.tempo_minimo_secondi;
  const tempo_totale = has_tornitura
    ? Math.max(tempo_raw_with_mov, tempo_min)
    : 0;
  const min_scattato = has_tornitura && (tempo_raw_with_mov < tempo_min);

  return {
    tempo_ciclo: tempo_ciclo_raw,
    mov,
    tempo_totale,
    min_scattato,
    materiale_key,
    componenti: { A, B, C, D: D_comp, E1, E2, mov },
    has_tornitura,
    has_intestazione: C > 0,
    has_testa_5931: is5931InoxAltro,
    ha_extensione_testa_ex,
    // True solo se A è esclusivamente la testa esagonale (V1 5739
    // FRESA con tondo grosso): L_liscia originale=0 + estensione attiva.
    // Per V2/V10 estensione attiva con L_liscia originale > 0, A include
    // sia parte liscia sia testa esagonale.
    A_include_solo_testa_esagonale: ha_extensione_testa_ex && L_liscia === 0,
    L_liscia_eff,
    is_copiatore: false,
  };
}

// ─── NARRAZIONE TORNITURA ─────────────────────────────────────
// Costruisce l'array di paragrafi descrittivi per il popup
// "Dettaglio tornitura", a partire dalle componenti già calcolate da
// calcolaTorniturraViti. I numeri (tempo ciclo, mov, setup) sono
// inseriti inline nelle frasi; le tabelle tecniche del popup restano
// invariate e mostrano i parametri di taglio.
//
// Mappa terminologia (codice → narrazione):
//   tempoTornituraBase su gambo/parte liscia (A/B) → "tornitura del gambo"
//     o "tornitura della parte liscia/filettata"
//   tempoTornituraBase su laterale testa (E2)      → "tornitura del fianco della testa"
//   tempoSfacciatura su intestazione (C)           → "intestazione"
//   tempoSfacciatura su sottotesta (D)             → "ripresa del sottotesta"
//   tempoSfacciatura su fronte testa (E1)          → "intestazione del fronte testa"
//   tempoMovimentazione                            → "movimentazione (presa e deposito del pezzo)"
//   tempo_gambo_copiatore                          → "tornitura del gambo sul copiatore"
//
// In officina "sfacciatura" si chiama "intestazione" — uso quest'ultima
// nelle stringhe narrative, mantenendo "sfacciatura" nei nomi di
// funzione del codice.

function _notaMinTornitura(min_scattato, tempo_min) {
  return min_scattato
    ? ` (minimo ${tempo_min} secondi applicato, sotto questa soglia la lavorazione non è economicamente sensata)`
    : '';
}

/**
 * @param {object} info tornitura_info (output di calcolaTorniturraViti)
 * @param {object} setup secondi dei setup macchina:
 *   {torn_sec, intestazione_sec, testa_E1_sec, testa_E2_sec, copiatore_sec, tempo_min}
 * @returns {string[]} paragrafi narrativi; [] se nessuna tornitura applicabile.
 */
function costruisciNarrazioneTornituraViti(info, setup) {
  if (!info.has_tornitura) return [];

  const { A, B, C, D, E1, E2, mov } = info.componenti;

  // ─── RAMO COPIATORE ────────────────────────────────────────
  // V5/V6: solo gambo. V7: ibrido (gambo sul copiatore + testa sul CN).
  // Nel return del ramo copiatore: B contiene tempo_gambo_copiatore,
  // A/C/D/mov sono 0; E1/E2 valorizzati solo per V7 (is5931InoxAltro).
  if (info.is_copiatore) {
    const tempo_gambo = Math.round(B);

    if (info.has_testa_5931) {
      // V7 — ibrido: 2 paragrafi (copiatore + CN)
      const E1r = Math.round(E1);
      const E2r = Math.round(E2);
      return [
        `Sul Copiatore: il gambo viene tornito in una sola passata per portarlo al diametro medio. ` +
        `Tempo per pezzo: ${tempo_gambo}s. Setup: ${setup.copiatore_sec}s.`,
        `Sul Tornio CN: la testa cilindrica viene poi lavorata in due fasi: intestazione del fronte testa (${E1r}s) ` +
        `e tornitura del fianco della testa per portarla al diametro finito (${E2r}s). ` +
        `Totale ${E1r + E2r}s per pezzo. ` +
        `Setup: ${setup.testa_E1_sec}s + ${setup.testa_E2_sec}s (due piazzamenti distinti, intestazione e tornitura).`,
      ];
    }

    // V5/V6 — solo gambo sul copiatore
    return [
      `Il gambo viene tornito sul copiatore in una sola passata per portarlo al diametro medio. ` +
      `Tempo per pezzo: ${tempo_gambo}s. Setup macchina (Copiatore): ${setup.copiatore_sec}s.`,
    ];
  }

  // ─── RAMO CN ────────────────────────────────────────────────
  // Composizione dinamica delle fasi attive (componente > 0).
  //
  // Frase per A:
  //   - estensione testa esagonale attiva (solo FRESA con testa esagonale):
  //       L_liscia originale=0  → "tornitura della testa esagonale"  (V1 5739)
  //       L_liscia originale>0  → "tornitura della parte liscia e della testa esagonale"  (V2/V10)
  //   - senza estensione:
  //       B > 0  → "tornitura della parte liscia"  (V2/V10 mezzo filetto FRESA)
  //       B == 0 → "tornitura del gambo"
  //                (V8/V11 STAMPAGGIO sopra nominale, dove B viene azzerato
  //                perché L_filettata=0 da stampaggio; anche il caso
  //                "copiatore declassato a CN" per dpl<dian rientra qui.
  //                Il target di A è dia_parte_liscia, che può essere
  //                dian — V8 standard — o dpl<dian — declassato. Frase
  //                volutamente senza target per coprire entrambi.)
  // NB: l'estensione si attiva solo in FRESA (testa_esagonale richiede
  // !STAMPAGGIO); per V8/V11 STAMPAGGIO è sempre disattiva.
  const fasi = [];
  if (A > 0) {
    let frase_A;
    if (info.ha_extensione_testa_ex) {
      frase_A = info.A_include_solo_testa_esagonale
        ? `tornitura della testa esagonale (${Math.round(A)}s)`
        : `tornitura della parte liscia e della testa esagonale (${Math.round(A)}s)`;
    } else if (B > 0) {
      frase_A = `tornitura della parte liscia (${Math.round(A)}s)`;
    } else {
      frase_A = `tornitura del gambo (${Math.round(A)}s)`;
    }
    fasi.push(frase_A);
  }
  if (B > 0) fasi.push(`tornitura della parte filettata (${Math.round(B)}s)`);
  if (C > 0) fasi.push(`intestazione (${Math.round(C)}s)`);
  if (D > 0) fasi.push(`ripresa del sottotesta (${Math.round(D)}s)`);
  if (info.has_testa_5931) {
    fasi.push(`intestazione del fronte testa (${Math.round(E1)}s)`);
    fasi.push(`tornitura del fianco della testa (${Math.round(E2)}s)`);
  }

  if (fasi.length === 0) return [];   // safety net (non dovrebbe accadere se has_tornitura=true)

  // Frase principale: 1 fase o "più fasi: ..., ..., e ultima"
  let frase_principale;
  if (fasi.length === 1) {
    frase_principale = `Il pezzo viene tornito al Tornio CN: ${fasi[0]}.`;
  } else {
    const ultima = fasi.pop();
    frase_principale = `Il pezzo viene tornito al Tornio CN in più fasi: ${fasi.join(', ')} e ${ultima}.`;
  }

  // Movimentazione (solo se mov > 0)
  const frase_mov = mov > 0
    ? ` Si aggiungono ${Math.round(mov)}s di movimentazione (presa e deposito del pezzo).`
    : '';

  // Totale + eventuale nota minimo
  const frase_totale = ` Totale ${Math.round(info.tempo_totale)}s per pezzo` +
    `${_notaMinTornitura(info.min_scattato, setup.tempo_min)}.`;

  // Setup macchina: 3 varianti mutuamente esclusive (CN+intestazione,
  // CN+testa 5931, solo CN). Non esiste il caso "intestazione + testa
  // 5931" insieme: C>0 richiede !STAMPAGGIO, has_testa_5931 richiede
  // STAMPAGGIO.
  let frase_setup;
  if (info.has_testa_5931) {
    frase_setup =
      ` Setup macchina: ${setup.torn_sec}s + ${setup.testa_E1_sec}s + ${setup.testa_E2_sec}s ` +
      `per i piazzamenti distinti di intestazione e tornitura testa.`;
  } else if (info.has_intestazione) {
    frase_setup =
      ` Setup macchina: ${setup.torn_sec}s + ${setup.intestazione_sec}s per il piazzamento di intestazione.`;
  } else {
    frase_setup = ` Setup macchina: ${setup.torn_sec}s.`;
  }

  return [frase_principale + frase_mov + frase_totale + frase_setup];
}

// ─── SBAVATURA ────────────────────────────────────────────────
// `interpola` è ora importata da calcolo_comune.js (riusata anche
// dal nuovo calcolaSmusso). La logica della sbavatura sotto è invariata.

const NOMI_DISPLAY_SBAV = {
  sbavatrice_normale: 'Sbavatrice normale',
  ceriotti: 'Ceriotti',
  tornio: 'Tornio',
};

// lungh = lunghezza sottotesta (non "lungh_pezzo": la variabile nel modulo si chiama "lungh")
function calcolaSbavatura(dian, lungh, mat, qta, co, TV) {
  const cfg = TV.sbavatura;
  const mults = cfg.moltiplicatori_materiale;

  // Classificazione materiale
  // Ordine esplicito: standard → altro (check diretto) → inox → fallback altro.
  // Nota: MAT_INOX contiene storicamente anche 'altro' come marker
  // di "materiale difficile", per cui 'altro' va intercettato PRIMA
  // del check su MAT_INOX.
  let categoria;
  if (MAT_STANDARD.includes(mat))       categoria = 'standard';
  else if (mat === 'altro')             categoria = 'altro';
  else if (MAT_INOX.includes(mat))      categoria = 'inox';
  else                                  categoria = 'altro';

  const macchine_sbav = ['sbavatrice_normale', 'ceriotti'];
  const candidati = [];

  for (const nome of macchine_sbav) {
    const m = cfg[nome];
    // Compatibilità dimensionale
    if (dian < m.diametro_min || dian > m.diametro_max) continue;
    if (m.lunghezza_min != null && lungh < m.lunghezza_min) continue;
    if (m.lunghezza_max != null && lungh > m.lunghezza_max) continue;

    const tempo_base = interpola(dian, m.diametro_min, m.diametro_max,
                                  m.tempo_ciclo_min_sec, m.tempo_ciclo_max_sec);
    const mult_mat = mults[categoria];
    const mult = interpola(dian, m.diametro_min, m.diametro_max,
                           mult_mat.min, mult_mat.max);
    const tempo_ciclo = tempo_base * mult;
    const costo_totale = (m.setup_sec + tempo_ciclo * qta) * co;

    candidati.push({
      macchina: nome,
      nome_display: NOMI_DISPLAY_SBAV[nome],
      tempo_ciclo_sec: tempo_ciclo,
      setup_sec: m.setup_sec,
      costo_totale,
    });
  }

  // Selezione macchina a soglia unica
  const soglia = cfg.soglia_qta_normale;
  const normale_ok = candidati.find(c => c.macchina === 'sbavatrice_normale');
  const ceriotti_ok = candidati.find(c => c.macchina === 'ceriotti');

  if (qta < soglia) {
    if (ceriotti_ok) return ceriotti_ok;
    if (normale_ok) return normale_ok;
  } else {
    if (normale_ok) return normale_ok;
    if (ceriotti_ok) return ceriotti_ok;
  }

  // Fallback: tornio (nessuna sbavatrice compatibile)
  return {
    macchina: 'tornio',
    nome_display: NOMI_DISPLAY_SBAV.tornio,
    tempo_ciclo_sec: cfg.tornio.tempo_ciclo_sec,
    setup_sec: cfg.tornio.setup_sec,
    costo_totale: (cfg.tornio.setup_sec + cfg.tornio.tempo_ciclo_sec * qta) * co,
  };
}

// ─── STAMPAGGIO ───────────────────────────────────────────────

function calcolaTempoStampaggio(dian, TV) {
  return tierValue(TV.tempi_stampaggio, dian) ?? 0;
}

// ─── RULLATURA ───────────────────────────────────────────────

function calcolaTempoRullatura(dian, filet, mat, TV) {
  const tiers = MAT_INOX.includes(mat)
    ? [
        { fino_a: 21.99, div: 10 }, { fino_a: 25.99, div: 18 },
        { fino_a: 32.99, div: 6  }, { fino_a: 42.99, div: 5  },
        { fino_a: 50.99, div: 4  }, { fino_a: 60.99, div: 2  },
        { fino_a: 70.99, div: 1.5}, { fino_a: 100.99,div: 1  },
      ]
    : [
        { fino_a: 21.99, div: 12 }, { fino_a: 25.99, div: 10 },
        { fino_a: 32.99, div: 8  }, { fino_a: 42.99, div: 7  },
        { fino_a: 50.99, div: 6  }, { fino_a: 60.99, div: 4  },
        { fino_a: 70.99, div: 3  }, { fino_a: 100.99,div: 2  },
      ];

  let t = null;
  for (const r of tiers) {
    if (dian <= r.fino_a) { t = filet / r.div; break; }
  }
  if (t === null) throw new Error(`Diametro ${dian} fuori range per rullatura`);

  // Minimi per diametro
  for (const r of TV.rullatura_viti.minimi) {
    if (dian >= r.dian_da && dian < r.dian_a) {
      t = Math.max(t, r.minimo); break;
    }
  }

  // Moltiplicatori per lunghezza filetto
  for (const r of TV.rullatura_viti.moltiplicatori_lunghezza) {
    if (filet >= r.da && filet < r.a) { t *= r.mult; break; }
  }

  if (mat === 'altro') t *= 1.5;

  return t;
}

// ─── RADDRIZZATURA ────────────────────────────────────────────

function calcolaRaddrizzatura(dian, lungh, mat, BONIFICA, TV) {
  const mat_bonif = TV.materiali_bonificabili;
  if (!mat_bonif.includes(mat)) return 0;
  if (!BONIFICA) return 0; // se non si bonifica non si raddrizza
  if (lungh <= dian * TV.raddrizzatura.soglia_lunghezza_mult) return 0;

  let t = null;
  for (const r of TV.raddrizzatura.tiers) {
    if (dian <= r.fino_a) { t = lungh / r.divisore; break; }
  }
  if (t === null) return 0;

  for (const r of TV.raddrizzatura.moltiplicatori_lunghezza) {
    if (lungh >= r.da && lungh < r.a) { t *= r.mult; break; }
  }

  return t * 0.018;
}

// ─── MODIFICATORE QUANTITÀ MATERIALE ─────────────────────────

function getModQta(dian, lungh, TV) {
  let mod = 2;
  for (const r of TV.modificatori_quantita_materiale) {
    if (dian >= r.dian_da && dian < r.dian_a) { mod = r.mod; break; }
  }
  if (dian < 20  && lungh >= 300) mod = 3;
  if (dian >= 20 && dian < 30 && lungh >= 300) mod = 2;
  if (dian >= 30 && lungh >= 400) mod = 1;
  return mod;
}

// ─── BONIFICA VITI ───────────────────────────────────────────

function calcolaBonificaViti(peso, qta, dian, lungh, TRATTAMENTO, costo_bonifica_kg, forfait_bonifica) {
  console.log('[bonifica viti] costo_bonifica_kg ricevuto:', costo_bonifica_kg);
  if (!TRATTAMENTO) return 0;
  // 4 casi da Python (assoluti 1.20/1.45/1.50/1.60) → moltiplicatori relativi a costo_bonifica_kg
  let mult_costo, mult_forfait;
  if (dian <= 42 && lungh <= dian * 10) { mult_costo = 1;    mult_forfait = 1;    } // ×1.20/1.20
  else if (dian <= 42)                  { mult_costo = 1.21; mult_forfait = 1.05; } // ×1.45/1.20
  else if (lungh <= dian * 10)          { mult_costo = 1.25; mult_forfait = 1;    } // ×1.50/1.20
  else                                  { mult_costo = 1.33; mult_forfait = 1.05; } // ×1.60/1.20
  const costo_eff  = costo_bonifica_kg * mult_costo;
  const forfait_eff = forfait_bonifica  * mult_forfait;
  const tot = peso * costo_eff * qta;
  return tot < forfait_eff ? forfait_eff / qta : peso * costo_eff;
}

// ─── MARCATURA ───────────────────────────────────────────────

function calcolaMarcatura(dian, qta, mat, STAMPAGGIO, TV) {
  // Con stampaggio su materiali bonificabili (42CD4, B16, 41Cr)
  // la marcatura avviene tramite punzone durante lo stampaggio stesso.
  if (STAMPAGGIO && TV.materiali_bonificabili.includes(mat)) return 0;
  let ma;
  if      (dian <= 20)    ma = 0.20;
  else if (dian <= 36)    ma = 0.30;
  else if (dian <= 54.95) ma = 0.40;
  else if (dian <= 67.65) ma = 0.50;
  else                    ma = 0.80;
  return ma * qta < 10 ? 10 / qta : ma;
}

// ─── COSTO MATERIALE VITI ────────────────────────────────────

function getCostoMaterialeViti(mat, costo_override, TV) {
  if (costo_override > 0) return costo_override;
  const c = TV.costi_materiali[mat];
  if (c === undefined) throw new Error(`Materiale "${mat}" non trovato`);
  return c;
}

function getDensitaViti(mat, dens_altro, TV) {
  const d = TV.densita[mat];
  if (d === null) return dens_altro;
  if (d === undefined) throw new Error(`Densità per "${mat}" non trovata`);
  return d;
}

// ─── FUNZIONE PRINCIPALE ─────────────────────────────────────

export function calcolaViti(inp, T, TV) {
  const {
    tipo,             // '5737' | '5739' | '5931' | 'speciale'
    dia_raw,
    passo,
    lungh_raw,
    qta_raw,
    qta_x           = 0,
    mat,
    materiale_speciale = '0',
    dens_altro       = 7.916,
    costo_mat_override = 0,
    dia_disp_raw,
    TF               = false,
    filetto_override = 0,
    dia_parte_liscia = 0,
    chiave_tipo      = 'p',
    STAMPAGGIO       = true,
    TRATTAMENTO      = false,
    costo_bonifica_kg = 1.30,
    forfait_bonifica  = 400,
    medio_override   = 0,
  } = inp;

  const IS_SPECIALE = tipo === 'speciale';

  const { co1, co2 } = T.costi_base;

  // ── Parse input ──────────────────────────────────────────
  const dia  = parseDia(dia_raw);
  const dian = getDiametroNominale(T, dia);
  const medio_raw = getDiametroMedio(T, dia, passo);
  const medio = medio_override > 0 ? medio_override : medio_raw;
  const lungh = parseExpr(lungh_raw);
  const qta   = parseQta(qta_raw);
  const dia_disp = parseExpr(dia_disp_raw) || dian;
  const dpl   = dia_parte_liscia > 0 ? dia_parte_liscia : dian;

  if (isNaN(lungh) || lungh <= 0) throw new Error('Lunghezza non valida');
  if (isNaN(qta)   || qta   <= 0) throw new Error('Quantità non valida');

  // Validazione generale: barra non può essere inferiore al 95% del diametro medio effettivo
  if (dia_disp < medio * 0.95) throw new Error(
    `Diametro barra (${dia_disp.toFixed(1)} mm) inferiore al minimo accettabile (${(medio * 0.95).toFixed(1)} mm).`
  );

  // Validazione FRESA: dia_disp deve essere >= spigolo/diametro testa
  if (!STAMPAGGIO && !IS_SPECIALE) {
    let s_rif = null;
    if (tipo === '5737' || tipo === '5739') {
      s_rif = lookup(TV.chiavi_metriche, String(dia))
           ?? (chiave_tipo === 'l'
               ? lookup(TV.chiavi_pollici_l, String(dia))
               : lookup(TV.chiavi_pollici_p, String(dia)));
    } else if (tipo === '5931') {
      s_rif = lookup(TV.chiavi_cava_metriche, String(dia));
      const dk = lookup(TV.diametri_testa_cava, String(dia));
      if (dk && dia_disp < dk) throw new Error(
        `Diametro barra (${dia_disp} mm) inferiore al diametro testa (${dk} mm). Per fresare serve un tondo più grosso.`
      );
    }
    if ((tipo === '5737' || tipo === '5739') && s_rif) {
      const spigolo = s_rif * 1.154;
      const spigolo_min = spigolo * 0.95;
      if (dia_disp < spigolo_min) throw new Error(
        `Diametro barra (${dia_disp} mm) inferiore al minimo accettabile (${spigolo_min.toFixed(1)} mm). Per fresare serve un tondo più grosso.`
      );
    }
  }

  // Materiali solo-fresa
  if (STAMPAGGIO && TV.materiali_solo_fresa.includes(mat)) {
    throw new Error(`Il materiale ${mat} non può essere stampato — usare modalità FRESA.`);
  }

  const dens        = getDensitaViti(mat, dens_altro, TV);
  const costo_kg    = getCostoMaterialeViti(mat, costo_mat_override, TV);
  const co          = dian < 45 ? co1 : co2;
  const isInox      = MAT_INOX.includes(mat);
  // Per le 5931 inox/altro stampate la sbavatura viene fatta dentro
  // l'intestazione testa (ramo E1), quindi NON serve sbavatrice.
  const is_5931_inox_altro = STAMPAGGIO && tipo === '5931' && (mat === 'altro' || isInox);

  // ── Lunghezza filetto ─────────────────────────────────────
  const filet = TF ? lungh : calcolaLunghFiletto(tipo, dia, lungh, filetto_override, TV);
  const lungh_liscia = filet > 0 ? lungh - filet : 0;

  // ── Dati testa ───────────────────────────────────────────
  let dati_testa, h_testa;
  if (IS_SPECIALE) {
    dati_testa = getDatiTestaSpeciale(inp);
    h_testa    = dati_testa.h_testa;
    if (!(dati_testa.vol_testa > 0) || !(h_testa > 0)) {
      throw new Error('Parametri testa speciale incompleti o non validi (vol_testa / h_testa ≤ 0)');
    }
    // Verifica tondo sufficiente per contenere la testa (solo !STAMPAGGIO)
    if (!STAMPAGGIO) {
      const sub = dati_testa.sub;
      let diag = 0;
      if (sub === 'esagonale')        diag = (dati_testa.s ?? 0) * 1.154;
      else if (sub === 'quadrata')    diag = inp.spec_qu_lato * Math.SQRT2;
      else if (sub === 'prismatica')  diag = Math.hypot(inp.spec_pr_lungh, inp.spec_pr_largh);
      else if (sub === 'troncopiramidale') diag = inp.spec_tp_lato_mag * Math.SQRT2;
      else if (sub === 'troncoconica') diag = 2 * inp.spec_tc_rmagg;
      else if (sub === 'cilindrica')  diag = 2 * inp.spec_cil_raggio;
      else if (sub === 'tcei')        diag = inp.spec_tcei_diam;
      else if (sub === 'bombata')     diag = 2 * inp.spec_bo_raggio;
      if (diag > 0 && dia_disp < diag * 0.95) throw new Error(
        `Diametro barra (${dia_disp.toFixed(1)} mm) insufficiente a contenere la testa speciale (servono almeno ${(diag * 0.95).toFixed(1)} mm)`
      );
    }
  } else {
    dati_testa = getDatiTesta(tipo, dia, mat, chiave_tipo, TV);
    h_testa    = dati_testa.h ?? dati_testa.hc ?? 0;
  }

  // ── Peso materiale ────────────────────────────────────────
  // Spezzone = lungh_gambo + altezza_testa + 5 (scarto)
  const area_tondo = Math.PI * (dia_disp / 2) ** 2;

  // Sviluppo testa: lunghezza di barra che "diventa" la testa dopo stampaggio.
  // Calcolato sempre (anche in FRESA, dove non si usa per lo spezzone ma resta
  // un dato informativo utile per confronti).
  const sviluppo_testa = calcolaSviluppoTesta(tipo, dati_testa, area_tondo);
  const lungh_spezzone = STAMPAGGIO
    ? sviluppo_testa + lungh + 5
    : lungh + h_testa + 5;

  const peso = calcolaPeso(dia_disp, lungh_spezzone, dens);

  // Modificatore quantità
  const mod_qta = getModQta(dian, lungh, TV);
  const mat_cost = peso * costo_kg;
  const mat_cost_plus = mat_cost * (qta + mod_qta) / qta;

  // ── Taglio ───────────────────────────────────────────────
  // Il Python usa costi tabellari diretti (€) non tempi
  // Li ricaviamo come: costo_taglio / co1 → secondi impliciti
  const taglio_costi_std  = [0.20,0.30,0.40,0.50,0.60,1.00];
  const taglio_costi_inox = [0.30,0.40,0.50,0.70,0.80];
  const taglio_soglie     = [20,33,52,56,63,85];
  let ta_raw = 0;
  const costi_tag = isInox ? taglio_costi_inox : taglio_costi_std;
  for (let i = 0; i < taglio_soglie.length; i++) {
    if (dia_disp <= taglio_soglie[i]) { ta_raw = costi_tag[i] ?? costi_tag[costi_tag.length-1]; break; }
  }
  const ta = ta_raw * qta < 10 ? 10 / qta : ta_raw;
  const t_taglio = Math.round(ta_raw / co1); // secondi per gestionale

  // ── Smusso (solo se dia_disp ≈ medio, cioè si parte già a misura) ─
  // smussi_per_pezzo=1 per le viti: testa stampata/tornita su un lato,
  // solo l'estremità libera filettata è da smussare. Floor €10/lotto al
  // call site (pattern coerente con sbavatura/taglio/ecc.).
  const ha_smusso  = Math.abs(dia_disp - medio) < 0.5;
  const sm_info    = ha_smusso ? calcolaSmusso(dian, lungh, mat, qta, 1, co1, co2, T) : null;
  const t_smusso   = sm_info ? sm_info.tempo_ciclo_sec : 0;
  const smusso_c   = sm_info ? t_smusso * sm_info.co_applicato : 0;
  const smusso_fin = t_smusso > 0 ? (smusso_c * qta < 10 ? 10 / qta : smusso_c) : 0;

  // ── Stampaggio ────────────────────────────────────────────
  let t_stamp = 0, stamp_c = 0, stamp_fin = 0;
  if (STAMPAGGIO) {
    t_stamp  = calcolaTempoStampaggio(dian, TV);
    t_stamp  = applicaDegradoOperatore(t_stamp, qta, T);
    stamp_c  = isInox ? t_stamp * co * 2 : t_stamp * co;
    stamp_fin = stamp_c * qta < 10 ? 10 / qta : stamp_c;
  }

  // ── Sbavatura ────────────────────────────────────────────
  // Per 5931 inox/altro stampate, la sbavatura della testa è già
  // inclusa nell'intestazione del ramo E (E1), quindi qui salta.
  let t_sbav = 0, sbav_fin = 0, sbav_info = null;
  if (STAMPAGGIO && !is_5931_inox_altro) {
    sbav_info = calcolaSbavatura(dian, lungh, mat, qta, co, TV);
    t_sbav = sbav_info.tempo_ciclo_sec;
    const sb = t_sbav * co;
    sbav_fin = sb * qta < 10 ? 10 / qta : sb;
  }

  // ── Tornitura ─────────────────────────────────────────────
  const differenza_fil = dia_disp - medio;

  // Calcolo lunghezze da tornire (in base a tipo + STAMPAGGIO).
  // Per 5737/5931/speciale stampati, la parte filettata è formata in
  // stampaggio e rullata direttamente: L_filettata = 0.
  let L_liscia = 0, L_filettata = 0;
  if (tipo === '5739') {
    L_liscia    = 0;
    L_filettata = lungh;
  } else if (tipo === '5737' || tipo === '5931' || tipo === 'speciale') {
    L_liscia    = lungh_liscia;                      // = lungh - filet (se filet>0)
    L_filettata = filet;
  }

  const tornitura_info = calcolaTorniturraViti(
    tipo, dian, medio, dia_disp, dpl,
    L_filettata, L_liscia,
    mat, materiale_speciale,
    STAMPAGGIO, dati_testa,
    peso,
    T
  );
  // Narrazione naturale per il popup. Costruita qui (non dentro
  // calcolaTorniturraViti) per evitare di propagare TV nella signature:
  // i setup CN viti vivono in TV.setup_secondi.tornitura, gli altri in T.
  tornitura_info.narrazione = costruisciNarrazioneTornituraViti(tornitura_info, {
    torn_sec:          tornitura_info.is_copiatore
                         ? T.setup_secondi.setup_copiatore
                         : TV.setup_secondi.tornitura,
    intestazione_sec:  T.setup_secondi.intestazione,
    testa_E1_sec:      T.setup_secondi.testa_5931_intestazione,
    testa_E2_sec:      T.setup_secondi.testa_5931_tornitura,
    copiatore_sec:     T.setup_secondi.setup_copiatore,
    tempo_min:         T.tornitura_controllo.tempo_minimo_secondi,
  });
  // Piazzamenti (approntamento) per la sezione tabellare del popup.
  // Single source of truth nei moduli: il renderer itera sull'array.
  tornitura_info.piazzamenti = (() => {
    if (!tornitura_info.has_tornitura) return [];
    const p = [];
    // Macchina principale: Copiatore (V5/V6/V7) o Tornio CN (V1/V2/V8/V10/V11)
    if (tornitura_info.is_copiatore) {
      p.push({ nome: 'Copiatore', setup_sec: T.setup_secondi.setup_copiatore });
    } else {
      p.push({ nome: 'Tornio CN', setup_sec: TV.setup_secondi.tornitura });
    }
    // Intestazione del tondo (V1/V2/V10 FRESA, has_intestazione = C > 0)
    if (tornitura_info.has_intestazione) {
      p.push({ nome: 'Intestazione', setup_sec: T.setup_secondi.intestazione });
    }
    // Testa 5931 inox/altro: 2 piazzamenti distinti (V7 ibrido o V8 inox/altro)
    if (tornitura_info.has_testa_5931) {
      p.push({ nome: 'Testa 5931 — intestazione',     setup_sec: T.setup_secondi.testa_5931_intestazione });
      p.push({ nome: 'Testa 5931 — tornitura laterale', setup_sec: T.setup_secondi.testa_5931_tornitura });
    }
    return p;
  })();
  const t_torn = tornitura_info.tempo_totale;
  let torn_fin = 0;
  if (t_torn > 0) {
    const tc = t_torn * co;
    torn_fin = tc * qta < 10 ? 10 / qta : tc;
  }

  // ── Fresatura (testa esagonale 5737/5739/speciale + cava 5931/TCEI, unificate) ──
  // Lavorazione di scavo, due componenti:
  //   - testa esagonale: 5737/5739 con FRESA, e speciale con sub esagonale/quadrata/
  //     prismatica/troncopiramidale (sotto-forme con facce piane; le sotto-forme
  //     di pura tornitura — troncoconica, cilindrica, bombata, sferica — non
  //     ricevono fresatura testa)
  //   - cava esagonale interna: 5931 (sempre con FRESA, con STAMP solo inox/altro)
  //     e speciale con sub='tcei' (sempre)
  // Il minimo 90s è applicato a monte dentro le funzioni; il vecchio minimo
  // costo €1.62 è stato sostituito dal minimo tempo (numericamente equivalente
  // sul carbonio con co1, leggermente più alto su pezzi co2).
  let t_fresa = 0, fresa_fin = 0;

  const ha_fresa_testa = !STAMPAGGIO && (
    tipo === '5737' || tipo === '5739' ||
    (tipo === 'speciale' && (
      dati_testa.sub === 'esagonale' ||
      dati_testa.sub === 'quadrata' ||
      dati_testa.sub === 'prismatica' ||
      dati_testa.sub === 'troncopiramidale'
    ))
  );
  if (ha_fresa_testa) {
    let chiave_testa = 0;
    if (tipo === 'speciale') {
      const sub = dati_testa.sub;
      if      (sub === 'esagonale')        chiave_testa = dati_testa.s ?? 0;
      else if (sub === 'quadrata')         chiave_testa = inp.spec_qu_lato ?? 0;
      else if (sub === 'prismatica')       chiave_testa = Math.max(inp.spec_pr_lungh ?? 0, inp.spec_pr_largh ?? 0);
      else if (sub === 'troncopiramidale') chiave_testa = inp.spec_tp_lato_mag ?? 0;
    } else {
      // 5737/5739: chiave esagono testa esposta da getDatiTesta
      chiave_testa = dati_testa.s ?? 0;
    }
    if (chiave_testa > 0) {
      t_fresa += tempoFresaturaTestaEsagonale(chiave_testa, mat, materiale_speciale, T);
    }
  }

  const isTcei = tipo === 'speciale' && dati_testa.sub === 'tcei';
  const ha_fresa_cava =
    (tipo === '5931' && (!STAMPAGGIO || MAT_INOX.includes(mat))) || isTcei;
  if (ha_fresa_cava) {
    const ch_x = dati_testa.sc ?? 0;
    if (ch_x > 0) {
      t_fresa += tempoFresaturaCava(ch_x, mat, materiale_speciale, T);
    }
  }

  if (t_fresa > 0) {
    const fc = t_fresa * co;
    fresa_fin = fc * qta < 10 ? 10 / qta : fc;
  }

  // ── Rullatura ─────────────────────────────────────────────
  let t_rulla    = calcolaTempoRullatura(dian, filet, mat, TV);
  t_rulla        = applicaDegradoOperatore(t_rulla, qta, T);
  const ru_c     = t_rulla * co;
  const rull_fin = ru_c * qta < 10 ? 10 / qta : ru_c;

  // ── Raddrizzatura ─────────────────────────────────────────
  const raddr_c   = calcolaRaddrizzatura(dian, lungh, mat, TRATTAMENTO, TV);
  const raddr_fin = raddr_c > 0 ? (raddr_c * qta < 10 ? 10 / qta : raddr_c) : 0;
  const t_raddr   = raddr_c > 0 ? Math.round(raddr_c / 0.016) : 0;

  // ── Bonifica ─────────────────────────────────────────────
  const bonifica = calcolaBonificaViti(peso, qta, dian, lungh, TRATTAMENTO, costo_bonifica_kg, forfait_bonifica);

  // ── Attrezzatura (inox/altro) ─────────────────────────────
  // Nessuna attrezzatura se inox stampato partendo già dal diametro medio (nessuna tornitura)
  const attrezzatura = isInox && !(STAMPAGGIO && differenza_fil <= 0 && t_torn === 0) ? 0.6 : 0;

  // ── Marcatura ─────────────────────────────────────────────
  const marc_fin = calcolaMarcatura(dian, qta, mat, STAMPAGGIO, TV);

  // ── Setup (approntamento) ─────────────────────────────────
  const S = TV.setup_secondi;
  const setup_taglio  = setupCosto(S.taglio,    co1, qta);
  const setup_smusso  = sm_info ? setupCosto(sm_info.setup_sec, co1, qta) : 0;
  const setup_stamp   = STAMPAGGIO ? setupCosto(S.stampaggio, co1, qta) : 0;
  const setup_sbav    = STAMPAGGIO && sbav_info ? setupCosto(sbav_info.setup_sec, co1, qta) : 0;
  // Setup tornitura: 1800s sul copiatore (semiautomatico), 3600s sul CN
  const setup_torn    = tornitura_info.has_tornitura
    ? setupCosto(
        tornitura_info.is_copiatore
          ? T.setup_secondi.setup_copiatore
          : S.tornitura,
        co1, qta
      )
    : 0;
  const setup_intestazione = tornitura_info.has_intestazione
    ? setupCosto(T.setup_secondi.intestazione, co1, qta)
    : 0;
  const setup_testa_5931 = tornitura_info.has_testa_5931
    ? setupCosto(T.setup_secondi.testa_5931_intestazione, co1, qta) +
      setupCosto(T.setup_secondi.testa_5931_tornitura,    co1, qta)
    : 0;
  const setup_fresa   = t_fresa > 0 ? setupCosto(S.fresatura,  co1, qta) : 0;
  const setup_rull    = setupCosto(S.rullatura,  co1, qta);
  const setup_raddr   = raddr_c > 0 ? setupCosto(S.raddrizzatura, co1, qta) : 0;

  // ── Totale ───────────────────────────────────────────────
  const lavorazione = ta + smusso_fin + stamp_fin + sbav_fin
                    + torn_fin + fresa_fin
                    + rull_fin + raddr_fin + marc_fin + attrezzatura
                    + setup_taglio + setup_smusso + setup_stamp + setup_sbav
                    + setup_torn + setup_intestazione + setup_testa_5931
                    + setup_fresa
                    + setup_rull + setup_raddr;

  const totale = mat_cost_plus + lavorazione + bonifica;

  // ── Peso finito (informativo) ─────────────────────────────
  const peso_testa_kg = calcolaPeso(dia_disp, h_testa, dens);
  const peso_fil_kg   = calcolaPeso(medio, filet, dens);
  const peso_liscia_kg = lungh_liscia > 0 ? calcolaPeso(dpl, lungh_liscia, dens) : 0;
  const peso_fin      = peso_testa_kg + peso_fil_kg + peso_liscia_kg;

  // ── Peso lotto ───────────────────────────────────────────
  const peso_principale_reale = peso * (qta_x > 0 ? qta_x : qta);

  // ── Stringa gestionale ───────────────────────────────────
  const S_tag = TV.setup_secondi;
  const lines = [];
  lines.push(`TAGLI ${t_taglio}`);
  if (ha_smusso)   lines.push(`SMUSS ${Math.round(t_smusso)}`);
  if (STAMPAGGIO)  lines.push(`STAM2 ${Math.round(t_stamp)}`);
  if (STAMPAGGIO && sbav_info) lines.push(`SBAVA ${Math.round(t_sbav)}`);
  // Tornitura: TORN1 sul copiatore, TORN2 sul CN (incl. caso ibrido che
  // mette tutto in TORN1 perché is_copiatore=true)
  if (t_torn > 0) {
    if (tornitura_info.is_copiatore) {
      lines.push(`TORN1 ${Math.round(t_torn)}`);
    } else {
      lines.push(`TORN2 ${Math.round(t_torn)}`);
    }
  }
  if (t_fresa > 0) lines.push(`FRESA ${Math.round(t_fresa)}`);
  lines.push(`RULLA ${Math.round(t_rulla)}`);
  if (raddr_c > 0) lines.push(`RADDR ${Math.round(raddr_c / 0.016)}`);
  lines.push(`ATAGL ${S_tag.taglio}`);
  if (sm_info)     lines.push(`ASMUS ${sm_info.setup_sec}`);
  if (STAMPAGGIO)  lines.push(`ASTA2 ${S_tag.stampaggio}`);
  if (STAMPAGGIO && sbav_info) lines.push(`ASBAV ${sbav_info.setup_sec}`);
  // Setup tornitura — una riga ATOR1/ATOR2 per ogni piazzamento applicato
  // nel costo (tornitura, intestazione, testa 5931). ATOR1 SOLO per il
  // copiatore (1800); ATOR2 per tutti gli altri (CN 3600, intestazione
  // 1800, testa 5931 totale 3600, fantina 7200).
  if (t_torn > 0) {
    if (tornitura_info.is_copiatore) {
      // Setup copiatore (1800)
      lines.push(`ATOR1 ${T.setup_secondi.setup_copiatore}`);
      // Caso ibrido: 5931 inox/altro al copiatore + ramo E (testa)
      if (tornitura_info.has_testa_5931) {
        const setup_5931 = T.setup_secondi.testa_5931_intestazione +
                           T.setup_secondi.testa_5931_tornitura;
        lines.push(`ATOR2 ${setup_5931}`);
      }
    } else {
      // Setup tornitura CN (3600)
      lines.push(`ATOR2 ${S_tag.tornitura}`);
      // Setup intestazione (1800) per vite tornita-fresata da tondo
      if (tornitura_info.has_intestazione) {
        lines.push(`ATOR2 ${T.setup_secondi.intestazione}`);
      }
      // Setup testa 5931 (3600) per CN puro 5931 inox/altro
      if (tornitura_info.has_testa_5931) {
        const setup_5931 = T.setup_secondi.testa_5931_intestazione +
                           T.setup_secondi.testa_5931_tornitura;
        lines.push(`ATOR2 ${setup_5931}`);
      }
    }
  }
  if (t_fresa > 0) lines.push(`AFRES ${S_tag.fresatura}`);
  lines.push(`ARULL ${S_tag.rullatura}`);
  if (raddr_c > 0) lines.push(`ARADD ${S_tag.raddrizzatura}`);
  lines.unshift(`\u20AC ${totale.toFixed(2)} - da mat. ${mat} \u00D8 ${dia_disp.toFixed(1)} mm, ${peso_principale_reale.toFixed(2)} kg`);
  const tempi_gestionale = lines.join('\n');

  // ── Output ───────────────────────────────────────────────
  return {
    // Identificativi
    tipo, mat, dian, medio, dia_disp,

    // Geometria
    filet, lungh_liscia, lungh_spezzone, sviluppo_testa,
    h_testa,
    peso, peso_fin,
    mod_qta,

    // Materiale
    mat_cost, mat_cost_plus, costo_kg,

    // Costi singoli (per pz)
    ta, smusso_fin, stamp_fin, sbav_fin,
    torn_fin, fresa_fin,
    rull_fin, raddr_fin, marc_fin,
    attrezzatura, bonifica,

    // Setup
    setup_taglio, setup_smusso, setup_stamp, setup_sbav,
    setup_torn, setup_intestazione, setup_testa_5931,
    setup_fresa, setup_rull, setup_raddr,

    // Sbavatura info
    sbav_macchina: sbav_info ? sbav_info.nome_display : null,
    setup_sbav_sec: sbav_info ? sbav_info.setup_sec : 0,

    // Tempi (secondi, per gestionale)
    t_taglio, t_smusso, t_stamp, t_sbav,
    t_torn, t_fresa,
    t_rulla: Math.round(t_rulla),
    t_raddr,

    // Totali
    lavorazione, totale,
    tempi_gestionale,

    // Campi compatibilità con renderResults (altri moduli usano costo_tot/costo_lav)
    costo_tot: totale,
    costo_lav: lavorazione,

    // Per card peso
    qta, qta_x,
    diam: medio,
    peso_principale: peso_principale_reale,
    peso_principale_reale,
    mod_peso: 1,
    peso_lotto_completo: qta_x > 0 ? peso * qta : null,
    qta_str: null,
    messages: [],
    BARRA_GIUSTA: false,

    // Flag attivi (per UI)
    ha_smusso,
    ha_stamp:  STAMPAGGIO,
    ha_torn:   t_torn > 0,
    ha_fresa:  t_fresa > 0,
    ha_raddr:  raddr_c > 0,
    ha_bonifica: TRATTAMENTO,

    // Diagnostica tornitura
    tornitura_info,
  };
}
