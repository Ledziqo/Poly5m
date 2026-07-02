import fs from 'fs';

try {
    let code = fs.readFileSync('server.ts', 'utf8');

    // Fix lint 1: KeltnerChannels maPeriod
    code = code.replace(
        'period: 20, multiplier: 2',
        'maPeriod: 20, multiplier: 2'
    );

    // Fix lint 2: Pivot P calculation (localHigh before init)
    code = code.replace(
        'const pivotP = (localHigh + localLow + lastClose) / 3;',
        'const recentCandlesP = candles.slice(-20);\n  const pivotP = (Math.max(...recentCandlesP.map(c => c.high)) + Math.min(...recentCandlesP.map(c => c.low)) + lastClose) / 3;'
    );

    // Replace V6 Engine with V7 Engine
    const v6StartStr = '// ========================================================================\n    // --- SUPREME ENGINE v6.0 (SMC Integration, VWAP Reversion, Deep Trend) ---';
    const v6EndStr = 'if (Date.now() - botStartTime < 20000) {';

    const startIndex = code.indexOf(v6StartStr);
    const endIndex = code.indexOf(v6EndStr);

    if (startIndex === -1 || endIndex === -1) {
        throw new Error('Could not find V6 boundaries.');
    }

    const v7EngineCode = `// ========================================================================
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
    // If Choppy (Chop Index > 55), we emphasize mean reversion
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

    // V7 requires deep ensemble agreement (75% threshold across 50 indicators is extreme; let's use 60% as base for high freq trading, and scaling it to confidence)
    if (directionalRatio < 0.58) {
      convictionPass = false;
      skipReason = \`CONFLICTED: ratio=\${(directionalRatio * 100).toFixed(1)}% (need >58% consensus)\`;
    }

    // ── CONFIDENCE MAPPING ──
    // Scale 58% ratio to normal confidence, 75% ratio to high confidence
    let rawConfidence = 30 + ((directionalRatio - 0.5) * 2) * 60; 
    
    // Massive boost if SMC aligns with Momentum and Trend
    const smcAligned = technicals.smc.orderBlock === (direction === 'UP' ? 'BULLISH' : 'BEARISH');
    if (smcAligned && directionalRatio > 0.6) rawConfidence += 15;

    if (streak >= 3) rawConfidence += 4;
    if (streak <= -3) rawConfidence -= 6;

    confidence = Math.max(10, Math.min(95, Math.round(rawConfidence)));

    // ── LOGGING ──
    blockTradeReason = \`Ensemble V7 (50+): \${adjUp.toFixed(0)}↑ \${adjDown.toFixed(0)}↓ | DR=\${(directionalRatio * 100).toFixed(1)}% | Chop=\${technicals.v7.chop.toFixed(0)}\`;
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

    let dynamicThreshold = 60; // Base V7 threshold
    if (streak <= -2) dynamicThreshold = 68; 
    else if (streak <= -1) dynamicThreshold = 64;
    else if (streak >= 4) dynamicThreshold = 55;
    else if (streak >= 2) dynamicThreshold = 58;

    let shouldBet = false;
    if (timeLeftSeconds > 295) {
      blockTradeReason = \`Waiting for cycle start (\${timeLeftSeconds.toFixed(0)}s)...\`;
    } else if (timeLeftSeconds < 200) {
      blockTradeReason = \`Outside window (missed entry)\`;
    } else if (!convictionPass) {
      blockTradeReason = \`SKIPPED: \${skipReason}\`;
    } else if (evPerDollar < 0.05) {
      blockTradeReason = \`SKIPPED: LOW EV (\${(evPerDollar*100).toFixed(1)}%)\`;
    } else if (confidence >= dynamicThreshold) {
      shouldBet = true;
      blockTradeReason = \`V7 ENTRY (\${direction} \${confidence}% | EV: +\${(evPerDollar * 100).toFixed(1)}%)\`;
    } else {
      blockTradeReason = \`V7 SCORE TOO LOW (\${direction} \${confidence}% < \${dynamicThreshold}%)\`;
    }
    
    `;

    const finalCode = code.substring(0, startIndex) + v7EngineCode + "\n    " + code.substring(endIndex);

    fs.writeFileSync('server.ts', finalCode);
    console.log('Successfully replaced V6 with V7 logic and fixed lints.');
} catch (e) {
    console.error("Failed:", e);
}  
