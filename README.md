# Poly5m

Fresh PolyEngine BTC 5-minute Polymarket cockpit.

## Local development

```bash
docker compose up -d --build
```

- Web: http://localhost:3000
- Engine health: http://localhost:8000/api/health

## VPS env

Copy `.env.example` to `.env` and set:

```bash
CHAINLINK_BTC_USD_URL=https://your-chainlink-reference-proxy.example/btc-usd
CHAINLINK_API_KEY=optional_key_if_your_proxy_requires_it
REFERENCE_MODE=binance
```

The engine expects the Chainlink/reference endpoint to return JSON containing a BTC/USD price field such as `price`, `answer`, `value`, `benchmarkPrice`, `mid`, `last`, or `rate`.

## Access

- Login email: `Aesliexx@gmail.com`
- Login password: `Mudi2005`
- Request access page points to Telegram `@Aesliex`

## Notes

- The dashboard visuals are based on the provided Meowbot frontend.
- The old Meowbot backend is not used.
- Default mode uses Binance BTCUSDT WebSocket as the live reference/chart feed because it is free and moves continuously.
- If you later set `REFERENCE_MODE=chainlink`, Chainlink/reference BTC/USD becomes the main decision price source. Set `CHAINLINK_BTC_USD_URL` to a JSON endpoint/proxy for the Chainlink BTC/USD reference stream.
- `CHAINLINK_API_KEY` is optional and sent as `Authorization: Bearer ...` when provided.
- Timer/odds/order books come from the active Polymarket BTC 5m event/CLOB. Price-to-beat is parsed from Polymarket metadata when exposed, otherwise captured at the window start from the selected reference feed.
- Real Polymarket CLOB order books are used when active BTC 5m token IDs are found.
- Bot state, trades, windows, logs, and backtest summaries persist in the `poly5m_data` Docker volume.
- The simulator includes the BTC 5m taker fee setting, defaulting to `1.80%`.
- The bot can only open new trades before 2:00 remaining.
- The bot cannot skip three windows in a row; the third consecutive window forces a trade.
