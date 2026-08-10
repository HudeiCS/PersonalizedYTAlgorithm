# Lesson 1: logistic regression, from your own scoring formula

## The connection to your actual code

Open [`recommendationEngine.js`](../../yt-discover/backend/services/recommendationEngine.js) and look at the `score` calculation:

```js
const score =
  0.45 * topicMatch +
  0.15 * engagement +
  0.1  * freshness +
  0.3  * discover;
```

That's already a **linear model**. Four features go in, one number comes
out, via a weighted sum. The only thing separating this from "machine
learning" is where the weights (0.45, 0.15, 0.1, 0.3) came from — here,
you (or the AI that wrote it) picked them by intuition. In ML, you'd
instead show the model a pile of examples with known outcomes ("this
video got clicked," "this one didn't") and let an algorithm find the
weights that best explain those outcomes.

That's the whole exercise: recover a weight vector from data instead of
guessing it. The algorithm that does this is **gradient descent**, and
applied to a weighted-sum-plus-classification problem, the specific model
is called **logistic regression**.

## Why not just reuse the linear formula as-is?

Your `score` can be any number — nothing stops `0.45*topicMatch + ...`
from being 0.02 or 3.7 depending on the inputs. That's fine for *ranking*
candidates against each other, but it's meaningless as "the probability
this gets clicked." To learn from labeled outcomes (clicked=1,
not-clicked=0), we want the model to output something you can compare
directly to those 0/1 labels — a number between 0 and 1.

The fix is the **sigmoid function**:

```
σ(z) = 1 / (1 + e^-z)
```

It takes any real number and squashes it into (0, 1), with σ(0) = 0.5 as
the midpoint. So the model becomes:

```
p = σ(w·x + b)
```

— the exact same weighted sum as before (`w·x`), plus a bias term `b`
(a constant offset, like an intercept), squashed through sigmoid. `p` is
now a genuine probability estimate.

## Measuring "how wrong" a set of weights is

To improve the weights, you first need a number that says how bad the
*current* weights are. That's the **cost function**. For this kind of
0/1 prediction problem, the standard choice is **binary cross-entropy**:

```
cost(one example) = -[ y·log(p) + (1-y)·log(1-p) ]
```

Read it as two cases:
- if `y = 1`: cost is `-log(p)` — small when `p` is close to 1 (correct
  and confident), huge when `p` is close to 0 (confidently wrong).
- if `y = 0`: cost is `-log(1-p)` — mirror image.

Total cost is just the average of this across every example in your
dataset. Lower cost = weights that better explain the observed outcomes.

## Gradient descent: how the weights actually move

Picture `cost` as a landscape, and your current weights as your
position on it. The **gradient** at that position tells you the
direction of steepest increase. To reduce cost, you step in the
*opposite* direction — downhill — by a small amount controlled by the
**learning rate**. Do this thousands of times (**epochs**), and the
weights walk toward a low-cost region: values that fit the data well.

```
w := w - learningRate * (∂cost/∂w)
b := b - learningRate * (∂cost/∂b)
```

That's genuinely the entire algorithm. No matrix magic, no black box —
just "compute the slope, take a small step opposite the slope, repeat."

## The exercise

Open [`exercise.js`](./exercise.js) and fill in, in order:

1. **`sigmoid(z)`** — the formula above, directly.
2. **`predict(weights, bias, x)`** — compute `w·x + b`, pass it through
   `sigmoid`.
3. **`cost(weights, bias, X, y)`** — the binary cross-entropy formula
   above, averaged over all examples.
4. **`gradients(weights, bias, X, y)`** — the partial derivatives of
   `cost` w.r.t. each weight and the bias. Don't feel obligated to
   derive this by hand from scratch — look up "logistic regression
   gradient derivation," you'll find the same clean closed form
   everywhere (sigmoid + cross-entropy were practically designed to
   simplify together). Translate it into code.

After each function, run:

```
node check.js
```

It won't tell you the formulas, but it will tell you exactly which
behavior is wrong (e.g. "sigmoid(0) isn't landing on 0.5" or "dWeights[2]
doesn't match the numerical estimate"). The gradient check in particular
is a real debugging technique, not a lesson-specific gimmick — it works
by nudging each weight by a tiny amount and measuring how much `cost()`
actually changes, then comparing that against what your `gradients()`
claims. If those disagree, your calculus (or your code) is wrong,
independent of anything else.

Once `check.js` is all green:

```
node exercise.js
```

This generates a synthetic dataset shaped exactly like your real
problem — four features in [0,1], a 0/1 label — using a hidden "true"
weight vector you don't get to see. It trains your logistic regression
on that data and prints the learned weights. Compare them to the
revealed true weights at the end. They won't match exactly (noise sees
to that), but they should be clearly in the same ballpark and same sign.
Watching the cost printout across epochs should show it steadily
decreasing — if it's flat or exploding, that's a sign to revisit your
learning rate or your gradient math.

## Where this goes next (not part of this exercise)

Once this clicks, the natural next step back in the real app is:

- **Capturing real labels.** Right now nothing in `recommendations.js`
  records whether a user liked/clicked/dismissed a suggestion — you'd
  need a small feedback endpoint before you have anything to train on.
- **Swapping the hand-picked weights** in `rankCandidates()` for weights
  learned via exactly this process, trained on real feedback instead of
  synthetic data.
- Later: richer features, embeddings instead of bag-of-words, etc. — but
  that's stage 3+, not stage 1.

We'll tackle those in a separate pass once you're comfortable with what's
happening in this folder — no need to rush ahead.
