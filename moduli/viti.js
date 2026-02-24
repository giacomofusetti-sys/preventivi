// ============================================================
// viti.js — Viti M8-M48 (UNI 5737, 5739, 5931)
// Tipi: 5737 = esagonale con gambo, 5739 = esagonale tutta filettata
//       5931 = testa cilindrica con cava esagonale
// Modalità: STAMPAGGIO ON = testa stampata | OFF = testa fresata/tornita
// ============================================================

import {
  parseDia,
  getDiametroNominale,
  getDiametroMedio,
  calcolaPeso,
  parseQta,
  setupCosto,
} from '../lib/calcolo_comune.js';

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
  if (tipo === '5739') return lungh; // tutta filettata

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

function getDatiTesta(tipo, dia, mat, TV) {
  const key = String(dia);
  if (tipo === '5737' || tipo === '5739') {
    const s    = lookup(TV.chiavi_metriche, key)
              ?? lookup(TV.chiavi_pollici_p, key)
              ?? lookup(TV.chiavi_pollici_l, key);
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
    const dk_eff = (mat === 'inox' || mat === 'altro') ? dk + 2 : dk;
    const lato_c = sc ? sc / 1.732 : 0;
    // Volume testa cava = cilindro - scavo esagonale (con compensazione 4.3%)
    const vol_cil  = Math.PI * (dk_eff / 2) ** 2 * hc;
    const vol_scav = lato_c && t ? (lato_c * lato_c * 0.866 * 6) * t / 2 : 0;
    const vol_testa = (mat === 'inox' || mat === 'altro')
      ? Math.PI * (dk_eff / 2) ** 2 * hc           // per inox si torna la testa intera
      : (vol_cil - vol_scav) * (1 - 0.043);
    return { dk: dk_eff, hc, sc, t, vol_testa, tipo_testa: 'cava' };
  }
  throw new Error(`Tipo vite non riconosciuto: ${tipo}`);
}

// ─── SVILUPPO TESTA (per calcolo spezzone a stampaggio) ───────

function calcolaSviluppoTesta(tipo, dati_testa, area_tondo) {
  if (tipo === '5737' || tipo === '5739') {
    return dati_testa.vol_testa / area_tondo;
  }
  if (tipo === '5931') {
    return dati_testa.vol_testa / area_tondo;
  }
  return 0;
}

// ─── TORNITURA ────────────────────────────────────────────────

function calcolaTornitura(tipo, dian, medio, dia_disp, dia_parte_liscia,
                           filet, lungh, mat, STAMPAGGIO, dati_testa, TV) {
  const differenza_fil    = dia_disp - medio;
  const differenza_liscia = dia_disp - dia_parte_liscia;
  const lungh_liscia      = filet > 0 ? lungh - filet : 0;
  const div               = (mat === 'inox' || mat === 'altro') ? 3 : 4;

  // Parte filettata da tornire
  let pfdt = 0;
  if (tipo === '5739') {
    pfdt = differenza_fil > 0 ? lungh : 0;
  } else if (tipo === '5737') {
    pfdt = filet;
  } else if (tipo === '5931') {
    if (filet <= lungh && differenza_fil > 0) pfdt = filet;
    else if (lungh <= filet && differenza_fil <= 0) pfdt = 0;
    else pfdt = lungh;
  }

  // Parte liscia da tornire
  let pldt_base = 0;
  if (tipo === '5737') {
    pldt_base = differenza_liscia > 0 ? lungh_liscia : 0;
  } else if (tipo === '5931') {
    if (lungh <= filet && differenza_fil <= 0) pldt_base = 0;
    else if (differenza_liscia <= 0) pldt_base = 0;
    else pldt_base = lungh_liscia;
  }

  // Aggiungi tornitura testa per le cave
  let pldt = pldt_base;
  if (tipo === '5931') {
    const hc = dati_testa.hc ?? 0;
    if (!STAMPAGGIO) {
      // Con FRESA si torna sempre la testa cava
      pldt += hc;
    } else if (mat === 'inox' || mat === 'altro') {
      // Con STAMP su inox/altro si torna ugualmente la testa
      pldt += hc;
    }
  } else if ((tipo === '5737' || tipo === '5739') && !STAMPAGGIO) {
    // Con FRESA si torna la testa esagonale se il tondo è abbastanza grande
    const h = dati_testa.h ?? 0;
    const s = dati_testa.s ?? 0;
    if (dia_disp >= s * 1.154 + 5) pldt += h;
  }

  // Tempi
  const ttf = (pfdt / div) * Math.ceil(differenza_fil / 3);
  const ttl = (pldt  / div) * Math.ceil(Math.max(differenza_liscia, 0) / 3);

  let tempo = ttf + ttl;
  if (tempo > 0) tempo += 15;

  // Caso semplice: solo filetto su pezzo corto, gambo già a misura — nessun minimo
  if ((tipo === '5737' || tipo === '5931') && lungh < 350 && pldt_base === 0) {
    tempo = (filet / div) * Math.ceil(differenza_fil / 3) + 12;
    return tempo <= 0 ? 0 : tempo;
  }

  // Caso generale (tornitura parte liscia o pezzo lungo): minimo 90s
  if (tempo <= 0) return 0;
  tempo = Math.max(tempo, 90);
  return tempo;
}

