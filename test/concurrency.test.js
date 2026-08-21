import assert from "node:assert/strict";
import { test } from "node:test";

import { mapWithConcurrency } from "../src/lib/concurrency.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("mapWithConcurrency preserves input order", async () => {
  const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
    await tick();
    return item * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8]);
});

test("mapWithConcurrency never exceeds the limit", async () => {
  let inFlight = 0;
  let peak = 0;
  await mapWithConcurrency([...Array(9).keys()], 3, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight -= 1;
    return item;
  });
  assert.equal(peak, 3);
});

test("mapWithConcurrency with limit 1 runs strictly sequentially", async () => {
  const order = [];
  await mapWithConcurrency(["a", "b", "c"], 1, async (item) => {
    order.push(`start:${item}`);
    await tick();
    order.push(`end:${item}`);
  });
  assert.deepEqual(order, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
});
