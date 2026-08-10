// Logistic regression via gradient descent — the production version of the
// same algorithm built by hand in ml-lessons/01-logistic-regression. See
// that lesson's README for the full derivation (sigmoid, cross-entropy
// cost, and why the gradient reduces to `error * featureValue`); this file
// is the same math, just written once so trainWeights.js has something
// real to call.

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

export function predict(weights, bias, x) {
  const z = weights.reduce((sum, w, j) => sum + w * x[j], bias);
  return sigmoid(z);
}

function cost(weights, bias, X, y) {
  const eps = 1e-12; // avoids log(0) when a prediction saturates to exactly 0 or 1
  const n = X.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.min(Math.max(predict(weights, bias, X[i]), eps), 1 - eps);
    total += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
  }
  return total / n;
}

function gradients(weights, bias, X, y) {
  const n = X.length;
  const dWeights = new Array(weights.length).fill(0);
  let dBias = 0;
  for (let i = 0; i < n; i++) {
    const error = predict(weights, bias, X[i]) - y[i];
    for (let j = 0; j < weights.length; j++) {
      dWeights[j] += error * X[i][j];
    }
    dBias += error;
  }
  return { dWeights: dWeights.map((d) => d / n), dBias: dBias / n };
}

/**
 * @returns { weights: number[], bias: number, finalCost: number }
 */
export function train(X, y, { epochs = 3000, learningRate = 0.5 } = {}) {
  const numFeatures = X[0].length;
  let weights = new Array(numFeatures).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const { dWeights, dBias } = gradients(weights, bias, X, y);
    weights = weights.map((w, j) => w - learningRate * dWeights[j]);
    bias -= learningRate * dBias;
  }

  return { weights, bias, finalCost: cost(weights, bias, X, y) };
}
