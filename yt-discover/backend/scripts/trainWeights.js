// Run with: node scripts/trainWeights.js (from backend/), or `npm run train`.
//
// Turns stored feedback into a labeled dataset, trains logistic regression
// on it, and writes the result to db/learnedWeights.json. rankCandidates()
// in recommendationEngine.js picks that file up automatically on the next
// request if it's present, and falls back to the original hand-picked
// blend if it's not (e.g. a fresh install with no feedback yet).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getAllFeedback } from "../db/feedback.js";
import { train } from "../ml/logisticRegression.js";
import { FEATURE_ORDER } from "../ml/features.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "db", "learnedWeights.json");

// Below this many examples, gradient descent has too little signal to be
// meaningful — weights would mostly reflect noise, not real preference.
const MIN_EXAMPLES = 20;

function buildDataset(events) {
  const X = events.map((event) => FEATURE_ORDER.map((key) => event.features[key] ?? 0));
  const y = events.map((event) => event.label);
  return { X, y };
}

function main() {
  const events = getAllFeedback();

  if (events.length < MIN_EXAMPLES) {
    console.log(`Only ${events.length} feedback events recorded — need at least ${MIN_EXAMPLES} before training means anything.`);
    console.log("Go like/dismiss more recommendations in the app, then rerun this script.");
    return;
  }

  const positives = events.filter((e) => e.label === 1).length;
  if (positives === 0 || positives === events.length) {
    console.log("All feedback so far is the same label (all likes or all dismissals) — nothing for the model to distinguish yet.");
    return;
  }

  const { X, y } = buildDataset(events);
  const { weights, bias, finalCost } = train(X, y);

  console.log(`Trained on ${events.length} examples (${positives} liked, ${events.length - positives} dismissed).`);
  console.log(`Final cost: ${finalCost.toFixed(4)}\n`);
  console.log("Learned weights:");

  // Convert the positional array back to a named object before saving —
  // recommendationEngine.js reads this file long after this script has
  // exited, so it shouldn't have to trust that FEATURE_ORDER hasn't
  // changed in between; looking weights up by name is self-describing.
  const weightsByName = {};
  FEATURE_ORDER.forEach((name, j) => {
    weightsByName[name] = weights[j];
    console.log(`  ${name.padEnd(14)} ${weights[j].toFixed(3)}`);
  });
  console.log(`  ${"bias".padEnd(14)} ${bias.toFixed(3)}`);

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      { weights: weightsByName, bias, trainedAt: Date.now(), sampleCount: events.length, finalCost },
      null,
      2
    )
  );
  console.log(`\nSaved to ${OUTPUT_PATH}`);
}

main();
