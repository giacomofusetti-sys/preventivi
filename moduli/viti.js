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

// ─── TORNITURA ────────────────────────────────────────────────

function calcolaTornitura(tipo, dian, medio, dia_disp, dia_parte_liscia,
                           filet, lungh, mat, STAMPAGGIO, dati_testa,
                           materiale_speciale, TV, T) {
  const differenza_fil    = dia_disp - medio;
  const differenza_liscia = dia_disp - dia_parte_liscia;
  const lungh_liscia      = filet > 0 ? lungh - filet : 0;
  const div               = MAT_INOX.includes(mat) ? 3 : 4;

  // Parte filettata da tornire
  let pfdt = 0;
  if (tipo === '5739') {
    pfdt = differenza_fil > 0 ? lungh : 0;
  } else if (tipo === '5737' || tipo === 'speciale') {
    pfdt = filet;
  } else if (tipo === '5931') {
    if (filet <= lungh && differenza_fil > 0) pfdt = filet;
    else if (lungh <= filet && differenza_fil <= 0) pfdt = 0;
    else pfdt = lungh;
  }

  // Parte liscia da tornire
  let pldt_base = 0;
  if (tipo === '5737' || tipo === 'speciale') {
    pldt_base = differenza_liscia > 0 ? lungh_liscia : 0;
  } else if (tipo === '5931') {
    if (lungh <= filet && differenza_fil <= 0) pldt_base = 0;
    else if (differenza_liscia <= 0) pldt_base = 0;
    else pldt_base = lungh_liscia;
  }

  // Aggiungi tornitura testa
  let pldt = pldt_base;
  if (tipo === '5931') {
    const hc = dati_testa.hc ?? 0;
    if (!STAMPAGGIO) {
      pldt += hc;
    } else if (MAT_INOX.includes(mat)) {
      pldt += hc;
    }
  } else if ((tipo === '5737' || tipo === '5739') && !STAMPAGGIO) {
    // Con FRESA si torna la testa esagonale se il tondo è abbastanza grande
    const h = dati_testa.h ?? 0;
    const s = dati_testa.s ?? 0;
    if (dia_disp >= s * 1.154 + 5) pldt += h;
  } else if (tipo === 'speciale' && !STAMPAGGIO) {
    // Con FRESA la testa speciale va tornita/fresata dal tondo
    pldt += dati_testa.h_testa ?? 0;
  }

  // Tempi
  const ttf = (pfdt / div) * Math.ceil(differenza_fil / 3);
  const ttl = (pldt  / div) * Math.ceil(Math.max(differenza_liscia, 0) / 3);

  let tempo = ttf + ttl;
  if (tempo > 0) tempo += 15;

  // Caso semplice: solo filetto su pezzo corto, gambo già a misura — nessun minimo
  if ((tipo === '5737' || tipo === '5931' || tipo === 'speciale') && lungh < 350 && pldt_base === 0 && differenza_fil <= 0) {
    tempo = (filet / div) * Math.ceil(differenza_fil / 3) + 12;
    if (tempo <= 0) return 0;
    if (mat === 'altro') {
      const k = T.materiali_speciali_k[materiale_speciale];
      if (!k) throw new Error('Specifica un materiale_speciale valido per "altro" (F53, 660, 718)');
      tempo *= k;
    }
    return tempo;
  }

  // Caso generale (tornitura parte liscia o pezzo lungo): minimo 90s
  if (tempo <= 0) return 0;
  tempo = Math.max(tempo, 90);
  if (mat === 'altro') {
    const k = T.materiali_speciali_k[materiale_speciale];
    if (!k) throw new Error('Specifica un materiale_speciale valido per "altro" (F53, 660, 718)');
    tempo *= k;
  }
  return tempo;
}

// ─── SBAVATURA ────────────────────────────────────────────────

// Interpolazione lineare con clamp [0,1]
function interpola(x, x_min, x_max, y_min, y_max) {
  if (x_max === x_min) return y_min;
  const t = Math.max(0, Math.min(1, (x - x_min) / (x_max - x_min)));
  return y_min + t * (y_max - y_min);
}

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

// ─── SMUSSO ───────────────────────────────────────────────────

function calcolaTempoSmusso(dian, mat, TV) {
  const tiers = MAT_INOX.includes(mat)
    ? TV.tempi_smusso_viti.inox_altro
    : TV.tempi_smusso_viti.standard;
  return tierValue(tiers, dian) ?? 0;
}

// ─── STAMPAGGIO ───────────────────────────────────────────────

function calcolaTempoStampaggio(dian, TV) {
  return tierValue(TV.tempi_stampaggio, dian) ?? 0;
}

// ─── BROCCIATURA ─────────────────────────────────────────────

function calcolaBrocciatura(dian, mat, tipo, STAMPAGGIO, materiale_speciale, TV, T, dati_testa) {
  // Brocciatura: 5931 con FRESA o con STAMPAGGIO su inox; vite speciale
  // solo se testa TCEI (tonda con cava esagonale).
  const isTceiSpec = tipo === 'speciale' && dati_testa?.sub === 'tcei';
  if (tipo !== '5931' && !isTceiSpec) return 0;
  const serve = isTceiSpec ? true : (!STAMPAGGIO || MAT_INOX.includes(mat));
  if (!serve) return 0;

  let t = tierValue(TV.tempi_brocciatura, dian) ?? 0;
  if (mat === 'altro') {
    const k = T.materiali_speciali_k[materiale_speciale];
    if (!k) throw new Error('Specifica un materiale_speciale valido per "altro" (F53, 660, 718)');
    t *= k;
  }
  return t * 0.018; // costo diretto (come nel Python)
}

