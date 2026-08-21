/**
 * Map over items with a bounded number of in-flight tasks, preserving order.
 * Used to keep pressure off Apple's public API: a small list runs sequentially
 * (limit 1) and a larger one runs a few requests at a time.
 */
export async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}
