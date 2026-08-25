// Repartos con solución comprobada.
// Cada semilla se ha resuelto con un buscador en profundidad (ver test/engine.test.js),
// tanto robando de una como de tres. Se usan cuando activas "solo manos con solución".
export const SOLVABLE_SEEDS = [
  5, 8, 17, 20, 21, 29, 31, 36, 44, 45, 48, 53, 64, 65, 66, 68, 85, 87, 94, 100, 102, 108,
  110, 111, 115, 120, 124, 132, 136, 137, 138, 145, 148, 149, 150, 151, 156, 160, 165, 166,
  167, 176, 178, 179, 181, 191, 194, 195, 202, 203, 214, 216, 218, 219, 221, 223, 225, 228,
  229, 233, 239, 244, 245, 246, 248, 251, 255, 257, 259, 261, 262, 273, 275, 280, 285, 288,
  289, 294, 295, 299, 313, 315, 316, 318, 319, 323, 326, 334, 338, 341, 342, 345, 349, 351,
  352, 353, 355, 358, 359, 365, 372, 382, 388, 389, 391, 393, 394, 396, 402, 405, 407, 412,
  413, 416, 418, 419, 426, 430, 431, 432, 439, 440, 441, 445, 455, 462, 463, 465, 467, 468,
  475, 477, 491, 512, 514, 515, 517, 519, 521, 524, 525, 529, 532, 533, 537, 538, 539, 545,
  554, 559,
];

export function randomSolvableSeed(exclude) {
  const pool = SOLVABLE_SEEDS.filter((s) => s !== exclude);
  const list = pool.length ? pool : SOLVABLE_SEEDS;
  return list[Math.floor(Math.random() * list.length)];
}

export const isKnownSolvable = (seed) => SOLVABLE_SEEDS.includes(seed);
