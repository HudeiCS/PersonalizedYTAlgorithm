// YOUR WORK GOES HERE. Fill in the four TODOs below in order — each one
// builds on the last. Full instructions and the concepts behind each
// function are in README.md; read that first if you haven't.
//
// Workflow:
//   1. Implement sigmoid()
//   2. Implement predict()
//   3. Implement cost()
//   4. Implement gradients()   <- the one worth taking slowly
//   5. Run `node check.js` after each step — it tells you what's still
//      broken without telling you the formula.
//   6. Once check.js is all green, run `node exercise.js` to actually
//      train on the toy dataset and see your weights converge.

/**
 * Squashes any real number into the open interval (0, 1) so it can be
 * read as a probability.
 *
 *   σ(z) = 1 / (1 + e^-z)
 */
export function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

/**
 * The model's predicted probability that y = 1 for one example.
 * This is just w·x + b (the same kind of linear blend your real
 * recommendationEngine.js already does) run through sigmoid().
 *
 * @param weights  array of per-feature weights, e.g. [w1, w2, w3, w4]
 * @param bias     single scalar bias term
 * @param x        one example's feature array, e.g. [topicMatch, engagement, freshness, discoverability]
 * @returns number in (0, 1)
 */
export function predict(weights, bias, x) {
  let result = 0
  for (let i = 0; i < weights.length; i++) {
    result += weights[i] * x[i]
  }
  result += bias
  return sigmoid(result);
}

/**
 * Binary cross-entropy cost, averaged over every example.
 *
 * For a single example: -[ y*log(p) + (1-y)*log(1-p) ]
 * where p = predict(weights, bias, x_i)
 *
 * Intuition: if y=1 and your model predicted p=0.99, that term is ~0
 * (barely penalized). If y=1 and your model predicted p=0.01, that term
 * blows up (heavily penalized) — confidently wrong costs a lot more than
 * mildly wrong.
 *
 * @returns the mean cost across all n examples (a single number)
 */
export function cost(weights, bias, X, y) {
  let error = 0;
  let m = X.length;
  const eps = 1e-15; // Small constant to prevent log(0)

  for (let i = 0; i < m; i++) {
    let p = predict(weights, bias, X[i]);
    
    // Clamp p between eps and 1 - eps
    p = Math.max(eps, Math.min(1 - eps, p));
    
    error += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
  }
  return error / m;
}

/**
 * Gradient of the cost function with respect to each weight and the bias
 * — i.e. "which direction, and how much, should each weight move to
 * reduce cost right now."
 *
 * This is the one worth NOT rushing. Look up "logistic regression
 * gradient derivation" (binary cross-entropy + sigmoid) — you'll find
 * the same clean closed form in basically every source, because the
 * sigmoid and the log-loss were practically designed to cancel out
 * nicely together. Translate whatever formula you find into code here,
 * then run `node check.js`, which numerically verifies your gradient
 * against the cost() function you already wrote — completely
 * independent of whether you copied the formula right.
 *
 * @returns { dWeights: number[], dBias: number }
 */
export function gradients(weights, bias, X, y) {
  const m = X.length;

  // build-up variables: start empty, grow as we loop
  const dWeights = new Array(weights.length).fill(0); // one running total per weight
  let dBias = 0;                                       // one running total, no per-feature split

  for (let i = 0; i < m; i++) {          // i = which example
    const p = predict(weights, bias, X[i]);
    const error = p - y[i];              // per-instance: fresh every i, thrown away after

    for (let j = 0; j < weights.length; j++) {  // j = which weight/feature
      dWeights[j] += error * X[i][j]; // feature value * error
    }
    dBias += error;
  }

  // TODO: divide dWeights (each entry) and dBias by m, then return { dWeights, dBias }
  const finalDWeights = dWeights.map(d => d / m);
  const finalDBias = dBias / m
  return { dWeights: finalDWeights, dBias: finalDBias };
}


// --- Given: the training loop. The "learning" is entirely in the four
// functions above; this just repeatedly nudges weights downhill. ---
export function train(X, y, { epochs = 3000, learningRate = 0.5, logEvery = 300 } = {}) {
  const numFeatures = X[0].length;
  let weights = new Array(numFeatures).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch <= epochs; epoch++) {
    const { dWeights, dBias } = gradients(weights, bias, X, y);
    weights = weights.map((w, j) => w - learningRate * dWeights[j]);
    bias = bias - learningRate * dBias;

    if (epoch % logEvery === 0) {
      console.log(`epoch ${epoch}\tcost ${cost(weights, bias, X, y).toFixed(4)}`);
    }
  }
  return { weights, bias };
}

// --- Run `node exercise.js` to actually train once check.js is green ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const { generateDataset, revealAnswer } = await import("./data.js");
  const { X, y } = generateDataset(300);

  console.log("training...\n");
  const { weights, bias } = train(X, y);

  console.log("\nlearned weights (topicMatch, engagement, freshness, discoverability):");
  console.log(weights.map((w) => w.toFixed(3)));
  console.log("learned bias:", bias.toFixed(3));

  revealAnswer();
}
