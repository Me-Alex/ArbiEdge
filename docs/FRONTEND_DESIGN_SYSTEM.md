# ArbiEdge — Edge Terminal (rebuild from zero)

## Identitate

Terminal de operațiuni pentru arbitraj verificat. Dark-first, accent **edge teal** (`#14f1c5`), tipografie **Space Grotesk** + **JetBrains Mono**.

## Fișiere

| Fișier | Rol |
|---|---|
| `public/css/design-tokens.css` | Tokenuri (culori, spațiu, tip) + aliasuri compat |
| `public/css/components.css` | Controale, carduri, modal, toast |
| `public/css/style.css` | Shell, layout, pagini, responsive |
| `public/index.html` | Structură UI (toate ID-urile JS păstrate) |

## Principii

1. **Dovadă înainte de culoare** — statusurile au etichetă + culoare.
2. **Contract stabil** — `data-nav`, `data-page`, ID-uri API UI neschimbate.
3. **Densitate operațională** — tape, filtre, cozi scanner pe un ecran.
4. **Mobile** — sidebar ascuns, nav jos sub 900px.

## Cache

Bump `?v=` pe CSS/JS și `CACHE_VERSION` în `sw.js` la fiecare release UI.
