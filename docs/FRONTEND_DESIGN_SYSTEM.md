# ArbiEdge — Edge Terminal

## Scop

ArbiEdge este interfața operațională pentru arbitraj verificat pe case românești. Designul prioritizează trei decizii: dacă un semnal este executabil, ce dovadă de **fidelity** îl susține și ce expunere produce.

## Direcție vizuală

- Limbaj **edge terminal**: graphite rece, suprafețe cool, accent teal pentru edge verificat.
- Teal (`--accent`) rezervat semnalelor validate, comenzilor principale și nav-ului activ.
- Verde profit, ocru revizuire, roșu respingere, albastru analiză.
- Colțuri ușor rotunjite (`6–10px`), umbre doar pe modal/toast/sertar.
- Display: **Space Grotesk**; corp: **IBM Plex Sans**; date: **JetBrains Mono**.

## Tokenuri

Definite în `public/css/design-tokens.css` (V2).

- Fundal: `--bg`, `--surface`, `--surface-2`, `--surface-strong`.
- Text: `--text-primary`, `--text-secondary`, `--text-tertiary`.
- Semnale: `--accent`, `--profit`, `--warning`, `--danger`, `--info`.
- Spațiere: scară de 4 px (`--space-1` … `--space-12`).

Tema luminoasă este implicită. Tema întunecată păstrează ierarhia semantică.

## Anatomia aplicației

1. Sidebar: monogramă **AE**, brand **ArbiEdge**, navigație pe Semnal / Operațiuni / Control.
2. Topbar: stare feed, căutare, sport, interval, sunet, temă, Scan.
3. Market tape: patru indicatori operaționali.
4. Antet pagină: index, titlu, regulă, acțiuni.
5. Spațiu de lucru: carduri dens-date, rail contextual când e necesar.
6. Nav mobilă: comenzi de frecvență mare sub 720 px.

## Contract funcțional

Reconstrucția **păstrează** toate ID-urile, `data-nav`, `data-page` și atributele consumate de modulele JS. Schimbările de prezentare nu redenumesc contractele fără actualizarea simultană a testelor.

Cache-ul frontend se bump-uiește prin query `?v=` pe CSS/JS și `CACHE_VERSION` în `sw.js`.
