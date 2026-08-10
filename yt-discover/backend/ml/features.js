// Single source of truth for feature ordering, shared between training
// (trainWeights.js) and serving (recommendationEngine.js). If these two
// ever used different orders, weights.length would still match, everything
// would still run without error, and every score would just be silently
// wrong — position 0 meaning "topicMatch" during training but getting
// multiplied against "engagement" at serving time. Importing the same
// array in both places makes that class of bug structurally impossible.
export const FEATURE_ORDER = ["topicMatch", "engagement", "freshness", "discover"];