// ─── FRESATURA TESTA ─────────────────────────────────────────

function calcolaFresaturaTesta(dian, mat, tipo, materiale_speciale, TV, T) {
  // Solo per 5737/5739 con FRESA, o mai per 5931 (usa brocciatura)
  let t = tierValue(TV.tempi_fresatura_testa, dian) ?? 0;
  if (MAT_INOX.includes(mat)) t *= 2;
  if (mat === 'altro') {
    const k = T.materiali_speciali_k[materiale_speciale];
    if (!k) throw new Error('Specifica un materiale_speciale valido per "altro" (F53, 660, 718)');
    t *= k;
  }
  return t;
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
    costo_bonifica_kg = 1.20,
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
  const ha_smusso  = Math.abs(dia_disp - medio) < 0.5;
  const t_smusso   = ha_smusso ? calcolaTempoSmusso(dian, mat, TV) : 0;
  const smusso_c   = t_smusso * co;
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
  let t_sbav = 0, sbav_fin = 0, sbav_info = null;
  if (STAMPAGGIO) {
    sbav_info = calcolaSbavatura(dian, lungh, mat, qta, co, TV);
    t_sbav = sbav_info.tempo_ciclo_sec;
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
      filet, lungh, mat, STAMPAGGIO, dati_testa,
      materiale_speciale, TV, T
    );
    if (t_torn > 0) {
      const tc = t_torn * co;
      torn_fin = tc * qta < 10 ? 10 / qta : tc;
    }
  }

  // ── Fresatura testa (5737/5739/speciale con FRESA) ────────
  let t_fresa = 0, fresa_fin = 0;
  if (!STAMPAGGIO && (tipo === '5737' || tipo === '5739' || IS_SPECIALE)) {
    t_fresa  = calcolaFresaturaTesta(dian, mat, tipo, materiale_speciale, TV, T);
    const minimo = 1.62;
    let fc = t_fresa * co;
    if (fc < minimo) fc = minimo;
    fresa_fin = fc * qta < 10 ? 10 / qta : fc;
  }

  // ── Brocciatura (5931 sempre; 5931 inox anche stampata; speciale solo TCEI) ──
  let brocc_c = 0, brocc_fin = 0;
  if (tipo === '5931' || (tipo === 'speciale' && dati_testa.sub === 'tcei')) {
    brocc_c  = calcolaBrocciatura(dian, mat, tipo, STAMPAGGIO, materiale_speciale, TV, T, dati_testa);
    brocc_fin = brocc_c * qta < 10 ? 10 / qta : brocc_c;
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
  const setup_smusso  = ha_smusso ? setupCosto(S.smusso,    co1, qta) : 0;
  const setup_stamp   = STAMPAGGIO ? setupCosto(S.stampaggio, co1, qta) : 0;
  const setup_sbav    = STAMPAGGIO && sbav_info ? setupCosto(sbav_info.setup_sec, co1, qta) : 0;
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

  // ── Peso lotto ───────────────────────────────────────────
  const peso_principale_reale = peso * (qta_x > 0 ? qta_x : qta);

  // ── Stringa gestionale ───────────────────────────────────
  const S_tag = TV.setup_secondi;
  const lines = [];
  lines.push(`TAGLI ${t_taglio}`);
  if (ha_smusso)   lines.push(`SMUSS ${t_smusso}`);
  if (STAMPAGGIO)  lines.push(`STAM2 ${t_stamp}`);
  if (STAMPAGGIO)  lines.push(`SBAVA ${Math.round(t_sbav)}`);
  if (t_torn > 0)  lines.push(`TORN1 ${t_torn}`);
  if (t_fresa > 0) lines.push(`FRESA ${t_fresa}`);
  if (brocc_c > 0) lines.push(`BROCC ${Math.round(brocc_c / 0.018)}`);
  lines.push(`RULLA ${Math.round(t_rulla)}`);
  if (raddr_c > 0) lines.push(`RADDR ${Math.round(raddr_c / 0.016)}`);
  lines.push(`ATAGL ${S_tag.taglio}`);
  if (ha_smusso)   lines.push(`ASMUS ${S_tag.smusso}`);
  if (STAMPAGGIO)  lines.push(`ASTA2 ${S_tag.stampaggio}`);
  if (STAMPAGGIO)  lines.push(`ASBAV ${sbav_info.setup_sec}`);
  if (t_torn > 0)  lines.push(`ATOR1 ${S_tag.tornitura}`);
  if (t_fresa > 0) lines.push(`AFRES ${S_tag.fresatura}`);
  if (brocc_c > 0) lines.push(`ABROC ${S_tag.brocciatura}`);
  lines.push(`ARULL ${S_tag.rullatura}`);
  if (raddr_c > 0) lines.push(`ARADDR ${S_tag.raddrizzatura}`);
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
    torn_fin, fresa_fin, brocc_fin,
    rull_fin, raddr_fin, marc_fin,
    attrezzatura, bonifica,

    // Setup
    setup_taglio, setup_smusso, setup_stamp, setup_sbav,
    setup_torn, setup_fresa, setup_brocc, setup_rull, setup_raddr,

    // Sbavatura info
    sbav_macchina: sbav_info ? sbav_info.nome_display : null,
    setup_sbav_sec: sbav_info ? sbav_info.setup_sec : 0,

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
    ha_brocc:  brocc_c > 0,
    ha_raddr:  raddr_c > 0,
    ha_bonifica: TRATTAMENTO,
  };
}
