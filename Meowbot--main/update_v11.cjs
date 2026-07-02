const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'server.ts');
let content = fs.readFileSync(targetPath, 'utf8');

const regex = /\/\/ ========================================================================\s*\/\/ --- V9 ENGINE \(Multi-Score Micro-Structure & Strict Skip Framework\)  ---\s*\/\/ ========================================================================\s*[\s\S]*?(?=\/\/ 6\. Betting Logic)/;

const match = content.match(regex);
if (!match) {
    console.error('Could not find the target block to replace.');
    process.exit(1);
}

const v11Logic = `// ========================================================================
    // --- V11 APEX ENGINE (Strict EV, Confluence, Regime Filtering) ---
    // ========================================================================
    // Focuses on ONLY highly probable, confluent trades and refuses anything 
    // with negative Expected Value (EV) or low signal-to-noise ratio.

    let direction = 'NEUTRAL';
    let confidence = 50;
    let expectedEdge = 0;
    let sharePrice = 0.5;
    let blockTradeReason: string | null = null;
    let shouldBet = false;
    let riskScore = 50;

    const timeToResolution = nextResolution - now;
    const timeLeftSeconds = timeToResolution / 1000;
    const secondsSinceOpen = 300 - Math.max(0, Math.min(300, timeLeftSeconds));

    const currentPrice = candles[candles.length - 1].close;
    const currentCandle = candles[candles.length - 1];

    // --- Signals & Regimes ---
    const polySightSignal = calculatePolySightInsiderSignal(currentPrice, strikePrice, polymarketOdds, timeToResolution);
    const metaFeatures = extractMetaFeatures(candles, technicals, currentPrice, strikePrice, polymarketOdds, timeToResolution);

    // 0. CORE METRICS
    const closes = candles.map(c => c.close);
    const len = closes.length;

    const v11 = {
      vwapDist: ((currentPrice - technicals.vwap) / technicals.vwap) * 100,
      atrPct: (technicals.atr / currentPrice) * 100,
      bbWidth: technicals.bb ? ((technicals.bb.upper - technicals.bb.lower) / currentPrice) * 100 : 0,
      emaSlope: 0,
      zScore: 0
    };

    const mean20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
    const stdDev20 = Math.sqrt(closes.slice(-20).reduce((acc: number, val: number) => acc + Math.pow(val - mean20, 2), 0) / 20);
    v11.zScore = stdDev20 > 0 ? (currentPrice - mean20) / stdDev20 : 0;

    if (len >= 5) {
      const k = 2 / (5 + 1);
      let tempEma = closes[len - 5];
      for (let i = len - 4; i < len; i++) { tempEma = (closes[i] - tempEma) * k + tempEma; }
      v11.emaSlope = ((currentPrice - tempEma) / tempEma) * 100;
    }

    // High Precision Regime Detection
    let regime = 'noisy/chop';
    if (v11.atrPct < 0.025 && currentCandle.volume < 20) {
      regime = 'thin liquidity';
    } else if (v11.atrPct > 0.15 && Math.abs(v11.zScore) > 3.0 && currentCandle.volume > 100) {
      regime = 'liquidation-driven burst'; 
    } else if (technicals.adx > 25 && Math.abs(v11.emaSlope) > 0.05) {
      regime = 'clean trend';
    } else {
      regime = 'noisy/chop';
    }

    // 1. APEX SCORING ENGINE
    let upScore = 0;
    let downScore = 0;

    // Trend Confluence (Primary Director)
    if (v11.emaSlope > 0) upScore += v11.emaSlope * 15;
    if (v11.emaSlope < 0) downScore += Math.abs(v11.emaSlope) * 15;

    // Momentum / Divergence 
    if (technicals.rsiDivergence === 'BULLISH') upScore += 25;
    if (technicals.rsiDivergence === 'BEARISH') downScore += 25;

    if (technicals.macd && technicals.macd.histogram > 0) upScore += 10;
    if (technicals.macd && technicals.macd.histogram < 0) downScore += 10;

    // Smart Money Concepts (SMC) & Liquidity Sweeps
    if (technicals.smc.orderBlock === 'BULLISH') upScore += 30;
    if (technicals.smc.orderBlock === 'BEARISH') downScore += 30;
    
    if (technicals.smc.choch === 'BULLISH') upScore += 20;
    if (technicals.smc.choch === 'BEARISH') downScore += 20;

    // Mean Reversion Extremes (Secondary filter)
    if (regime !== 'clean trend') {
        if (technicals.rsi > 70) downScore += 20;
        if (technicals.rsi < 30) upScore += 20;
        if (v11.zScore > 2.0) downScore += 25;
        if (v11.zScore < -2.0) upScore += 25;
    } else {
        // In strong trends, breaks above/below mean momentum are continuations
        if (technicals.rsi > 55) upScore += 10;
        if (technicals.rsi < 45) downScore += 10;
    }

    // PolySight Flow (Insider Premium)
    if (polySightSignal.direction === 'UP') upScore += polySightSignal.strength * 2.0;
    if (polySightSignal.direction === 'DOWN') downScore += polySightSignal.strength * 2.0;

    // Apply Meta-Model Penalties 
    if (adaptiveUpPenalty < 0) upScore += adaptiveUpPenalty;
    if (adaptiveDownPenalty < 0) downScore += adaptiveDownPenalty;

    const totalScore = upScore + downScore || 1;
    direction = upScore > downScore ? 'UP' : 'DOWN';
    const dominance = Math.max(upScore, downScore) / totalScore;

    // Baseline confidence 40 -> 95 based on dominance, capped mathematically.
    confidence = Math.min(95, 40 + (dominance * 55));

    // Severe penalties for weak conviction
    if (dominance < 0.6) confidence -= 20;

    // 2. EXPECTED VALUE (EV) CALCULATION & VALIDATION
    // Determine accurate synthetic share price via BS Approximation + Spread
    const syntheticUp = calculateSyntheticOdds(currentPrice, strikePrice, timeToResolution);
    
    // Choose actual cost basis (Polymarket exact or Synthetic fallback)
    let costPerShareUP = polymarketOdds ? polymarketOdds.upPrice : syntheticUp;
    let costPerShareDOWN = polymarketOdds ? polymarketOdds.downPrice : (1 - syntheticUp);

    // Normalize costs (avoid 0 or 1 edge cases)
    costPerShareUP = Math.max(0.01, Math.min(0.99, costPerShareUP));
    costPerShareDOWN = Math.max(0.01, Math.min(0.99, costPerShareDOWN));

    sharePrice = direction === 'UP' ? costPerShareUP : costPerShareDOWN;
    
    // EV Math
    // EV = (Probability of Win * Payout) - Initial Stake
    // Since Polymarket pays out $1.00 per share won, Payout for 1 share = $1.00
    // Profit = $1.00 - Share Price
    // EV per $1.00 invested = (WinProb / SharePrice) - 1
    const winProb = confidence / 100;
    expectedEdge = (winProb / sharePrice) - 1; // Expected % return on capital

    riskScore = Math.round(v11.atrPct * 1000); // DB compat

    // 3. STRICT REGIME PASS/FAIL RULES
    if (secondsSinceOpen < 5) {
      blockTradeReason = \`Gathering open data (\${secondsSinceOpen.toFixed(1)}s)\`;
    } else if (secondsSinceOpen > 35) {
      blockTradeReason = \`SKIPPING: Trading window closed (\${secondsSinceOpen.toFixed(1)}s > 35s)\`;
    } else if (regime === 'thin liquidity') {
      blockTradeReason = 'SKIPPING: Thin liquidity regime (dead market)';
    } else if (confidence < 60) {
      blockTradeReason = \`LOW CONFIDENCE: \${confidence.toFixed(1)}% < 60%\`;
    } else if (expectedEdge < 0.05) {
      // REQUIRE at least a 5% positive expected value to justify risk
      blockTradeReason = \`NEGATIVE EV: Expected edge \${(expectedEdge * 100).toFixed(1)}% < 5.0%\`;
    } else {
      // EV > 5% and Confidence > 60%
      shouldBet = true;
      blockTradeReason = \`V11 APEX ENTRY: \${direction} (Conf:\${confidence.toFixed(0)}%, EV:+\${(expectedEdge * 100).toFixed(1)}%)\`;
    }

    logSystem('INFO', \`[V11 APEX] \${regime.toUpperCase()} | \${direction} Conf: \${confidence.toFixed(0)}% | EV: \${(expectedEdge*100).toFixed(1)}% | Edge REQ > 5%\`);

    if (Date.now() - botStartTime < 20000) {
      shouldBet = false;
      blockTradeReason = 'Bot just started, syncing data...';
    }

    `;

content = content.replace(regex, v11Logic);
fs.writeFileSync(targetPath, content);
console.log('Successfully applied V11 logic to server.ts');
