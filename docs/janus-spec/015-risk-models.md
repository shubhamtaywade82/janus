# JDS-015: Risk Models & Position Sizing
Version: 1.0
Status: Approved

This document specifies the sizing and risk management formulas enforced by the Governor.

## 1. Kelly Criterion Allocation
To maximize long-term equity growth, position sizing uses a fractional Kelly calculation:

$$f^* = 	ext{Fraction} 	imes \left( rac{p \cdot R - (1 - p)}{R} ight)$$

Where:
- $f^*$ is the fraction of account equity to risk.
- $	ext{Fraction}$ is a safety multiplier (fixed at 0.25 for conservative execution).
- $p$ is the historical probability of success (win rate) of the Strategy (e.g. 0.55).
- $R$ is the risk-to-reward ratio (typically 2.0).

## 2. Stop-Loss Volatility Sizing
Rather than static dollar stops, Stop-Loss is derived dynamically using ATR to absorb market noise:

$$	ext{SLPrice} = 	ext{EntryPrice} - eta \cdot 	ext{ATR}_{14}$$

Where:
- $eta = 1.5$ for long setups.
- $eta = 2.0$ for volatile market regimes.

## 3. Slippage Decay Curve
The maximum allowed size is scaled down when historical slippage on CoinDCX increases:

$$	ext{SizeModifier} = e^{-lpha \cdot 	ext{SlippageAvg}}$$

Where:
- $	ext{SlippageAvg}$ is the average slippage percentage recorded on the last 5 fills.
- $lpha$ is the decay constant, configured based on exchange liquidity.
