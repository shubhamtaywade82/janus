# JDS-013: Quantitative Indicators & Mathematical Model
Version: 1.0
Status: Approved

This specification defines the quantitative formulas used for feature extraction and pattern detection.

## 1. Indicator Formulas

### 1.1 Average True Range (ATR)
Measures market volatility. Calculated over period $N$ (typically 14):

$$	ext{TR}_t = \max(	ext{High}_t - 	ext{Low}_t, |	ext{High}_t - 	ext{Close}_{t-1}|, |	ext{Low}_t - 	ext{Close}_{t-1}|)$$

$$	ext{ATR}_t = rac{1}{N} \sum_{i=0}^{N-1} 	ext{TR}_{t-i}$$

### 1.2 Cumulative Volume Delta (CVD)
Aggregates market buyer/seller imbalance:

$$	ext{CVD}_t = 	ext{CVD}_{t-1} + (	ext{Volume}_{	ext{buy}, t} - 	ext{Volume}_{	ext{sell}, t})$$

Where buy/sell volumes are classified using the tick direction method (aggressor side classification).

### 1.3 Order Book Imbalance (OBI)
Measures buying vs selling pressure at the inner Level 2 limits:

$$	ext{OBI}_t = rac{	ext{BidQty}_t - 	ext{AskQty}_t}{	ext{BidQty}_t + 	ext{AskQty}_t}$$

Where $	ext{BidQty}$ and $	ext{AskQty}$ represent depth summed over the top 5 levels.

### 1.4 Kaufman's Efficiency Ratio (KER)
Measures the directional efficiency of price movement vs volatility:

$$	ext{Direction} = | 	ext{Close}_t - 	ext{Close}_{t-N} |$$

$$	ext{Volatility} = \sum_{i=0}^{N-1} | 	ext{Close}_{t-i} - 	ext{Close}_{t-i-1} |$$

$$	ext{KER}_t = rac{	ext{Direction}}{	ext{Volatility}}$$
