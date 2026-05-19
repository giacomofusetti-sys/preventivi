# Changelog

Tutte le modifiche significative all'app **preventivi** sono
documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
e il progetto segue [Semantic Versioning](https://semver.org/lang/it/).

## [1.0.6] — 2026-05-19

### Added
- **Blocco `T.taglio` in `comune.json` con modello lineare calibrato.**
  Nuovo schema con `modello`, `range_dia_validato`, e 4 gruppi
  materiale (`standard`, `inox`, `f51`, `superleghe`), ciascuno con
  coefficienti `m`, `q` e lista dei materiali documentativa. Sostituisce
  il blocco legacy `T.taglio.{standard,inox_altro}` (tier-list di costi
  diretti, ormai orfano nei calcoli, sopravvissuto solo come dato di
  consultazione).

### Changed
- **Nuovo modello lineare per `calcolaTempoTaglio` in
  `lib/calcolo_comune.js`.** Sostituisce la formula grossolana
  precedente (`dian/2`, `dian`, `dian*4` con un'unica categoria "altro"
  indistinta) con un modello calibrato su dati misurati forniti dal
  responsabile officina: `t_sec = m · dia + q` per gruppo materiale.
  Validazione statistica: R² > 0.96 per tutti i gruppi, R² > 0.999
  per F51 e superleghe. Range validato: 6-80 mm; fuori range extrapola
  linearmente. Nuova firma: `calcolaTempoTaglio(dia, mat,
  materiale_speciale, T)`. Distingue ora F51/F53 dal blocco superleghe
  (Nitronic/718/660/625) — prima erano trattate uguali. Il valore
  `materiale_speciale = '0'` (Generico) non è ammesso per il taglio
  (errore esplicito).

- **`moduli/tiranti_unificato.js`: passa `materiale_speciale` a
  `calcolaTempoTaglio`.** Aggiornati i 2 callsite (path semplice riga
  104, path tornito riga 209). Abilita la distinzione fine tra F51
  e superleghe nei calcoli di taglio per i tiranti.

- **`moduli/viti.js`: sostituita la tier-list inline di taglio
  (righe 866-881 pre-refactor) con chiamata alla funzione centrale.**
  Convenzione di conversione tempo → costo allineata a
  `tiranti_unificato.js`: `tempo × co1` → `modulaCostoTaglio` →
  `taglioFin`. **Cambio di comportamento consapevole**: viti pre-1.0.6
  NON applicava il cap qta-dipendente di `modulaCostoTaglio` (€2/pz
  per qta 11-20, €1/pz per qta > 20, dimezzato per `mat='altro'`).
  Ora lo applica. Sui pezzi piccoli/medi nessuna differenza pratica
  (ta_raw < cap); sui pezzi grossi in superleghe ad alta qta il
  costo unitario di taglio è ora cappato. Da rivalutare con
  `modulaCostoTaglio` stessa in una release futura (la modulazione
  qta è una pezza obsoleta che il nuovo modello lineare potrebbe
  rendere superflua).

- **Sezione "Taglio" in `consultazione.html` riscritta.** Mostra ora
  il modello (`m·dia + q`), i coefficienti per gruppo con relativi
  materiali, e una tabella di esempio con i tempi calcolati a diametri
  tipici (Ø 6, 12, 20, 30, 42, 56, 72, 80) per ciascuno dei 4 gruppi.

### Internal
- `lib/calcolo_comune.js`: aggiunta mappa interna `GRUPPO_TAGLIO`
  (materiale → gruppo) per risoluzione runtime O(1). Duplicazione
  consapevole con `T.taglio.gruppi[].materiali` (documentativo,
  letto da consultazione.html). Se si aggiunge un materiale a un
  gruppo, aggiornare ENTRAMBI.
- Invariante del dominio mantenuta: la fantina è l'unica lavorazione
  che NON dipende dal taglio a monte, perché taglia direttamente in
  macchina durante la tornitura. Coerentemente, `tempoFantina` non
  chiama `calcolaTempoTaglio`.
- Funzioni di taglio LOCALI di `moduli/dadi.js:55`, `moduli/prigionieri.js:62`,
  `moduli/tiranti_occhio.js:66` NON toccate in questa release.
  Semanticamente diverse (tier-list storiche calibrate per il taglio
  specifico di quei pezzi: dadi corti, prigionieri/tiranti_occhio con
  loro convenzioni). Una task futura valuterà se unificarle col modello
  centrale sulla base di dati misurati specifici per ciascuna tipologia.
- Cache-bust: `?v=16` → `?v=17`.

## [1.0.5] — 2026-05-19

### Added
- **Macchina "Tela" nel modello smusso.** Aggiunta come terza
  macchina dedicata (oltre a Copiatore e Ceriotti) per gestire
  lotti piccolissimi (qta ≤ 20). Range Ø 8-30.60 mm, lunghezza
  20-1100 mm, setup 15 minuti. Caratteristica unica: usa
  interpolazione 2D media su (Ø, lunghezza) per il calcolo del
  tempo, perché il range lunghezza è molto ampio e impatta
  significativamente il tempo. Le altre macchine restano in 1D
  sul Ø. Logica selezione passa da 2 a 3 livelli: qta ≤ 20 →
  Tela, n_smussi ≥ 100 → Copiatore, altrimenti → Ceriotti
  (tornio CN come ultimo fallback).

### Changed
- **Sbavatura centralizzata in comune (dato + funzione).** Il
  blocco JSON sbavatura era in `viti.json`, ma la sbavatura è
  un'operazione applicabile concettualmente a tutti i prodotti.
  Spostato in `comune.json`, accanto al gemello strutturale
  smusso. La funzione `calcolaSbavatura`, prima in
  `moduli/viti.js`, ora vive in `lib/calcolo_comune.js` adiacente
  a `calcolaSmusso` (gemello). Firma aggiornata: `TV` → `T`.
  Refactor puramente organizzativo, nessun valore numerico cambia.

- **Trattamento termico centralizzato in un punto di verità.**
  Il valore €1.30/kg e il forfait €400 erano duplicati in 8 punti
  del codice (HTML, fallback inline, default param moduli). Ora
  vivono in `T.trattamento_termico` in `comune.json`, autoritativo.
  Aggiunto helper `applicaTrattamento(R, T)` in `index.html` che
  deduplica 3 formule inline identiche per tiranti/prigionieri/
  tiranti_occhio. `populateDefaultsFromJSON(T)` chiamato dopo il
  fetch sincronizza i 4 campi UI col JSON (HTML diventa solo
  placeholder). Rimossi default param ridondanti in `calcolaViti`
  per allineamento con `dadi.js` (no rete di sicurezza modulo).
  Dadi non toccati: gestiscono il trattamento internamente al
  modulo con un pattern diverso.

- **`calcolaSmusso` ora confronta `dia_disp` invece di `dian` con
  i range macchina.** I range Ø in `T.smusso.*` sono espressi in
  diametri fisici/medi (es. `copiatore.diametro_max=44.5` = medio
  M48; `tela.diametro_max=30.60` = medio M33), non in nominali UNI.
  Il confronto con `dian` (nominale) rifiutava erroneamente i
  pezzi al limite alto di ogni macchina. Garanzia semantica: i
  callsite garantiscono `dia_disp ≈ medio` (lo smusso si attiva
  solo nel ramo "no tornitura"). Effetto numerico: pezzi al
  limite alto ora correttamente accettati dalla macchina dedicata
  (M33 → Tela, M48 → Copiatore, ecc.); pezzi normali hanno
  tempi interpolati leggermente più bassi (pochi % perché medio
  è < del nominale, scarto fisiologico). `calcolaSbavatura` NON
  riceve il fix simmetrico: decisione esplicita, da riprendere
  in un refactor dedicato se servirà.

- **Calibrazione Tela: `tempo_ciclo` espresso per smusso, non per
  pezzo.** I valori originariamente forniti (15-30s) erano "tempo
  per pezzo intero", incoerenti con la convenzione del resto del
  modello smusso (tempo per smusso, moltiplicato dal caller per
  `smussi_per_pezzo`). Dimezzati a 7.5-15s. La formula del caller
  ricostruisce il tempo totale come atteso: viti (1 smusso)
  7.5-15s/pezzo, tiranti (2 smussi) 15-30s/pezzo. Aggiunta nota
  `_nota_tempo_ciclo` inline in `comune.json` per prevenire
  regressioni.

### Fixed
- **Validazione parte liscia: bug pre-esistente sulle viti 5739
  e tutto filetto.** La validazione fail-fast introdotta in v1.0.3
  scattava erroneamente per le viti 5739 (tutto filetto per
  definizione UNI) e per qualsiasi vite con `TF=true`, perché
  `dia_parte_liscia` viene popolato come fallback al diametro
  nominale anche quando la parte liscia non esiste fisicamente
  (`L_liscia=0`). Fix: validare solo quando `L_liscia > 0` (la
  parte liscia esiste fisicamente). Bug latente di v1.0.3, attivo
  solo per casi 5739/TF con `dia_disp < dian`. Nessun preventivo
  esistente compromesso, solo blocco runtime.

### Internal
- `lib/calcolo_comune.js`: `calcolaSbavatura` aggiunta come
  funzione esportata (era interna a `moduli/viti.js`);
  `MAT_STANDARD_SBAV` e `NOMI_DISPLAY_SBAV` migrate accanto alla
  funzione.
- `lib/calcolo_comune.js`: `calcolaSmusso` firma cambiata da
  `dian` a `dia_disp`, 6 occorrenze interne aggiornate. JSDoc
  esteso con nota "perché dia_disp e non dian".
- `lib/calcolo_comune.js`: aggiunto supporto interpolazione 2D
  nella selezione macchina smusso (esclusivo della Tela). Lista
  macchine: `['copiatore', 'tela', 'ceriotti']`.
- `tabelle/comune.json`: nuovo blocco `T.trattamento_termico`,
  blocco `T.smusso.tela`, parametro `T.smusso.soglia_qta_tela=20`,
  nota `_nota_tempo_ciclo` inline alla Tela. Blocco `T.sbavatura`
  spostato qui da `viti.json`.
- `moduli/viti.js`: rimossi default param `costo_bonifica_kg=1.30`
  e `forfait_bonifica=400` in `calcolaViti` (no rete di sicurezza
  modulo). Rimosso debug `console.log` dimenticato. Validazione
  parte liscia con guardia `L_liscia > 0`. Callsite `calcolaSmusso`
  e `calcolaSbavatura` aggiornate.
- `moduli/tiranti_unificato.js`: callsite `calcolaSmusso`
  aggiornata.
- `index.html`: nuovo helper `applicaTrattamento(R, T)`; nuovo
  `populateDefaultsFromJSON(T)` chiamato post-fetch; 8 fallback
  hardcoded 1.30/400 sostituiti con riferimenti a
  `T.trattamento_termico.*`.
- `consultazione.html`: nuova sezione "Trattamento termico";
  sezione "Smusso" riscritta per 3 macchine + tornio (tabella
  selezione a 3 livelli, colonna interpolazione 1D/2D, nota
  esplicita sulla differenza qta vs n_smussi); riferimenti
  `TV.sbavatura` → `T.sbavatura`.
- Corretti 6 commenti narrativi pre-esistenti (riferimenti
  obsoleti a "viti.js", claim errato "ordine INVERSO" tra
  smusso e sbavatura — in realtà i pattern sono identici
  pre-Tela, divergenti post-Tela).
- Cache-bust: `?v=11` → `?v=16` (5 bump nel periodo).

## [1.0.4] — 2026-05-13

### Changed
- **Setup macchina taglio: da costante a modello dinamico.** Il
  setup taglio (ATAGL nel gestionale) era una costante di 300 s
  (5 minuti) uniforme per tutti i prodotti. Ora è calcolato
  dinamicamente in base al numero di barre da movimentare per il
  lotto. Formula: num_barre = ceil((lungh_pezzo + sfrido) × qta /
  lungh_barra), con sfrido 5 mm, barra standard 6 metri. Setup =
  num_barre × 2 minuti, vincolato tra 11 e 30 minuti. Se dia_disp
  ≥ 26 mm, setup forzato a 30 minuti indipendentemente dal lotto.
  Ogni modulo passa la propria lunghezza geometrica del pezzo:
  tiranti/prigionieri = lunghezza pura, viti = lungh +
  sviluppo_testa (stampato) o lungh + h_testa (fresato), dadi =
  sviluppo (stampato) o altez (fresato/tornito), tiranti_occhio =
  lungh + testa intera (o equivalente stampato con upset). Il
  modello riflette la realtà operativa di officina: più barre da
  movimentare = più tempo di approntamento; barre grosse richiedono
  setup massimo a prescindere.

### Internal
- `lib/calcolo_comune.js`: nuova funzione esportata
  `calcolaSetupTaglio(lungh_geometrica, qta, dia_disp, T)` con
  JSDoc completo che documenta la convenzione di `lungh_geometrica`
  per ogni modulo.
- `tabelle/comune.json`: nuovo blocco `setup_taglio` con 6 parametri
  (`lungh_barra_mm`, `tempo_per_barra_sec`, `setup_min_sec`,
  `setup_max_sec`, `soglia_diametro_max`, `sfrido_mm`).
- Migrati 5 moduli alla nuova funzione: `tiranti_unificato`,
  `prigionieri`, `tiranti_occhio`, `viti`, `dadi`. Ciascuno passa
  la lunghezza geometrica appropriata, riusando le formule del peso
  materiale per coerenza.
- Rimosso `setup_secondi.taglio` da tutti i JSON (`comune`, `viti`,
  `prigionieri`, `dadi`) — non più letto da nessun modulo.
- `consultazione.html`: nuova sezione "Setup taglio — Modello
  dinamico" in COMUNE con i 6 parametri e formula esplicita.
- Cache-busting: bump `?v=10` → `?v=11` su tutti gli import.

## [1.0.3] — 2026-05-12

### Added
- Narrazione naturale nel popup "Dettaglio tornitura". Il popup
  mostra ora un blocco testuale in alto che racconta in linguaggio
  naturale cosa fa la macchina al pezzo: tornitura del gambo,
  intestazione, ripresa del sottotesta, movimentazione, totale,
  setup. La narrazione è dinamica per tutti i casi (V1-V11 viti
  + T1-T2 tiranti), con paragrafi separati per il caso ibrido
  5931 inox/altro stampata (copiatore + CN).
- Validazione fail-fast: parte liscia (`dia_parte_liscia`) non
  può superare il diametro della barra di partenza (`dia_disp`)
  oltre una tolleranza di 0.3 mm (per coprire la trafilatura
  standard). Errore esplicito con valori effettivi.

### Changed
- **Tornitura viti al CN: aggiunta passata di finitura sul
  gambo.** Sul tornio CN, dopo le passate di sgrossatura, si
  applica sempre una passata di finitura aggiuntiva sul gambo
  (parte liscia + parte filettata). Effetto: il tempo di
  tornitura del gambo aumenta di 1/N rispetto a prima (dove N
  è il numero di passate di sgrossatura). Non si applica a:
  copiatore (formula chiusa), fantina (modello a passaggio),
  intestazione/sottotesta/testa 5931, tiranti.
- **Copiatore vincolato a parte liscia al nominale.** Il caso
  "5737/5931 stampata mezzo filetto da barra al nominale"
  finiva sempre al copiatore, anche quando la parte liscia
  era ridotta rispetto al nominale (caso fisicamente non
  gestibile dal copiatore, che lavora in una sola passata su
  un solo diametro target). Ora la condizione di attivazione
  copiatore richiede anche che la parte liscia sia ≈ nominale
  (tolleranza 0.5 mm). Quando la parte liscia è ridotta, il
  pezzo va automaticamente al Tornio CN, che sa gestire i due
  diametri distinti.
- **Popup tornitura — sezione PIAZZAMENTI.** Le label macchina
  ora sono dinamiche e coerenti tra narrazione e tabella:
  "Copiatore", "Tornio CN", "Fantina", "Intestazione", "Testa
  5931 — intestazione", "Testa 5931 — tornitura laterale".
  Prima la tabella mostrava sempre "Tornitura normale 3600s"
  anche quando il pezzo era stato lavorato su copiatore
  (1800s) o fantina (7200s). Anche il caso 5931 inox/altro
  stampata (V7 ibrido) mostra ora i 3 piazzamenti distinti
  (copiatore + 2 piazzamenti testa 5931) invece di una riga
  aggregata.
- **Narrazione gambo CN: rimosso target "diametro medio".**
  Le narrazioni del ramo CN ora dicono "tornitura del gambo
  (Xs)" invece di "tornitura del gambo per portarlo al
  diametro medio (Xs)". La frase era imprecisa per i casi
  dove il gambo viene tornito al nominale (V8 standard) o a
  un diametro parte liscia ridotto (caso copiatore-declassato).
  Sul ramo copiatore la frase resta invariata ("al diametro
  medio") perché lì è semanticamente corretta.

### Internal
- `lib/calcolo_comune.js`: parametro opzionale `finitura_aggiuntiva`
  (default false) aggiunto a `tempoTornituraBase`. Retrocompatibile
  con tutte le chiamate esistenti.
- `moduli/viti.js`: nuovo helper `costruisciNarrazioneTornituraViti`
  che produce dinamicamente i template per gli 11 casi V1-V11.
- `moduli/viti.js`: nuovo campo `tornitura_info.piazzamenti`
  (array di `{nome, setup_sec}`) popolato condizionalmente dai
  moduli viti e tiranti. Single source of truth nei moduli,
  renderer generico in `index.html`.
- `moduli/tiranti_unificato.js`: campo `tornitura_info.narrazione`
  per i casi T1 (CN normale) e T2 (fantina). Campo
  `tornitura_info.piazzamenti` allineato al nuovo pattern.
- `index.html`: `renderTornDetail` riscritto per renderizzare
  dinamicamente narrazione (array di paragrafi) e piazzamenti
  (array di righe). Eliminati hardcode di label e fallback
  dispersi.
- `stile.css`: stile dedicato al blocco narrazione (Barlow
  Condensed 14px, border-bottom di separazione).

## [1.0.2] — 2026-05-08

### Changed
- **Ricalibrazione strutturale del modello SMUSS pre-filettatura.**
  Il vecchio sistema usava una tier-list con tempi calibrati per
  l'intera lavorazione del pezzo (entrambi gli smussi compresi per
  i tiranti). Il nuovo modello è strutturalmente identico a quello
  della sbavatura: 3 macchine candidate (tornio copiatore, Ceriotti,
  tornio CN come fallback), selezione basata su `n_smussi`
  (= `qta × smussi_per_pezzo`, con `smussi_per_pezzo=1` per viti e
  `=2` per tiranti), interpolazione lineare di `tempo_ciclo` e
  moltiplicatore materiale sul diametro nominale. I prezzi tiranti
  SMUSS cambieranno (in alcuni casi più alti, in altri più bassi)
  — è una nuova taratura basata sui tempi reali di lavorazione,
  non una correzione di errore.

### Internal
- Estratta la funzione `interpola()` da `viti.js` a
  `lib/calcolo_comune.js` come export condiviso, riusata sia da
  `calcolaSbavatura` sia dalla nuova `calcolaSmusso`.
- Rimossi `calcolaTempoSmusso`, `smussoCosto`, `smussoFin` da
  `lib/calcolo_comune.js` (sostituiti da `calcolaSmusso`).
- Rimossa funzione locale `calcolaTempoSmusso` da `viti.js` (era
  una versione duplicata, ora unificata).
- Pulizia tabelle JSON: rimossi `tempi_smusso_viti` e
  `setup_secondi.smusso` da `viti.json`; sostituito blocco
  `"smusso"` in `comune.json` (vecchia tier-list → nuovo modello
  a 3 macchine); rimosso `setup_secondi.smusso` da `comune.json`.
- `consultazione.html`: sezione "Smusso" riscritta sul nuovo modello
  a 3 macchine + moltiplicatori (analoga alla sezione "Fresatura"
  del refactor precedente).
- Cache-busting: bump `?v=6` → `?v=7` su tutti i moduli per
  coerenza, anche quelli non toccati dal refactor.

## [1.0.1] — 2026-05-07

### Changed
- Costo standard del trattamento termico aggiornato da €1.20/kg
  a €1.30/kg. Aggiornati sia il default UI in `index.html` (campi
  `costo_bonifica_kg` per viti e `prezzo_kg` per dadi/prigionieri/
  tiranti) sia il default del parametro in `moduli/viti.js`.

### Fixed
- **Materiale B7 mostrava prezzo errato all'avvio.** All'apertura
  dell'app il default era B7 ma il prezzo visualizzato era €1.70
  (residuo di L7) invece del corretto €1.60. Cambiando materiale
  e tornando su B7 il valore si aggiornava — ora invece il prezzo
  è sempre derivato da `COSTO_DEFAULT` in base al materiale
  selezionato, senza valori hardcoded. Effetto collaterale voluto:
  tornando al menu prodotti e rientrando, il prezzo viene resettato
  al default del materiale corrente (no trascinamento di modifiche
  manuali).
- **Pagina "Consultazione tabelle" rotta** dopo il refactor
  fresatura unificata (commit `dee978b`). La pagina cercava di
  rendere le vecchie chiavi `tempi_brocciatura` e
  `tempi_fresatura_testa` rimosse dal JSON. Aggiunta nuova sezione
  "Fresatura (modello)" in COMUNE che riflette la struttura attuale
  di `T.fresatura` (parametri base, moltiplicatori costanti, fasce
  per materiali "altro").

### Internal
- Cache-busting `?v=6` allineato su tutti gli import dei moduli
  (viti, dadi, prigionieri, tiranti_unificato, tiranti_occhio,
  calcolo_comune).
- Aggiunto sistema di versioning visibile in alto a destra con
  link al changelog.
