# SASS Encoding Lab

A static browser workbench for comparing 128-bit SASS words, inspecting the
bundled opcode tables, exploring cubins and experimental MLIR/CFG projections,
and saving an evidence notebook.

Open `/sass-encoding-lab/` over HTTP(S). Runtime assets and workers use relative
paths. No backend, CUDA installation, native bridge, or sign-in is required.
Cubin and MLIR files are processed in the browser tab. Drafts and notebook records
use this origin's localStorage; export JSON for backup or migration.

The browser projection does not run a native MLIR verifier, rewrite cubins, or
execute GPU code. Decoding and structural comparison do not establish semantic
or scheduling correctness. Use a browser supporting ES modules, BigInt, Workers,
and gzip DecompressionStream. Cubins are limited to 64 MB and function lifting
to 25,000 instructions.

Imported from the supplied SASS-Encoding-Lab-GitHub-Pages.zip, source revision
0927a7e620ae5c5f4c8c49359b19e1f1ed2b6ee1. The JavaScript port and source-derived
tables retain the upstream AGPL-3.0-or-later license and contributor attribution;
see LICENSE.txt. JavaScript source is delivered directly as ES modules.

Website integration adds project navigation and decorative generated gnomes.
The decoder AST includes targeted native-parity fixes for signed NaNs, memory
operands and instruction text formatting. Cubin target selection distinguishes
ABI-specific accelerator flags and reads matching architecture names from
`.note.nv.tkinfo`, preserving the hardware SM rather than its virtual target. Imported analyses, workers and source
archives retain their original bytes. Data loaders handle raw gzip and
HTTP-decoded responses with checksum verification. The built-in FA2 → FA3-style
example loads the exact bundled noncausal FA2 input and rebuilt output cubins
through the existing browser lift and comparison.
It does not execute the native transformation or GPU code; see examples/fa3/.

Run `node scripts/check-sass-decoder.mjs` from the website repository for the
frozen native decoder/parser regression cases; no native build is required.

The 2026-10-18 CPU parity audit covers all 39,142 retained cubins (14.94 GB),
including all functions and executable section ranges: 688,907,876 instruction
occurrences matched the current native decoder's admission and exact printed
assembly, with duplicate bytes/PCs reused. Of these, 9,536 occurrences in 12
SM75 files were rejected by both decoders and remain undecoded. Another 7,396
files contain no executable code. There were no parser errors, unsupported
architectures or partial instruction words. This establishes native decoder
parity on this corpus; it does not verify GPU execution or native MLIR semantics.
