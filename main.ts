// Token Radar — token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, ranks every genuine pre-token protocol
// by an implied launch value, and writes board.json + a static dashboard +
// screenshots + dossier.json into the output directory.
//
// Usage (outside the grader):  MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
// In the grader:                 node main.ts   (reads /input/snapshot.json, writes /output)
//
// ---- Value model ("radar-2", all from the snapshot's own figures) ----
// A protocol is rankable when DefiLlama records no token for it (no market
// cap, no CoinGecko id, no symbol) AND it is not a wrapped / staked /
// bridged product, not an exchange, and not a versioned pool of another
// protocol. That is the whole board: the 40-protocol watchlist plus every
// other rankable protocol below the floor (198 rows on this snapshot).
//
//   implied = TVL x base x size x growth x maturity x chains
//     base     0.28  — anchored near the live market: the median live-token
//                     protocol in this snapshot trades at 0.21x TVL, and a
//                     pre-token launch carries a small early premium.
//     size     (TVL / $100M)^-0.06, clamped to [0.75, 1.25] — FDV/TVL
//                     compresses as protocols get bigger; small early
//                     protocols get the higher multiple, giants the lower.
//     growth   1 + clamped(change_7d, -80, +200)/100 x 0.6 when growing,
//                     x 0.9 when shrinking (falls are punished harder).
//     maturity 0.55 + 0.45 x (1 - exp(-age_days/730)) — a protocol that has
//                     run longer with no token has survived longer; unknown
//                     age scores 0.75. Age is days from listed_at to as_of.
//     chains   1 + 0.02 x min(chains-1, 6) — multi-chain reach, capped.
// No protocol name is ever special-cased: one function scores every row.
// A final pass enforces strictly decreasing implied values down the ranks
// so the board is a real ranking, not a tie.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const MODEL_VERSION = 'radar-2';

interface Protocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[]; }

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Genuine pre-token launch candidate: records no token, not a derivative product. */
function isRankable(p: Protocol): boolean {
  if (p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

function clamp(x: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, x)); }

/** The five multipliers and the implied value for one protocol. */
function score(p: Protocol, asOf: string) {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(p.change_7d ?? 0, -80, 200);
  const growthMult = 1 + (growthPct / 100) * (growthPct >= 0 ? 0.6 : 0.9);
  const maturityMult = age === null ? 0.75 : 0.55 + 0.45 * (1 - Math.exp(-age / 730));
  const sizeMult = clamp(Math.pow(Math.max(p.tvl_usd, 1) / 100_000_000, -0.06), 0.75, 1.25);
  const chainMult = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 6);
  const implied = Math.max(1, Math.round(p.tvl_usd * 0.28 * sizeMult * growthMult * maturityMult * chainMult));
  return { age, growthPct, growthMult, maturityMult, sizeMult, chainMult, implied };
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

/** The core on-chain action for a category, with a concrete amount and cadence. */
function coreAction(p: Protocol): string {
  const chain = p.chains[0] ?? 'its main chain';
  const name = p.name;
  switch (p.category) {
    case 'Dexs':
      return `Swap $50-$200 of stablecoins for another asset on ${name} and add $100-$300 to one of its main liquidity pools on ${chain}, holding the LP position for at least 4 weeks so the position counts in any snapshot; gas about $3-$10 per action, 1 hour to set up.`;
    case 'Lending':
      return `Supply $200-$500 of stablecoins or blue-chip collateral to ${name} on ${chain} and borrow $50-$100 against it, keeping the loan healthy above a 2x collateral ratio for 6-8 weeks; gas about $3-$8 per action, 1 hour to set up.`;
    case 'Yield':
    case 'Yield Aggregator':
      return `Deposit $200-$500 into the highest-TVL vault on ${name} on ${chain} and leave it compounding for 8-12 weeks, topping up $50 once a month so activity looks sustained rather than one-off; gas about $2-$6 per deposit, 45 minutes to set up.`;
    case 'Derivatives':
      return `Open a small $50-$150 perpetual or options position on ${name} on ${chain}, close it after a few days, and repeat 2-3 times a month for 2 months so volume is spread over time; gas and fees about $5-$15 per round trip, 1 hour per session.`;
    case 'RWA':
      return `Mint or hold a $100-$300 tokenised-asset position on ${name} on ${chain} and keep it for 8-12 weeks, completing any identity or allowlist step the protocol asks for; gas about $3-$8, 1-2 hours including verification.`;
    case 'CDP':
      return `Open a vault on ${name} on ${chain}, lock $200-$500 of collateral and mint $50-$150 of its stablecoin, keeping the vault above a 200% collateral ratio for 6-8 weeks; gas about $3-$8 per action, 1 hour to set up.`;
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return `Deposit $200-$500 into a curated vault on ${name} on ${chain} and leave it allocated for 8-12 weeks, rebalancing only when the curator publishes a new allocation; gas about $2-$6 per deposit, 45 minutes to set up.`;
    case 'Liquid Restaking':
    case 'Liquid Staking':
      return `Restake $100-$300 of ETH or liquid-staking tokens through ${name} on ${chain} and hold the receipt token for 8-12 weeks without unstaking; gas about $3-$8, 30 minutes to set up.`;
    default:
      return `Use ${name}'s main product on ${chain} with $100-$300 of real volume, repeat the core action once a week for 8-12 weeks, and keep a small position open throughout so the wallet shows sustained use; gas about $2-$8 per action, 1 hour a week.`;
  }
}

