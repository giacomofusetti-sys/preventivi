# Procedura release

Da seguire ogni volta che si rilascia una nuova versione dell'app.

## Checklist

1. **Aggiorna `lib/version.js`**
   - Bumpa `VERSION` secondo SemVer:
     - PATCH (1.0.X) → bugfix e modifiche minori
     - MINOR (1.X.0) → nuove feature o refactor significativi
     - MAJOR (X.0.0) → cambi di paradigma o riscritture
   - Aggiorna `VERSION_DATE` alla data di oggi (formato ISO `YYYY-MM-DD`)

2. **Aggiungi una entry in cima a `CHANGELOG.md`**
   - Segui lo stile delle entry esistenti (formato Keep a Changelog)
   - Sezioni: `Added` / `Changed` / `Fixed` / `Removed` / `Internal`
   - Per i bugfix usa stile narrativo: descrivi il sintomo prima del fix
   - Riferisci file e funzioni concrete per facilitare il recupero futuro

3. **Bumpa `?v=` sugli import dei moduli toccati**
   - Convenzione: tutti i moduli allo stesso `?v=` per coerenza
   - In `index.html`: import di `viti`, `dadi`, `prigionieri`,
     `tiranti_unificato`, `tiranti_occhio`, `lib/calcolo_comune`,
     `lib/version`

4. **Commit e push**
   - Una sola release = un commit di "release" che include i 3 punti sopra
   - I commit di feature/fix possono accumularsi prima della release
