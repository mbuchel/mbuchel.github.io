# Bundled FA2 → fresh Hopper program example

This example follows `flash-attention-resynth`, not the separate `flash-attention`
(alias `pc`) prologue rewrite or the unchanged `flash-attention-target` reference.
It uses copied, unmodified artifacts from the accepted October 14, 2026
study. `manifest.json` records hashes and exact selected symbols.

- `fa2-input.cubin`: admitted noncausal FP16 D64 FA2 input; selected function
  has 3,112 words. The full image includes unrelated functions.
- `fa3-style-output.cubin`: fresh source-program body in the pinned FA3 ABI
  container. Selected function has 1,929 regenerated words; M192 × N192,
  512 threads, one producer and three math warpgroups, static persistent work.
  Normalization forms are independently constructed; no selected FA3 body is retained.
- `fa3-style-output.cubin.launch.json`: exact published sidecar, binding source
  and output hashes, 2,944 parameter bytes and 222,208 dynamic shared bytes.
  Launch requires the supported adapter.
- `native-program.mlir`: exact native diagnostic dump after logical construction,
  overlap, work mapping and physical lowering. It retains logical functions and
  unfinished publication markers, so it is not directly launchable.
- `generation.json`: original retained receipt, including the compiler/input/output
  pins, command, selected words and environment policies. Its original local paths
  describe provenance; they are not URLs on this site.

The input hash is
`fbd4bc6cbc5b6f028cd30f23eb90783e97ca5a60d5e20b294dc83d08bb98ec52`;
the output hash is
`89050c25cdfbfecd0395ad88131eee670e095978583b94bbe777254b634e6a01`.

Source artifacts in the sass2mlir checkout:

- `build/fa-replay/20260920-ablations/inputs/original.cubin`
- `build/fa-native-convergence-20261008-01/deployment-183-full-01/stage/images/noncausal-full.cubin[.launch.json]`
- `build/fa-native-convergence-20261008-01/control-flow-after-183-03/images/phases/noncausal-converged/source-program.mlir`
- Noncausal entry in `build/fa-native-convergence-20261008-01/control-flow-after-183-03/generation.json`

The browser checks binary hashes, lifts only the two manifest-selected functions
with its experimental JavaScript port, and opens their structural comparison.
That comparison is not the native pass pipeline or a semantic equivalence proof.
It invokes no native optimization, native MLIR verifier or GPU kernel.

Arithmetic has source SSA witnesses. Mask, iteration and epilogue construction
also rely on the bounded reviewed program profile, explicitly recorded in the
native IR as `reviewed-program-profile-not-dynamic-ssa-proof`. The runtime domain
is finite, non-aliasing dense FP16 buffers, H8/D64, equal Q/K lengths, scale 1/8,
no dropout, B1/2/4 and power-of-two S128–32768. Numerical acceptance covers the
recorded inputs; finite values alone do not guarantee universal correctness.

The full measured study accepts 108-cell timing and ordinary/memcheck/synccheck
execution gates. Full Nsight profiling remains unaccepted: a causal replay raised
`CUDA_ERROR_ILLEGAL_INSTRUCTION` with the cause unresolved. The dated full measurement record and paper evidence retain the separate
evidence scopes; exact binary and compiler pins remain in the included receipt.

FlashAttention/CUTLASS retain their BSD notices in `LICENSE.flash-attention` and
`LICENSE.cutlass`. sass2mlir performed the transformation; native IR and browser
port retain its AGPL notice in `../../LICENSE.txt`.

`timings.csv` is an unmodified copy of the accepted full study's 108-cell raw
export. The manifest pins its SHA-256 and byte count. `mean_original_ms`,
`mean_converted_ms` and `mean_fa3_ms` are milliseconds; visible example tables
multiply by 1,000 to show microseconds. Each cell includes three process means.
The app table selects only noncausal B1/H8/S4096/D64 for the exact bundled image;
its two rows do not represent the entire workload family.