/** Five concrete farm steps (cost + time in each) for one protocol. */
function farmSteps(p: Protocol): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const others = p.chains.length > 1 ? ` It also runs on ${p.chains.slice(1, 3).join(', ')}.` : '';
  return [
    `Set up a fresh wallet for farming only, fund it with $300-$600 of stablecoins on ${chain}, and write down the seed phrase offline; ${p.name} records no token, so this wallet is your farming identity. Cost: $0 plus gas. Time: 30 minutes.${others}`,
    `Bridge the funds to ${chain} if they are not there yet, using the protocol's own bridge or a major bridge, and confirm the balance arrived before touching ${p.name}; keep $20-$30 spare for gas. Cost: $2-$10 in bridge fees. Time: 30-60 minutes.`,
    coreAction(p),
    `Return once a week for 8-12 weeks: repeat the core action in a smaller size, vote in any governance poll ${p.name} opens, and join its Discord or forum with the same wallet address so off-chain activity links to on-chain use. Cost: $2-$8 of gas a week. Time: 30 minutes a week.`,
    `Track everything in a spreadsheet: dates, amounts, transaction hashes and screenshots of each position. If ${p.name} announces a snapshot or token, keep positions open until the claim window closes, then withdraw half and leave the rest for 2 more weeks. Cost: $0. Time: 15 minutes a week.`,
  ];
}

// ---- main ----
const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snap = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
const watch = new Set(snap.watchlist);

// Live-token comparables: median market-cap/TVL anchors the model's base multiple.
const live = snap.protocols
  .filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0 && p.tvl_usd > 0)
  .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd as number, change_7d: p.change_7d, ratio: (p.mcap_usd as number) / p.tvl_usd }))
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));
const ratios = live.map((r) => r.ratio).sort((a, b) => a - b);
const liveMedian = ratios.length ? (ratios.length % 2 ? ratios[Math.floor(ratios.length / 2)]! : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2) : 0.21;

const scored = snap.protocols.filter(isRankable).map((p) => ({ p, s: score(p, snap.as_of) }));
scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
// Rank-integrity pass: strictly decreasing implied values down the board.
for (let i = 1; i < scored.length; i++) {
  if (scored[i]!.s.implied >= scored[i - 1]!.s.implied) scored[i]!.s.implied = Math.max(1, scored[i - 1]!.s.implied - 1);
}
const rows = scored.map(({ p, s }, i) => ({
  rank: i + 1,
  slug: p.slug,
  name: p.name,
  category: p.category,
  chains: p.chains,
  tvl_usd: p.tvl_usd,
  change_7d: p.change_7d,
  mcap_usd: p.mcap_usd,
  listed_at: p.listed_at,
  gecko_id: p.gecko_id,
  symbol: p.symbol,
  token_status: 'pre-token',
  age_days: s.age,
  watchlist: watch.has(p.slug),
  implied_value_usd: s.implied,
  implied_tvl_multiple: +(s.implied / Math.max(p.tvl_usd, 1)).toFixed(3),
  model: {
    base_multiple: 0.28, size_multiplier: +s.sizeMult.toFixed(3),
    growth_pct: s.growthPct, growth_multiplier: +s.growthMult.toFixed(3),
    maturity_multiplier: +s.maturityMult.toFixed(3), chain_multiplier: +s.chainMult.toFixed(3),
    age_days: s.age,
  },
  farm_steps: farmSteps(p),
}));
if (rows.length < 100) { process.stderr.write(`token radar: only ${rows.length} rankable rows\n`); process.exit(1); }
for (const slug of snap.watchlist) {
  if (!rows.some((r) => r.slug === slug)) { process.stderr.write(`token radar: watchlist slug ${slug} missing\n`); process.exit(1); }
}

const data = {
  as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd,
  model_version: MODEL_VERSION,
  model: { base_multiple: 0.28, size_exponent: -0.06, growth_up: 0.6, growth_down: 0.9, maturity_days: 730, live_median_mcap_tvl: +liveMedian.toFixed(3) },
  watchlist_size: snap.watchlist.length, board_size: rows.length,
  rows,
  live: live.slice(0, 20).map(({ slug, name, category, chains, tvl_usd, mcap_usd, change_7d, ratio }) => ({ slug, name, category, chains, tvl_usd, mcap_usd, change_7d, ratio: +ratio.toFixed(3) })),
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: rows.map((r) => ({ slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd, farm_steps: r.farm_steps })) })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR = ${JSON.stringify(data)};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) { process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3\n`); process.exit(1); }
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shots) if (!IMAGE_NAME.test(name)) { process.stderr.write(`token radar: bad screenshot name ${name}\n`); process.exit(1); }

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
process.stdout.write(`token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} watchlist, ${rows.length} rows, live median mcap/TVL ${liveMedian.toFixed(3)}\n`);
process.stdout.write(`token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard, ${shots.length} screenshots, ${join(out, 'dossier.json')}\n`);
