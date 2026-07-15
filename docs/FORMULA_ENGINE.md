# Formula Engine & Quantitative Specification

## Overview

The formula engine (`src/engine/formula-engine.js`) evaluates aggregated sports odds market data to compute mathematically optimal arbitrage trades, middle opportunities, value bets, and optimal capital allocations.

---

## 1. Classical Arbitrage (Surebets)

### 1.1 Mathematical Condition
For a market with mutually exclusive and exhaustive outcomes $O = \{1, 2, \dots, n\}$, let $P_i$ denote the highest available odds for outcome $i$.

The total implied market probability $S$ is given by:

$$S = \sum_{i=1}^{n} \frac{1}{P_i}$$

An **Arbitrage Opportunity** exists if and only if:

$$S < 1$$

### 1.2 Profit & Stake Calculation
Given a total total bankroll allocation $K$ (e.g. $100$ RON), the optimal stake $s_i$ for outcome $i$ is proportional to its implied probability:

$$s_i = K \cdot \frac{1 / P_i}{S}$$

The guaranteed gross payout $R$ and net profit $\Pi$ across any winning outcome are:

$$R = \frac{K}{S}, \quad \Pi = R - K = K \cdot \left(\frac{1}{S} - 1\right)$$

The edge percentage $E$ is defined as:

$$E = 1 - S$$

---

## 2. Advanced Cross-Market Arbitrage

### 2.1 BTTS + Team Clean Sheet Scanner (`detectBttsTeamScoreArbitrage`)
Combines three mutually exclusive outcome selections:
1. **Both Teams To Score (Yes)**: $O_1 = \text{btts.yes}$
2. **Home Team Clean Sheet (Home No Score)**: $O_2 = \text{home\_clean\_sheet.yes} \lor \text{home\_total\_under\_0.5}$
3. **Away Team Clean Sheet (Away No Score)**: $O_3 = \text{away\_clean\_sheet.yes} \lor \text{away\_total\_under\_0.5}$

An edge exists if:

$$\frac{1}{P(\text{btts.yes})} + \frac{1}{P(\text{home.no})} + \frac{1}{P(\text{away.no})} < 1$$

### 2.2 Team Totals vs Match Totals Alignment (`detectTeamMatchTotalArbitrage`)
Validates cross-market goal distribution where Match Over $M$ is covered by Home Under $H$ and Away Under $A$, satisfying the exact structural line boundary:

$$H + A = M + 0.5$$

For example:
* Match Over 2.5 ($M = 2.5$)
* Home Under 1.5 ($H = 1.5$)
* Away Under 1.5 ($A = 1.5$)

Edge condition:

$$\frac{1}{P(\text{Match Over } M)} + \frac{1}{P(\text{Home Under } H)} + \frac{1}{P(\text{Away Under } A)} < 1$$

---

## 3. Middle Bets Detection

A **Middle Bet** occurs when overlapping total goal lines create a target score window where both wagers win simultaneously.

* **Line 1**: Over $L_1$ @ Odds $P_1$
* **Line 2**: Under $L_2$ @ Odds $P_2$ ($L_1 < L_2$)

Middle Window: Any score total $X$ where $L_1 < X < L_2$.
* If score falls in the middle window, **both bets win**.
* If score falls outside the window, exactly one bet wins, incurring a small controlled loss equal to the overround margin.

---

## 4. Value Bet & Fair Probability Engine

### 4.1 Sharp Reference & Consensus Fair Odds
1. **Sharp Benchmark**: Checks for reference lines from sharp exchanges/bookmakers (e.g. Pinnacle, Betfair Exchange).
2. **Consensus Overround Removal**: If no sharp price exists, computes consensus prices across active bookmakers, strips the margin using proportional vigorish removal:

$$S_{\text{consensus}} = \sum_{i=1}^{n} \frac{1}{\bar{P}_i}$$

$$\pi_{\text{fair}, i} = \frac{1 / \bar{P}_i}{S_{\text{consensus}}}, \quad P_{\text{fair}, i} = \frac{1}{\pi_{\text{fair}, i}}$$

### 4.2 Edge & Kelly Stake Sizing
For a offered bookmaker price $P$ with fair winning probability $p = \pi_{\text{fair}}$ and complementary losing probability $q = 1 - p$:

$$\text{Edge Gap } G = \frac{P - P_{\text{fair}}}{P_{\text{fair}}}$$

The optimal fractional **Kelly Criterion** stake $f^*$ is:

$$f^* = \frac{b \cdot p - q}{b}, \quad \text{where } b = P - 1$$

---

## 5. Tax Calculation Engine (`src/finance/tax-calculator.js`)

Implements Romanian fiscal regulation rules for gambling income:
* **Exempt Threshold**: Cumulative annual gross winnings up to **10,000 RON** are non-taxable ($0\%$).
* **Tax Rate Above Threshold**: **3%** tax applied strictly to net profit exceeding 10,000 RON.
