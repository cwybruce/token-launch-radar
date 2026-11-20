# Token Radar — token-radar-01

A radar that ranks every genuine pre-token protocol in the sealed DefiLlama
snapshot by an implied launch value, with a concrete 5-step farm plan each.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` into the output directory. Deterministic: two runs write
identical bytes.

## Model (radar-2)

`implied = TVL × 0.28 × size × growth × maturity × chains`

- **base 0.28** — anchored near the live market: the median live-token
  protocol in this snapshot trades at 0.21x TVL.
- **size** `(TVL/$100M)^-0.06`, clamped [0.75, 1.25] — FDV/TVL compresses
  with size; small early protocols get the higher multiple.
- **growth** — 7-day TVL change clamped to [-80%, +200%]; falls are
  punished 1.5x harder than rises are rewarded.
- **maturity** `0.55 + 0.45×(1 − exp(−age/730))` — longer with no token,
  higher; unknown age scores 0.75.
- **chains** — 2% per extra chain, capped at +12%.

Rankable = records no token (no market cap, no CoinGecko id, no symbol)
and not a wrapped/staked/bridged product, exchange, or versioned pool.
Board: all 198 rankable protocols — the 40-protocol watchlist plus 158
early ones below the floor. Live-token protocols are shown separately as
comparables, never mixed into the ranking.

## Dashboard

Static page, no network: board with search, category/chain filters,
sorting, watchlist-only toggle, a detail view per protocol (model
breakdown + farm steps), and a live-token comparables table.
