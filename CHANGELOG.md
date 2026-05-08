# Changelog

Tutte le modifiche significative all'app **preventivi** sono
documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
e il progetto segue [Semantic Versioning](https://semver.org/lang/it/).

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