// ─── SBAVATURA ────────────────────────────────────────────────

function calcolaTempoSbavatura(dian, mat, TV) {
  const tiers = (mat === 'inox' || mat === 'altro')
    ? TV.tempi_sbavatura.inox_altro
    : TV.tempi_sbavatura.standard;
  return tierValue(tiers, dian) ?? 0;
}

// ─── SMUSSO ───────────────────────────────────────────────────

function calcolaTempoSmusso(dian, mat, TV) {
  const tiers = (mat === 'inox' || mat === 'altro')
    ? TV.tempi_smusso_viti.inox_altro
    : TV.tempi_smusso_viti.standard;
  return tierValue(tiers, dian) ?? 0;
}

// ─── STAMPAGGIO ───────────────────────────────────────────────

function calcolaTempoStampaggio(dian, TV) {
  return tierValue(TV.tempi_stampaggio, dian) ?? 0;
}

// ─── BROCCIATURA ─────────────────────────────────────────────

function calcolaBrocciatura(dian, mat, tipo, STAMPAGGIO, materiale_speciale, TV) {
  // La brocciatura serve per le 5931 quando:
  // - con FRESA (qualsiasi materiale)
  // - con STAMPAGGIO su inox/altro (cava sempre brocciata)
  if (tipo !== '5931') return 0;
  const serve = !STAMPAGGIO || mat === 'inox' || mat === 'altro';
  if (!serve) return 0;

  let t = tierValue(TV.tempi_brocciatura, dian) ?? 0;
  const k = { F53: 2, '660': 3, '718': 4 }[materiale_speciale] ?? 1;
  t *= k;
  return t * 0.018; // costo diretto (come nel Python)
}

// ─── FRESATURA TESTA ─────────────────────────────────────────

function calcolaFresaturaTesta(dian, mat, tipo, TV) {
  // Solo per 5737/5739 con FRESA, o mai per 5931 (usa brocciatura)
  let t = tierValue(TV.tempi_fresatura_testa, dian) ?? 0;
  if (mat === 'inox' || mat === 'altro') t *= 2;
  return t;
}

// ─── RULLATURA ───────────────────────────────────────────────

