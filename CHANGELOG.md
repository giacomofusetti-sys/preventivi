# Changelog

Tutte le modifiche significative all'app **preventivi** sono
documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
e il progetto segue [Semantic Versioning](https://semver.org/lang/it/).

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
