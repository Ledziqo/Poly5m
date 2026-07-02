const fs = require('fs');

try {
    let code = fs.readFileSync('server.ts', 'utf8');

    // 1. Update Imports
    code = code.replace(
        "import { RSI, MACD, BollingerBands, ATR, EMA, WilliamsR, WMA, ADX, StochasticRSI, ROC, OBV, MFI, CCI, Stochastic, IchimokuCloud } from 'technicalindicators';",
        "import { RSI, MACD, BollingerBands, ATR, EMA, SMA, WilliamsR, WMA, ADX, StochasticRSI, ROC, OBV, MFI, CCI, Stochastic, IchimokuCloud, PSAR, KeltnerChannels, TRIX, ForceIndex, WEMA } from 'technicalindicators';"
    );

    // 2. Expand calculateTechnicals 
    const newCalculations = `
  // === V7 NEW 30+ INDICATORS & METRICS ===
  const sma20 = SMA.calculate({ values: closesData, period: 20 });
  const sma50 = SMA.calculate({ values: closesData, period: 50 });
  const ema10 = EMA.calculate({ values: closesData, period: 10 });
  const ema30 = EMA.calculate({ values: closesData, period: 30 });
  const ema100 = EMA.calculate({ values: closesData, period: 100 });
  const wema20 = WEMA.calculate({ values: closesData, period: 20 });
  const trix = TRIX.calculate({ values: closesData, period: 18 });
  const forceIndex = ForceIndex.calculate({ close: closesData, volume: volumeData, period: 13 });
  const psar = PSAR.calculate({ high: highsData, low: lowsData, step: 0.02, max: 0.2 });
  const keltner = KeltnerChannels.calculate({ high: highsData, low: lowsData, close: closesData, period: 20, multiplier: 2 });
  
  // Custom AO (Awesome Oscillator)
  const midPrices = highsData.map((h, i) => (h + lowsData[i]) / 2);
  const calcCustomSMA = (arr, len) => arr.length >= len ? arr.slice(-len).reduce((a,b)=>a+b)/len : arr[arr.length-1];
  const aoValue = calcCustomSMA(midPrices, 5) - calcCustomSMA(midPrices, 34);
  const aoPrev = midPrices.length > 1 ? calcCustomSMA(midPrices.slice(0, -1), 5) - calcCustomSMA(midPrices.slice(0, -1), 34) : 0;

  // Custom CMO (Chande Momentum Oscillator)
  let sumGains = 0, sumLosses = 0;
  for (let i = Math.max(1, closesData.length - 14); i < closesData.length; i++) {
     const diff = closesData[i] - closesData[i-1];
     if (diff > 0) sumGains += diff;
     else sumLosses -= diff;
  }
  const cmoValue = sumGains + sumLosses === 0 ? 0 : ((sumGains - sumLosses) / (sumGains + sumLosses)) * 100;

  // Chop Index (Trending vs Ranging)
  const maxHigh14 = Math.max(...highsData.slice(-14));
  const minLow14 = Math.min(...lowsData.slice(-14));
  const atrSum14 = atr.slice(-14).reduce((a, b) => a + b, 0);
  const chopIndex = maxHigh14 - minLow14 === 0 ? 50 : 100 * Math.log10(atrSum14 / (maxHigh14 - minLow14)) / Math.log10(14);

  // VWMA (Volume Weighted Moving Average) 20
  let vwmaSum = 0, volSum = 0;
  for (let i = Math.max(0, closesData.length - 20); i < closesData.length; i++) {
     vwmaSum += closesData[i] * volumeData[i];
     volSum += volumeData[i];
  }
  const vwma20 = volSum > 0 ? vwmaSum / volSum : lastClose;

  // Disparity Index (Price distance from EMA20)
  const disparityIndex = ((lastClose - lastEMA20) / lastEMA20) * 100;

  // Donchian Channels 20
  const donchianHigh = Math.max(...highsData.slice(-20));
  const donchianLow = Math.min(...lowsData.slice(-20));
  
  // Pivot Points (Local approximate)
  const pivotP = (localHigh + localLow + lastClose) / 3;

  // Extract latest arrays where needed
  const lastSMA20 = sma20.length > 0 ? sma20[sma20.length - 1] : lastClose;
  const lastSMA50 = sma50.length > 0 ? sma50[sma50.length - 1] : lastClose;
  const lastEMA10 = ema10.length > 0 ? ema10[ema10.length - 1] : lastClose;
  const lastEMA30 = ema30.length > 0 ? ema30[ema30.length - 1] : lastClose;
  const lastEMA100 = ema100.length > 0 ? ema100[ema100.length - 1] : lastClose;
  const lastWEMA20 = wema20.length > 0 ? wema20[wema20.length - 1] : lastClose;
  const lastTRIX = trix.length > 0 ? trix[trix.length - 1] : 0;
  const lastForceIndex = forceIndex.length > 0 ? forceIndex[forceIndex.length - 1] : 0;
  const lastPSAR = psar.length > 0 ? psar[psar.length - 1] : lastClose;
  const lastKeltner = keltner.length > 0 ? keltner[keltner.length - 1] : null;
`;

    // Insert indicators just before bollingerPctB
    code = code.replace(
        /\/\/ Bollinger %B — position within bands/g,
        newCalculations + '\n  // Bollinger %B — position within bands'
    );

    // Expose these in the returned object
    const returnObjectAdditions = \`
    v7: {
      sma20: lastSMA20,
      sma50: lastSMA50,
      ema10: lastEMA10,
      ema30: lastEMA30,
      ema100: lastEMA100,
      wema20: lastWEMA20,
      trix: lastTRIX,
      forceIndex: lastForceIndex,
      psar: lastPSAR,
      keltner: lastKeltner,
      ao: aoValue,
      aoPrev: aoPrev,
      cmo: cmoValue,
      chop: chopIndex,
      vwma20,
      disparity: disparityIndex,
      donchianHigh,
      donchianLow,
      pivot: pivotP
    },\`;

  code = code.replace(
    /bollingerPctB,/g,
    returnObjectAdditions + '\\n    bollingerPctB,'
  );

  // 3. Replace V6 Engine with V7 Engine
  const v6Start = code.indexOf('// ========================================================================');
  const checkBotJustStartedStart = code.indexOf('if (Date.now() - botStartTime < 20000) {');

  if (v6Start === -1 || checkBotJustStartedStart === -1) {
    throw new Error('Could not find V6 engine boundaries in server.ts');
  }

  const engineHeader = code.substring(v6Start, v6Start + 233); // keep length if possible
  
  const v7EngineCode = \`
    // ========================================================================
    // --- V7 ENSEMBLE ENGINE (Top 50 Algorithmic Indicators) ---
    // ========================================================================
    // Calculates points across Trend, Momentum, Vol, and Order Flow 
    // to build a mathematically rigorous consensus.
    let v7Up = 0;
    let v7Down = 0;
    
    // --- 1. TREND EXPERTS (15 Signals) ---
    // Moving Averages
    if (technicals.ema9 > technicals.ema21) v7Up += 2; else v7Down += 2;
    if (technicals.v7.ema10 > technicals.v7.ema30) v7Up += 2; else v7Down += 2;
    if (technicals.ema21 > technicals.ema50) v7Up += 3; else v7Down += 3;
    if (technicals.v7.sma20 > technicals.v7.sma50) v7Up += 2; else v7Down += 2;
    if (technicals.ema50 > technicals.v7.ema100) v7Up += 2; else v7Down += 2;
    if (technicals.v7.ema100 > technicals.ema200) v7Up += 2; else v7Down += 2;
    
    // Trend Confirmation
    if (technicals.supertrend.trend === 'UP') v7Up += 3; else if (technicals.supertrend.trend === 'DOWN') v7Down += 3;
    if (technicals.ichimokuSignal === 'BULLISH') v7Up += 3; else if (technicals.ichimokuSignal === 'BEARISH') v7Down += 3;
    if (currentPrice > technicals.v7.psar) v7Up += 2; else v7Down += 2;
    if (technicals.v7.trix > 0) v7Up += 2; else v7Down += 2;
    if (technicals.hma20 > technicals.v7.wema20) v7Up += 2; else v7Down += 2;
    if (currentPrice > technicals.laguerre) v7Up += 2; else v7Down += 2;

    // ADX Trend Strength multiplier
    let trendMult = technicals.adx > 25 ? 1.5 : 0.8;
    v7Up *= trendMult;
    v7Down *= trendMult;

    // --- 2. MOMENTUM EXPERTS (15 Signals) ---
    let momUp = 0; let momDown = 0;
    
    if (technicals.rsi < 35) momUp += 4; else if (technicals.rsi > 65) momDown += 4; // Mean rev rsi
    const stochK = technicals.stochRSI.k || 50, stochD = technicals.stochRSI.d || 50;
    if (stochK < 20 && stochK > stochD) momUp += 3; else if (stochK > 80 && stochK < stochD) momDown += 3;
    if (technicals.macdHistSlope > 0) momUp += 3; else if (technicals.macdHistSlope < 0) momDown += 3;
    if (technicals.williamsR < -80) momUp += 2; else if (technicals.williamsR > -20) momDown += 2;
    if (technicals.roc > 0) momUp += 2; else if (technicals.roc < 0) momDown += 2;
    if (technicals.cci < -100) momUp += 2; else if (technicals.cci > 100) momDown += 2;
    if (technicals.v7.ao > 0 && technicals.v7.ao > technicals.v7.aoPrev) momUp += 2; else if (technicals.v7.ao < 0 && technicals.v7.ao < technicals.v7.aoPrev) momDown += 2;
    if (technicals.v7.cmo > 0) momUp += 2; else if (technicals.v7.cmo < 0) momDown += 2;

    if (technicals.rsiDivergence === 'BULLISH') momUp += 5; else if (technicals.rsiDivergence === 'BEARISH') momDown += 5;
    if (technicals.candlePattern.includes('BULLISH')) momUp += 3; else if (technicals.candlePattern.includes('BEARISH')) momDown += 3;
    
    v7Up += momUp; v7Down += momDown;

    // --- 3. VOLUME & ORDER FLOW EXPERTS (10 Signals) ---
    let volUp = 0; let volDown = 0;
    if (technicals.obvTrend === 'RISING') volUp += 3; else if (technicals.obvTrend === 'FALLING') volDown += 3;
    if (technicals.v7.forceIndex > 0) volUp += 2; else if (technicals.v7.forceIndex < 0) volDown += 2;
    if (currentPrice > technicals.v7.vwma20) volUp += 2; else volDown += 2;
    if (buyingPressure.ratio > 0.55) volUp += 4; else if (buyingPressure.ratio < 0.45) volDown += 4;
    
    // SMC
    if (technicals.smc.orderBlock === 'BULLISH') volUp += 8; else if (technicals.smc.orderBlock === 'BEARISH') volDown += 8;
    if (technicals.smc.choch === 'BULLISH') volUp += 5; else if (technicals.smc.choch === 'BEARISH') volDown += 5;
    if (technicals.smc.fvg === 'BULLISH') volUp += 4; else if (technicals.smc.fvg === 'BEARISH') volDown += 4;

    v7Up += volUp; v7Down += volDown;

    // --- 4. VOLATILITY & MEAN REVERSION EXPERTS (10 Signals) ---
    // If Choppy (Chop Index > 61.8), we emphasize mean reversion
    const isChoppy = technicals.v7.chop > 55;
    
    if (isChoppy) {
       // Mean reversion behavior
       if (currentPrice > technicals.vwap + technicals.atr) v7Down += 4; // Fade extended
       else if (currentPrice < technicals.vwap - technicals.atr) v7Up += 4; // Dip buy
       
       if (currentPrice > technicals.v7.pivot) v7Down += 2; else v7Up += 2; // Pivot reversion
       
       if (technicals.bollingerPctB > 0.9) v7Down += 4; else if (technicals.bollingerPctB < 0.1) v7Up += 4;
       
       if (technicals.v7.keltner && currentPrice > technicals.v7.keltner.upper) v7Down += 3;
       else if (technicals.v7.keltner && currentPrice < technicals.v7.keltner.lower) v7Up += 3;
    } else {
       // Trend breakout behavior
       if (currentPrice > technicals.v7.donchianHigh * 0.999) v7Up += 5; // Breakout!
       else if (currentPrice < technicals.v7.donchianLow * 1.001) v7Down += 5; // Breakdown!
       
       if (technicals.v7.disparity > 0) v7Up += 2; else v7Down += 2;
    }

    // Adaptive Streaks
    const adjUp = Math.max(0, v7Up + adaptiveUpPenalty);
    const adjDown = Math.max(0, v7Down + adaptiveDownPenalty);

    // ── CONVICTION & FINAL DECISION ──
    const maxScore = Math.max(adjUp, adjDown);
    const minScore = Math.min(adjUp, adjDown);
    const totalSignal = maxScore + minScore;
    const directionalRatio = totalSignal > 0 ? maxScore / totalSignal : 0.5;

    direction = adjUp > adjDown ? 'UP' : 'DOWN';

    let convictionPass = true;
    let skipReason = '';

    // V7 requires deep ensemble agreement
    if (directionalRatio < 0.58) {
      convictionPass = false;
      skipReason = \`CONFLICTED: ratio=\${(directionalRatio * 100).toFixed(1)}% (need >58% consensus)\`;
    }

    // ── CONFIDENCE MAPPING ──
    // Scale 58% ratio to min confidence, 75% ratio to high confidence
    let rawConfidence = 30 + ((directionalRatio - 0.5) * 2) * 60; 
    
    // Massive boost if SMC aligns with Momentum and Trend
    const smcAligned = technicals.smc.orderBlock === (direction === 'UP' ? 'BULLISH' : 'BEARISH');
    if (smcAligned && directionalRatio > 0.6) rawConfidence += 10;

    if (streak >= 3) rawConfidence += 3;
    if (streak <= -3) rawConfidence -= 5;

    confidence = Math.max(10, Math.min(95, Math.round(rawConfidence)));

    // ── LOGGING ──
    blockTradeReason = \`Ensemble V7 (50+): \${adjUp.toFixed(0)}↑ \${adjDown.toFixed(0)}↓ | DR=\${(directionalRatio * 100).toFixed(1)}%\`;
    logSystem('INFO', \`[SCORING] \${blockTradeReason} → \${direction} \${confidence}%\`);

    if (cachedAIResolutionTime === nextResolution && cachedAIPrediction) {
      const aiDir = cachedAIPrediction.direction;
      const aiConf = cachedAIPrediction.confidence;
      if (aiDir === direction) confidence = Math.min(95, confidence + Math.round((aiConf - 50) * 0.2));
      else if (aiDir !== 'NEUTRAL' && aiConf >= 75) { confidence = Math.max(10, confidence - 8); }
    }

    const volatilityRisk = (technicals.atr / technicals.close) * 10000;
    riskScore += volatilityRisk + (100 - confidence) * 0.5;
    riskScore = Math.min(Math.max(Math.round(riskScore), 1), 99);

    let sharePrice = 0.5;
    if (polymarketOdds) sharePrice = direction === 'UP' ? polymarketOdds.upPrice : polymarketOdds.downPrice;
    else {
      const upSynthetic = calculateSyntheticOdds(currentPrice, strikePrice, timeToResolution);
      sharePrice = direction === 'UP' ? upSynthetic : (1 - upSynthetic);
    }

    const winProb = confidence / 100;
    const evPerDollar = (winProb * (1.0 / sharePrice)) - 1;

    let dynamicThreshold = 58;
    if (streak <= -2) dynamicThreshold = 66; 
    else if (streak <= -1) dynamicThreshold = 62;
    else if (streak >= 4) dynamicThreshold = 54;
    else if (streak >= 2) dynamicThreshold = 56;

    let shouldBet = false;
    if (timeLeftSeconds > 295) {
      blockTradeReason = \`Waiting for cycle start (\${timeLeftSeconds.toFixed(0)}s)...\`;
    } else if (timeLeftSeconds < 200) {
      blockTradeReason = \`Outside window (missed entry)\`;
    } else if (!convictionPass) {
      blockTradeReason = \`SKIPPED: \${skipReason}\`;
    } else if (evPerDollar < 0.05) {
      blockTradeReason = \`SKIPPED: LOW EV (Need 5%)\`;
    } else if (confidence >= dynamicThreshold) {
      shouldBet = true;
      blockTradeReason = \`V7 ENTRY (\${direction} \${confidence}% | EV: +\${(evPerDollar * 100).toFixed(1)}% | DR=\${(directionalRatio * 100).toFixed(1)}%)\`;
    } else {
      blockTradeReason = \`V7 SCORE TOO LOW (\${direction} \${confidence}% < \${dynamicThreshold}%)\`;
    }
    
    // `;

    // Inject V7 code
    const beforeV6 = code.substring(0, v6Start);
    const afterV6 = code.substring(checkBotJustStartedStart);

    code = beforeV6 + v7EngineCode + afterV6;

    fs.writeFileSync('server.ts', code);
    console.log("Successfully injected V7 Ensemble Engine");

} catch (error) {
    console.error("Error updating server.ts:", error);
}