function calcolaTempoRullatura(dian, filet, mat, TV) {
  const tiers = (mat === 'inox' || mat === 'altro')
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
    tipo,             // '5737' | '5739' | '5931'
    dia_raw,
    passo,
    lungh_raw,
    qta_raw,
    qta_x           = 0,
    mat,              // '42CD4'|'B16'|'41Cr'|'B7'|'L7'|'B7M'|'inox'|'altro'
    materiale_speciale = '0',
    dens_altro       = 7.916,
    costo_mat_override = 0,
    dia_disp_raw,
    TF               = false,   // filettatura totale forzata
    filetto_override = 0,
    dia_parte_liscia = 0,       // 0 = usa nominale
    chiave_tipo      = 'p',     // 'p' = pesante, 'l' = leggera (solo 5931 pollici)
    STAMPAGGIO       = true,
    TRATTAMENTO      = false,
    costo_bonifica_kg = 1.20,
    forfait_bonifica  = 400,
  } = inp;

  const { co1, co2 } = T.costi_base;

  // ── Parse input ──────────────────────────────────────────
  const dia  = parseDia(dia_raw);
  const dian = getDiametroNominale(T, dia);
  const medio = getDiametroMedio(T, dia, passo);
  const lungh = parseFloat(lungh_raw);
  const qta   = parseQta(qta_raw);
  const dia_disp = parseFloat(dia_disp_raw) || dian;
  const dpl   = dia_parte_liscia > 0 ? dia_parte_liscia : dian;

  if (isNaN(lungh) || lungh <= 0) throw new Error('Lunghezza non valida');
  if (isNaN(qta)   || qta   <= 0) throw new Error('Quantità non valida');

  // Validazione FRESA: dia_disp deve essere >= spigolo testa
  if (!STAMPAGGIO) {
    let s_rif = null;
    if (tipo === '5737' || tipo === '5739') {
      s_rif = lookup(TV.chiavi_metriche, String(dia))
           ?? lookup(TV.chiavi_pollici_p, String(dia))
           ?? lookup(TV.chiavi_pollici_l, String(dia));
    } else if (tipo === '5931') {
      s_rif = lookup(TV.chiavi_cava_metriche, String(dia));
      // per la cava, il limite è il diametro testa
      const dk = lookup(TV.diametri_testa_cava, String(dia));
      if (dk && dia_disp < dk) throw new Error(
        `Diametro barra (${dia_disp} mm) inferiore al diametro testa (${dk} mm). Per fresare serve un tondo più grosso.`
      );
    }
    if ((tipo === '5737' || tipo === '5739') && s_rif) {
      const spigolo = s_rif * 1.154;
      if (dia_disp < spigolo) throw new Error(
        `Diametro barra (${dia_disp} mm) inferiore allo spigolo (${spigolo.toFixed(1)} mm). Per fresare serve un tondo più grosso.`
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
  const isInox      = mat === 'inox' || mat === 'altro';

  // ── Lunghezza filetto ─────────────────────────────────────
  const filet = TF ? lungh : calcolaLunghFiletto(tipo, dia, lungh, filetto_override, TV);
  const lungh_liscia = filet > 0 ? lungh - filet : 0;

  // ── Dati testa ───────────────────────────────────────────
  const dati_testa = getDatiTesta(tipo, dia, mat, TV);
  const h_testa    = dati_testa.h ?? dati_testa.hc ?? 0;

  // ── Peso materiale ────────────────────────────────────────
  // Spezzone = lungh_gambo + altezza_testa + 5 (scarto)
  const area_tondo = Math.PI * (dia_disp / 2) ** 2;

  let lungh_spezzone;
  if (STAMPAGGIO) {
    const sviluppo = calcolaSviluppoTesta(tipo, dati_testa, area_tondo);
    lungh_spezzone = sviluppo + lungh + 5;
  } else {
    lungh_spezzone = lungh + h_testa + 5;
  }

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
  const ha_smusso  = Math.abs(dia_disp - medio) < 0.5;
  const t_smusso   = ha_smusso ? calcolaTempoSmusso(dian, mat, TV) : 0;
  const smusso_c   = t_smusso * co;
  const smusso_fin = t_smusso > 0 ? (smusso_c * qta < 10 ? 10 / qta : smusso_c) : 0;

  // ── Stampaggio ────────────────────────────────────────────
  let t_stamp = 0, stamp_c = 0, stamp_fin = 0;
  if (STAMPAGGIO) {
    t_stamp  = calcolaTempoStampaggio(dian, TV);
    stamp_c  = isInox ? t_stamp * co * 2 : t_stamp * co;
    stamp_fin = stamp_c * qta < 10 ? 10 / qta : stamp_c;
  }

  // ── Sbavatura ────────────────────────────────────────────
  let t_sbav = 0, sbav_fin = 0;
  if (STAMPAGGIO) {
    t_sbav   = calcolaTempoSbavatura(dian, mat, TV);
    const sb = t_sbav * co;
    sbav_fin = sb * qta < 10 ? 10 / qta : sb;
  }

  // ── Tornitura ─────────────────────────────────────────────
  const differenza_fil    = dia_disp - medio;
  const differenza_liscia = dia_disp - dpl;
  let t_torn = 0, torn_fin = 0;
  if (differenza_fil > 0 || !STAMPAGGIO) {
    t_torn = calcolaTornitura(
      tipo, dian, medio, dia_disp, dpl,
      filet, lungh, mat, STAMPAGGIO, dati_testa, TV
    );
    if (t_torn > 0) {
      const tc = t_torn * co;
      torn_fin = tc * qta < 10 ? 10 / qta : tc;
    }
  }

  // ── Fresatura testa (5737/5739 con FRESA) ─────────────────
  let t_fresa = 0, fresa_fin = 0;
  if (!STAMPAGGIO && (tipo === '5737' || tipo === '5739')) {
    t_fresa  = calcolaFresaturaTesta(dian, mat, tipo, TV);
    const minimo = 1.62;
    let fc = t_fresa * co;
    if (fc < minimo) fc = minimo;
    fresa_fin = fc * qta < 10 ? 10 / qta : fc;
  }

  // ── Brocciatura (5931 sempre; 5931 inox/altro anche stampata) ──
  let brocc_c = 0, brocc_fin = 0;
  if (tipo === '5931') {
    brocc_c  = calcolaBrocciatura(dian, mat, tipo, STAMPAGGIO, materiale_speciale, TV);
    brocc_fin = brocc_c * qta < 10 ? 10 / qta : brocc_c;
  }

  // ── Rullatura ─────────────────────────────────────────────
  const t_rulla  = calcolaTempoRullatura(dian, filet, mat, TV);
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
  const setup_smusso  = ha_smusso ? setupCosto(S.smusso,    co1, qta) : 0;
  const setup_stamp   = STAMPAGGIO ? setupCosto(S.stampaggio, co1, qta) : 0;
  const setup_sbav    = STAMPAGGIO ? setupCosto(S.sbavatura,  co1, qta) : 0;
  const setup_torn    = t_torn > 0  ? setupCosto(S.tornitura,  co1, qta) : 0;
  const setup_fresa   = t_fresa > 0 ? setupCosto(S.fresatura,  co1, qta) : 0;
  const setup_brocc   = brocc_c > 0 ? setupCosto(S.brocciatura,co1, qta) : 0;
  const setup_rull    = setupCosto(S.rullatura,  co1, qta);
  const setup_raddr   = raddr_c > 0 ? setupCosto(S.raddrizzatura, co1, qta) : 0;

  // ── Totale ───────────────────────────────────────────────
  const lavorazione = ta + smusso_fin + stamp_fin + sbav_fin
                    + torn_fin + fresa_fin + brocc_fin
                    + rull_fin + raddr_fin + marc_fin + attrezzatura
                    + setup_taglio + setup_smusso + setup_stamp + setup_sbav
                    + setup_torn + setup_fresa + setup_brocc
                    + setup_rull + setup_raddr;

  const totale = mat_cost_plus + lavorazione + bonifica;

  // ── Peso finito (informativo) ─────────────────────────────
  const peso_testa_kg = calcolaPeso(dia_disp, h_testa, dens);
  const peso_fil_kg   = calcolaPeso(medio, filet, dens);
  const peso_liscia_kg = lungh_liscia > 0 ? calcolaPeso(dpl, lungh_liscia, dens) : 0;
  const peso_fin      = peso_testa_kg + peso_fil_kg + peso_liscia_kg;

  // ── Stringa gestionale ───────────────────────────────────
  const S_tag = TV.setup_secondi;
  const lines = [];
  lines.push(`TAGLI ${t_taglio}`);
  if (ha_smusso)   lines.push(`SMUSS ${t_smusso}`);
  if (STAMPAGGIO)  lines.push(`STAM2 ${t_stamp}`);
  if (STAMPAGGIO)  lines.push(`SBAVA ${t_sbav}`);
  if (t_torn > 0)  lines.push(`TORN1 ${t_torn}`);
  if (t_fresa > 0) lines.push(`FRESA ${t_fresa}`);
  if (brocc_c > 0) lines.push(`BROCC ${Math.round(brocc_c / 0.018)}`);
  lines.push(`RULLA ${Math.round(t_rulla)}`);
  if (raddr_c > 0) lines.push(`RADDR ${Math.round(raddr_c / 0.016)}`);
  lines.push(`ATAGL ${S_tag.taglio}`);
  if (ha_smusso)   lines.push(`ASMUS ${S_tag.smusso}`);
  if (STAMPAGGIO)  lines.push(`ASTA2 ${S_tag.stampaggio}`);
  if (STAMPAGGIO)  lines.push(`ASBAV ${S_tag.sbavatura}`);
  if (t_torn > 0)  lines.push(`ATOR1 ${S_tag.tornitura}`);
  if (t_fresa > 0) lines.push(`AFRES ${S_tag.fresatura}`);
  if (brocc_c > 0) lines.push(`ABROC ${S_tag.brocciatura}`);
  lines.push(`ARULL ${S_tag.rullatura}`);
  if (raddr_c > 0) lines.push(`ARADDR ${S_tag.raddrizzatura}`);
  const tempi_gestionale = lines.join('\n');

  // ── Output ───────────────────────────────────────────────
  return {
    // Identificativi
    tipo, mat, dian, medio, dia_disp,

    // Geometria
    filet, lungh_liscia, lungh_spezzone,
    h_testa,
    peso, peso_fin,
    mod_qta,

    // Materiale
    mat_cost, mat_cost_plus, costo_kg,

    // Costi singoli (per pz)
    ta, smusso_fin, stamp_fin, sbav_fin,
    torn_fin, fresa_fin, brocc_fin,
    rull_fin, raddr_fin, marc_fin,
    attrezzatura, bonifica,

    // Setup
    setup_taglio, setup_smusso, setup_stamp, setup_sbav,
    setup_torn, setup_fresa, setup_brocc, setup_rull, setup_raddr,

    // Tempi (secondi, per gestionale)
    t_taglio, t_smusso, t_stamp, t_sbav,
    t_torn, t_fresa,
    t_brocc: brocc_c > 0 ? Math.round(brocc_c / 0.018) : 0,
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
    peso_principale: peso * (qta_x > 0 ? qta_x : qta),
    peso_principale_reale: peso * (qta_x > 0 ? qta_x : qta),
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
    ha_brocc:  brocc_c > 0,
    ha_raddr:  raddr_c > 0,
    ha_bonifica: TRATTAMENTO,
  };
}
