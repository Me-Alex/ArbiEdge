# Odds fidelity — cote API vs website

Scopul acestui flux este să confimi că prețurile pe care le prelucrează ArbiEdge
sunt aceleași cu cele afișate pe site-ul casei de pariuri, nu doar „în jurul”
valorii.

## Ce înseamnă „aceleași cote”

O cotă este acceptată ca **verified** doar când există dovezi pentru:

1. **eveniment** (echipe pe pagină)
2. **piață** (ex. Final / Ambele echipe marchează / Total goluri)
3. **linie / perioadă** (ex. 2.5, timp regulamentar)
4. **outcome** (1 / X / 2, Da / Nu, Peste / Sub)
5. **preț** (toleranță implicită `0.01`)

Dacă prețul apare pe pagină fără context de piață, statusul este **ambiguous**.
Dacă contextul de piață există dar prețul diferă, statusul este **mismatch**.
Combo-uri tip „GG & Peste 2.5” **nu** sunt acceptate ca dovadă pentru BTTS pur.

## Cum verifici acum (manual)

### O casă, un eșantion

```powershell
npm run verify:odds -- --bookmaker Superbet --markets h2h,bothTeamsToScore,totalGoals --min-hours 2 --strict-context
```

### Batch pe mai multe case

```powershell
npm run verify:fidelity -- --bookmaker all --events-per-bookmaker 2 --markets h2h,totalGoals,bothTeamsToScore --min-hours 2
```

### Audit izolat pe toate casele (recomandat)

Rulează fiecare provider într-un proces separat, cu hard-timeout și raport
intermediar (nu se blochează pe o singură casă):

```powershell
npm run verify:fidelity:audit -- --events-per-bookmaker 1 --markets h2h,bothTeamsToScore,totalGoals --min-hours 2
```

Ieșire:
- `output/playwright/fidelity/fidelity-audit-latest.json`
- `output/playwright/fidelity/fidelity-audit-summary.json`

### Protecții anti-false-mismatch

- URL-urile de tip lobby (`/pre-match`, listă sport) **nu** sunt folosite pentru
  verificare de preț — produc mismatch-uri false pe alte meciuri.
- VictoryBet / Manhattan primesc deep-link de eveniment BetConstruct.
- Cardurile combo (`GG & Peste 2.5`, `1X2 & Total`) sunt respinse ca dovadă pentru
  piețele pure.
- Dacă echipele evenimentului nu apar pe pagină, statusul coboară la `not_found`
  (nu la `mismatch`).

Rapoartele JSON + screenshot-uri se scriu în:

- `output/playwright/fidelity/fidelity-report.json`
- `output/playwright/fidelity/*.png`

### Ce înseamnă statusurile

| Status | Înseamnă |
| --- | --- |
| `verified` | API = website, cu context complet |
| `mismatch` | Context corect, preț diferit (risc real) |
| `not_found` | Piața/prețul nu s-a găsit pe pagină (lazy UI, login, CAPTCHA) |
| `ambiguous` | Preț vizibil, dar fără dovadă de piață |
| `unverifiable` | Pagină goală / blocată / CAPTCHA |

## Cum folosește aplicația aceste dovezi

- Scannerul marchează fiecare leg cu `verificationStatus`.
- Oportunitățile **actionable / trusted** cer dovezi `verified` pe toate picioarele.
- Fără fidelity browser, majoritatea rămân în **review / awaiting_fidelity**.

### Mod autonomous (verificare continuă)

În `.env` / Compose:

```env
AUTONOMY_ENABLED=1
AUTONOMY_FIDELITY_ENABLED=1
AUTONOMY_CANDIDATE_VERIFICATION_ENABLED=1
DATABASE_URL=postgres://...
```

Runtime-ul:

1. colectează cotele din adapteri
2. verifică în browser picioarele candidaților de arbitraj
3. blochează alertele până când prețul exact e reconfirmat pe website

Vezi și [`AUTONOMY.md`](./AUTONOMY.md).

## Recomandare operațională

1. Rulează `verify:fidelity` pe casele pe care le folosești zilnic.
2. Dacă vezi **mismatch** real pe 1X2 / totals / BTTS pur, tratează casa ca
   nesigură până la investigare (nu doar un eșec de UI).
3. Pentru decizii de bani, filtrează scannerul pe **trusted / verified** și
   deschide mereu `eventUrl` din card înainte de plasare.
4. Cotele se mișcă: preferă evenimente cu `--min-hours 2+` ca să eviți
   mismatch-uri din cauza delay-ului dintre fetch API și deschiderea paginii.

## Limitări cunoscute

- SPA-urile (Superbet, Unibet, GetsBet) montează piețele lazy; verifier-ul face
  scroll/expand și captura network pe API/CDN, dar unele piețe pot rămâne
  `not_found` fără a fi greșite în API.
- Betano necesită browser local (`BETANO_BROWSER_ENABLED=1`).
- Familii corelate (Stanleybet family, Digitain shared) nu contează ca dovezi
  independente de arbitraj cross-book.
