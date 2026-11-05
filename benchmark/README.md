# Offline Quality Evaluation

This is a small, ClearWrite-authored regression benchmark, not a representative public accuracy claim. The five `dev` cases include user-reported examples. The separate `test` cases cover other typos, partial sentences, clean prose, dialects, protected tokens and non-English input. Once inspected during development, these are regression fixtures, not permanently unseen evaluation data. Grow a separately reviewed holdout set before claiming general accuracy.

## Run

```powershell
node scripts/benchmark-offline.js basic-final --basic
node scripts/benchmark-offline.js enhanced-final
node scripts/compare-offline.js
```

Reports go to the ignored `benchmark/results/` directory. Both modes use the same Harper, language filtering and token protection. `--basic` disables candidate expansion and statistical context only; it does not recreate every historical version. The original `baseline` report, when present locally, predates this implementation.

Metrics include target detection, intended replacement in the top three, intended replacement selected into the proposed text, wrong target substitutions, changes and flags on clean cases, cold first request, warm p50/p95, whole-process RSS (including the worker), and five samples each at approximately 10, 50 and 500 words. Warm timings exclude initial loading. RSS depends on garbage collection and is not the model's size or a precise memory-growth profile. No CPU-load simulation is performed.

The comparison gate rejects reduced target coverage, increased wrong target substitutions or clean-text changes/flags, short-text p95 at 150 ms or above, or over 256 MiB additional steady RSS. It cannot prove that every other edit preserves meaning; inspect report outputs. Timing and memory gates are preliminary budgets, not guarantees on all hardware.

## Local Measurement (2026-11-05)

Windows, Node 20.9.0; one sequential run per mode, not a statistical performance study:

| Evaluation metric | Basic | Enhanced |
| --- | ---: | ---: |
| Target corrections selected (separate test split) | 5/12 | 11/12 |
| Intended replacement among first three | 8/12 | 12/12 |
| Wrong target substitutions | 3 | 0 |
| Clean cases changed | 0/14 | 0/14 |
| Short-text warm p95 | 23.52 ms | 24.02 ms |
| First request, including Harper startup | 8.66 s | 9.15 s |
| Whole-process RSS after warm samples | 406 MiB | 514 MiB |

All comparison gates passed. The remaining target (`wierd`) was detected with the intended candidate but left for review. This small fixture set does not establish general accuracy. Initial Harper startup and its transient allocation remain substantial: peak RSS was approximately 1.2 GiB in both runs. The app's already-running checker does not pay this startup cost on every request. Node 20.9 was the available test runtime; the application's documented supported version remains Node 22.12 or later.

## Architecture And Limits

Only Harper spelling findings and single-word typo findings are expanded. Mnemonist's SymSpell implementation searches bounded prefixes in a 30,000-word index. Full-word typo cost filters the results. A score combines spelling cost, unigram frequency and adjacent-word bigram association; punctuation separates context. A clear statistical winner or an agreeing basic-ranker winner may enter the proposed text. A single Harper recommendation remains available as before. Harper validates selected words in the configured dialect. Actual replacement in another application still requires the user's existing Apply action.

There are no word-specific correction pairs or sentence-specific verb lists. Score weights and margins are heuristic starting points, not learned or calibrated confidence probabilities. The model uses published corpus statistics, not user typing or provider responses. Names, technical vocabulary, rare words, code, Roman Urdu, grammar insertions and real-word confusions remain limitations. Clean real words are not automatically replaced merely because a more common neighbor exists.

## Rebuild Data

`npm run model:build` explicitly accesses the internet to download version-pinned source data and license notices, filter it, and generate the compressed runtime model plus SHA-256 manifest. Runtime checking reads only the bundled files. See `assets/offline/manifest.json` and `THIRD_PARTY_NOTICES.md` for source attribution, modifications and licenses. Keep those files with redistributions.
