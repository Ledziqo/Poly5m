import { useState, useEffect, useRef } from 'react';

export function useBinancePrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [history, setHistory] = useState<{ time: number, price: number }[]>([]);

  // We use a ref to throttle React state updates just slightly (roughly one frame)
  // so the ultra-fast WebSockets don't freeze the UI.
  const lastUpdateRef = useRef<number>(0);
  const latestPriceRef = useRef<number | null>(null);

  useEffect(() => {
    let isComponentMounted = true;
    const websockets: WebSocket[] = [];
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let fallbackActive = false;
    let hasReceivedData = false;

    const handleNewPrice = (newPrice: number, timeMs: number) => {
      if (!isComponentMounted) return;
      hasReceivedData = true; // We got data from a websocket

      // Throttle state updates to ~60fps max so React stays smooth while the chart feels alive.
      const now = Date.now();
      latestPriceRef.current = newPrice;

      if (now - lastUpdateRef.current > 16) {
        lastUpdateRef.current = now;
        setPrice(newPrice);
        setHistory(prev => {
          const newHistory = [...prev, { time: timeMs, price: newPrice }];
          // Keep a longer tick trail while staying light enough for the browser.
          return newHistory.slice(-300);
        });
      }
    };

    const startFallback = () => {
      if (fallbackInterval || hasReceivedData) return;
      fallbackActive = true;

      const fetchFallbackPrice = async () => {
        try {
          const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
          const data = await res.json();
          if (data?.price) {
            handleNewPrice(parseFloat(data.price), Date.now());
          }
        } catch {
          // Ignore
        }
      };

      fetchFallbackPrice();
      fallbackInterval = setInterval(fetchFallbackPrice, 500);
    };

    // --- STREAM 1: Binance Global (Fastest, but blocked in US) ---
    const connectBinanceGlobal = () => {
      try {
        const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');
        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          handleNewPrice(parseFloat(message.p), message.T);
        };
        websockets.push(ws);
      } catch (e) {
        // block error
      }
    };

    // --- STREAM 2: Binance US (Fastest for US users) ---
    const connectBinanceUS = () => {
      try {
        const ws = new WebSocket('wss://stream.binance.us:9443/ws/btcusdt@aggTrade');
        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          handleNewPrice(parseFloat(message.p), message.T);
        };
        websockets.push(ws);
      } catch (e) {
        // block error
      }
    };

    // --- STREAM 3: KuCoin Match (Fastest KuCoin stream, sends every trade executed) ---
    let kucoinPingInterval: ReturnType<typeof setInterval> | null = null;
    const connectKuCoinMatch = async () => {
      try {
        const tokenRes = await fetch('https://api.kucoin.com/api/v1/bullet-public', { method: 'POST' });
        const tokenData = await tokenRes.json();
        if (!tokenData?.data?.token || !tokenData?.data?.instanceServers?.length) return;

        const endpoint = tokenData.data.instanceServers[0].endpoint;
        const token = tokenData.data.token;
        const connectId = Math.random().toString(36).substring(2, 10);

        if (!isComponentMounted) return;

        const ws = new WebSocket(`${endpoint}?token=${token}&connectId=${connectId}`);
        ws.onopen = () => {
          ws.send(JSON.stringify({
            id: connectId,
            type: 'subscribe',
            topic: '/market/ticker:BTC-USDT',
            response: true
          }));

          kucoinPingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ id: connectId, type: 'ping' }));
            }
          }, tokenData.data.instanceServers[0].pingInterval || 10000);
        };

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'message' && message.topic === '/market/ticker:BTC-USDT') {
            handleNewPrice(parseFloat(message.data.price), parseInt(message.data.time || Date.now()));
          }
        };
        websockets.push(ws);
      } catch (err) {
        // ignore setup error
      }
    };

    // We open all 3 streams simultaneously. 
    // They will all push data to handleNewPrice, giving us the lowest possible latency 
    // from whatever stream packets arrive first.
    connectBinanceGlobal();
    connectBinanceUS();
    connectKuCoinMatch();

    // Start a short timeout. If no data has arrived from ANY websocket, start the REST fallback.
    const safetyTimeout = setTimeout(() => {
      if (!hasReceivedData) {
        console.warn('[Price] All WebSockets stalled, using REST fallback');
        startFallback();
      }
    }, 1000);

    return () => {
      isComponentMounted = false;
      clearTimeout(safetyTimeout);
      if (fallbackInterval) clearInterval(fallbackInterval);
      if (kucoinPingInterval) clearInterval(kucoinPingInterval);
      websockets.forEach(ws => {
        try { ws.close(); } catch (e) { }
      });
    };
  }, []);

  return { price, history };
}
