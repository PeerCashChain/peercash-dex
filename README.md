# peercash-dex

Reconstructed DEX deploy for PeerCash: **WPEER** (wrapped native) + **canonical
Uniswap V2** (factory + router).

## Why this avoids the init-code-hash problem

The one change needed in a Uniswap V2 fork is the pair `init-code-hash` hardcoded
in `UniswapV2Library.pairFor` (which the Router depends on). That only diverges
from canonical when the **Pair is recompiled** with a non-canonical solc.

This repo sidesteps it: it deploys the **canonical prebuilt artifacts** from the
`@uniswap/v2-core` / `@uniswap/v2-periphery` npm packages. The Pair bytecode is
canonical, so its hash is the canonical `0x96e8ac42...` that the stock Router
already embeds. No patch, no re-derivation. Only `WPEER` is compiled locally,
and it is token-agnostic so it never enters the pair hash.

The deploy still runs a **golden check** (`pairFor == factory.getPair`) and aborts
if they ever diverge.

## Deploy order (required)

1. **WPEER** (no deps) - the frozen anchor address.
2. **UniswapV2Factory**(feeToSetter).
3. **UniswapV2Router02**(factory, WPEER) - needs both prior addresses.

## Run (testnet first - chainId 563321)

```sh
npm install
cp .env.example .env      # fill RPC_URL, PRIVATE_KEY (funded testnet key)
npm run deploy
```

Then smoke-test on testnet: wrap PEER -> WPEER, addLiquidity, swap, removeLiquidity.

## Mainnet (chainId 620156) - human-gated (RULE 6)

Only after a clean testnet pass. Set `RPC_URL`/`EXPECT_CHAIN_ID` to mainnet in
`.env`, re-run. Testnet and mainnet configs must never cross. Record the three
frozen addresses from `deployments/620156.json`, publish them, and verify source
on the explorer (canonical solc: core 0.5.16 / runs 999999, periphery 0.6.6).

## Notes

- All txs use explicit fees (1 gwei priority / 2 gwei max). Never auto-estimate
  on this chain (base fee ~7 wei -> auto-estimation yields un-mineable txs).
- `deployments/<chainId>.json` records the frozen addresses + init-code-hash.
