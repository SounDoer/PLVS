// Selected by scripts/history-chunk-size-benchmark.mjs on 2026-07-23.
// Machine: IT-DES0200348, Intel Core i7-13700K, Windows 10.0.22631, Node v22.12.0.
// Three runs chose 1024; dual-Spectrum p95: 5.807 ms, 2.012 ms, 3.058 ms.
// Selection: largest candidate with dual Spectrum <= 8 MiB and allocation+copy p95 < 8 ms.
// Audited rerun (rows | dual bytes | primary/dual/vectorscope p95 ms):
// 256  | 1,964,288 | 0.709 / 1.804 / 0.198
// 512  | 3,928,576 | 0.455 / 1.585 / 0.304
// 1024 | 7,857,152 | 1.655 / 2.726 / 0.511
// Measured winner: 1024 rows.
export const VISUAL_HISTORY_CHUNK_ROWS = 1024;
