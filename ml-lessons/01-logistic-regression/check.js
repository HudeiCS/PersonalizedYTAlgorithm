// Test harness — run with `node check.js`. Tells you what's still broken
// in exercise.js without ever printing the formulas themselves. The
// gradient check in particular is a real technique used in practice
// (Andrew Ng's ML course popularized it): instead of trusting your calculus,
// you numerically estimate the slope of cost() by nudging each weight a
// tiny amount and seeing how much the cost changes, then compare that
// estimate against what your gradients() function claims. If they don't
// match, your analytic gradient is wrong — full stop, no ambiguity.

import { sigmoid, predict, cost, gradients } from "./exercise.js";

let passed = 0;
let failed = 0;

function check(label, condition, hint) {
  if (condition) {
    console.log(`  ok   ${label}`);
    passed++;
  } else {
    console.log(`  FAIL ${label}${hint ? `\n       hint: ${hint}` : ""}`);
    failed++;
  }
}

function approxEqual(a, b, eps = 1e-3) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < eps;
}

console.log("1. sigmoid()");
check("sigmoid(0) === 0.5", approxEqual(sigmoid(0), 0.5), "σ(0) should land exactly on the midpoint of (0,1)");
check("sigmoid(large positive) -> ~1", approxEqual(sigmoid(50), 1), "large z should saturate near 1");
check("sigmoid(large negative) -> ~0", approxEqual(sigmoid(-50), 0), "very negative z should saturate near 0");
check("sigmoid is monotonic increasing", sigmoid(1) > sigmoid(0) && sigmoid(2) > sigmoid(1));

console.log("\n2. predict()");
const w0 = [0, 0, 0, 0];
check(
  "with all-zero weights and bias, predict() is 0.5 regardless of x",
  approxEqual(predict(w0, 0, [0.9, 0.1, 0.5, 0.3]), 0.5),
  "w·x + b is 0 when weights and bias are 0, and sigmoid(0) = 0.5"
);
const w1 = [1, 0, 0, 0];
check(
  "a single unit weight on feature 0 reproduces sigmoid(x0)",
  approxEqual(predict(w1, 0, [0.7, 5, 5, 5]), sigmoid(0.7)),
  "predict should be sigmoid(weights · x + bias) — other features should be ignored when their weight is 0"
);

console.log("\n3. cost()");
const Xc = [[0, 0, 0, 0]];
check(
  "cost is near 0 when the model confidently predicts the right label",
  approxEqual(cost([50, 0, 0, 0], 0, [[1, 0, 0, 0]], [1]), 0, 1e-2),
  "predict() will output ~1 here (large positive w·x), and y=1, so the example should be nearly free"
);
check(
  "cost is large when the model confidently predicts the wrong label",
  cost([50, 0, 0, 0], 0, [[1, 0, 0, 0]], [0]) > 5,
  "predict() outputs ~1 here but y=0 — that's a confidently wrong prediction and should be expensive"
);

console.log("\n4. gradients() — numerical check against your own cost()");
function numericalGradient(weights, bias, X, y) {
  const h = 1e-5;
  const dWeights = weights.map((_, j) => {
    const wPlus = [...weights];
    wPlus[j] += h;
    const wMinus = [...weights];
    wMinus[j] -= h;
    return (cost(wPlus, bias, X, y) - cost(wMinus, bias, X, y)) / (2 * h);
  });
  const dBias = (cost(weights, bias + h, X, y) - cost(weights, bias - h, X, y)) / (2 * h);
  return { dWeights, dBias };
}

// A small fixed dataset so the check is deterministic across runs.
const Xg = [
  [0.9, 0.2, 0.6, 0.1],
  [0.1, 0.8, 0.3, 0.9],
  [0.5, 0.5, 0.5, 0.5],
  [0.2, 0.1, 0.9, 0.4],
];
const yg = [1, 0, 1, 0];
const wg = [0.3, -0.2, 0.1, 0.05];
const bg = 0.1;

const analytic = gradients(wg, bg, Xg, yg);
const numeric = numericalGradient(wg, bg, Xg, yg);

if (
  analytic &&
  Array.isArray(analytic.dWeights) &&
  analytic.dWeights.length === wg.length &&
  typeof analytic.dBias === "number"
) {
  analytic.dWeights.forEach((dw, j) => {
    check(
      `dWeights[${j}] matches numerical estimate (got ${dw.toFixed(4)}, expected ~${numeric.dWeights[j].toFixed(4)})`,
      approxEqual(dw, numeric.dWeights[j], 1e-2)
    );
  });
  check(
    `dBias matches numerical estimate (got ${analytic.dBias.toFixed(4)}, expected ~${numeric.dBias.toFixed(4)})`,
    approxEqual(analytic.dBias, numeric.dBias, 1e-2)
  );
} else {
  check(
    "gradients() returns { dWeights: number[4], dBias: number }",
    false,
    "check the shape of what you're returning"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("\nAll green — run `node exercise.js` to train on the toy dataset.");
} else {
  process.exitCode = 1;
}
