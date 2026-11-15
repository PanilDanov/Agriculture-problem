# Field-source collection deadlines

`collect_field_context` has an overall wall-clock budget, independent of individual provider connect/read timeouts. The default is 32 seconds and the collector caps any requested budget at 35 seconds. A pre-existing earlier `SourceClient.deadline` is preserved. A fresh per-collection client is created so late work from one request cannot have its deadline extended by another.

NASA historical weather, soil, recent observations and country lookup run independently. Calendars run after country resolution. Completed values remain available when optional sources exceed the budget. Missing calendar results retain all ten crop IDs with `status: unavailable` and `missing_reason: lookup_incomplete`; unknown values are not replaced with zero or example data.

Provider thread pools are process-wide and bounded:

- outer source pool: eight workers, at most twelve active/queued tasks;
- soil pool: four workers, at most eight tasks;
- calendar pool: four workers, at most eight tasks;
- at most two simultaneous logical collections.

Nested executors are not created for every HTTP request. There is no context-manager shutdown that joins all slow optional workers past the collection deadline. Pending futures are cancelled. A Python thread already inside an external socket call or native parser cannot be forcibly killed safely; it remains inside the fixed process worker budget until it exits. Subsequent requests cannot create unbounded threads or unbounded source queues. When the budget is saturated, the source returns a retryable provider failure.

The overall collection deadline does not include later ML inference or response serialization. Configure the browser/proxy timeout above the combined source and ML budgets. Individual source calls still use bounded connect/read timeouts and deadline-aware URL coalescing. Cache reads validate the source representation before treating it as a valid hit; malformed payloads do not become persistent successful hits.

The regression check blocks optional mocked providers for 200 ms, uses a 40 ms collection deadline, verifies return below 150 ms, preserves the completed NASA result and country, and retains ten explicit calendar statuses. Scientific source-normalization, corrupt gzip, cache corruption, offline replay and missing soil values remain covered by the original tests.

```bash
python -m unittest agronomy.tests.test_collection_deadline agronomy.tests.test_source_resilience agronomy.tests.test_field_context -v
```
