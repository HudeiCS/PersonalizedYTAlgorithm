// Infrastructure for the lesson — you don't need to write anything in this
// file, just read `generateDataset` to understand what you're being handed.
//
// It fabricates a toy version of the real problem: each "example" is a
// candidate video with the same four features your real engine already
// computes (topicMatch, engagement, freshness, discoverability), each in
// [0, 1] just like the real ones. Instead of a real user, we use a secret
// "true" weight vector to decide how likely each candidate was to get a
// click, then flip a biased coin to produce an actual clicked/notClicked
// label. That's what makes this supervised learning: every row has a
// feature vector AND a known outcome.
//
// Your job in exercise.js is to recover weights close to the secret ones
// using nothing but the features and labels — the same position you'd be
// in with real user click data.

const TRUE_WEIGHTS = [2.6, 0.9, 0.4, 1.3]; // [topicMatch, engagement, freshness, discoverability]
const TRUE_BIAS = -1.9;

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function randomFeatureVector() {
  return [Math.random(), Math.random(), Math.random(), Math.random()];
}

/** Bernoulli draw: returns 1 with probability p, else 0. */
function sampleLabel(p) {
  return Math.random() < p ? 1 : 0;
}

/**
 * @param n number of examples to generate
 * @returns { X, y } where X is an array of 4-element feature arrays and
 *          y is a parallel array of 0/1 labels.
 */
export function generateDataset(n = 200) {
  const X = [];
  const y = [];
  for (let i = 0; i < n; i++) {
    const x = randomFeatureVector();
    const z = x.reduce((sum, xj, j) => sum + xj * TRUE_WEIGHTS[j], TRUE_BIAS);
    const p = sigmoid(z);
    X.push(x);
    y.push(sampleLabel(p));
  }
  return { X, y };
}

/** Call this AFTER you've trained, to compare your learned weights against
 *  the ones that actually generated the data. Don't peek before then —
 *  there's nothing to check your work against until you have your own
 *  trained weights to compare. */
export function revealAnswer() {
  console.log("\n(secret weights used to generate the data, for comparison)");
  console.log("true weights:", TRUE_WEIGHTS);
  console.log("true bias:   ", TRUE_BIAS);
}
