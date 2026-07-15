# Arb Desk — Signal Ledger

## Scop

Signal Ledger este interfața operațională a Arb Desk. Designul prioritizează trei decizii: dacă un semnal este executabil, ce dovadă îl susține și ce expunere produce. Informația decorativă este redusă, iar diferențele de stare sunt exprimate consecvent prin text, culoare și structură.

## Direcție vizuală

- Limbaj editorial financiar: hârtie caldă, cerneală închisă, linii de registru și numere tabulare.
- Accent vermilion rezervat comenzilor principale și indicilor de orientare.
- Verde pentru poziții validate, ocru pentru revizuire, roșu pentru respingere și albastru pentru analiză.
- Colțuri aproape drepte și umbre doar pentru elemente suprapuse: modal, toast și sertar.
- Titlurile folosesc Archivo; datele și codurile folosesc IBM Plex Mono; textul de lucru folosește IBM Plex Sans cu fallback-uri locale.

## Tokenuri

Tokenurile sunt definite în `public/css/design-tokens.css`.

- Fundal: `--bg`, `--surface`, `--surface-2`, `--surface-strong`.
- Text: `--text-primary`, `--text-secondary`, `--text-tertiary`.
- Linii: `--border`, `--border-soft`, `--border-strong`.
- Semnale: `--accent`, `--profit`, `--warning`, `--danger`, `--info` și variantele `*-soft`.
- Spațiere: scară de 4 px prin `--space-1` până la `--space-12`.
- Mișcare: 100–220 ms, cu suport complet pentru `prefers-reduced-motion`.

Tema luminoasă este implicită. Tema întunecată păstrează ierarhia și semantica stărilor, fără a modifica structura paginii.

## Anatomia aplicației

1. Index lateral: navigație numerotată pe Semnal, Operațiuni și Control.
2. Bandă de sistem: stare feed, căutare, sport, interval, alerte, temă și scanare.
3. Market tape: patru indicatori care rămân vizibili pe toate paginile.
4. Antet editorial: index de pagină, titlu, regulă operațională și acțiuni relevante.
5. Spațiu de lucru: carduri și tabele compacte, cu un rail contextual doar când ajută decizia.
6. Navigație mobilă: comenzile de frecvență mare sunt fixate jos sub 720 px.

## Componente și stări

- `arb-card`: oportunitate cu stare actionable, review, rejected sau analysis.
- `scanner-verdict`: explicația porții de siguranță; nu se bazează doar pe culoare.
- `evidence-badge` și `queue-pill`: etichete scurte pentru nivelul dovezii.
- `state-panel`: loading, empty și error cu aceeași anatomie.
- `value-card`, `journal-card`, `match-card`, `bookmaker-card`: suprafețe de date reutilizabile.
- `calc-card`: instrument matematic numerotat, cu rezultate în font monospațiat.
- `modal` și `bet-slip-drawer`: straturi operaționale cu focus vizibil și control Escape.

Orice funcție nouă trebuie să includă explicit stările loading, empty, error și disabled atunci când sunt aplicabile.

## Responsive

- Peste 1140 px: rail contextual și grile de două sau trei coloane.
- Între 720 și 1140 px: railul cade sub conținut, iar grilele se reduc la două coloane.
- Sub 720 px: sidebarul este înlocuit de navigația de jos, căutarea ocupă un rând complet, iar cardurile și semnalele devin o singură coloană.
- Sub 440 px: acțiunile importante se întind pe toată lățimea și indicatorii tape devin o listă verticală.

Pragul minim pentru controalele mobile este 34 px în testele automate și 44 px pentru containerele tactile principale.

## Accesibilitate

- Link de salt la conținut și structură semantică `nav`, `main`, `section`, `aside`.
- Focus vizibil pentru toate elementele interactive.
- `aria-live` pentru schimbări de date și rezultate de calculator.
- Capcana de focus și restaurarea focusului în dialogul de oportunitate.
- Contrast semantic verificabil în ambele teme.
- Culoarea este dublată de etichetă și explicație textuală.
- Animațiile sunt dezactivate pentru utilizatorii care preferă mișcare redusă.

## Contract funcțional

Reconstrucția păstrează toate ID-urile și atributele de rutare consumate de modulele JavaScript. Schimbările de prezentare nu trebuie să redenumească aceste contracte fără actualizarea simultană a testelor și a modulelor care le folosesc.

Versiunea anterioară reconstrucției este păstrată în `archive/design-zero-baseline-2026-07-14/` pentru comparație și recuperare punctuală.
