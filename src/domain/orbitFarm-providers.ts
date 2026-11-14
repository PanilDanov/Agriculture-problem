import type { AnalysisProvider, ScenarioId } from './orbitFarm-types';
import { makeMockAnalysis } from './orbitFarm-fixtures';
import { validateAnalysisRequest, validateAnalysisResult } from './orbitFarm-validation';

export class AnalysisServiceError extends Error {
  constructor(public readonly code: 'unavailable' | 'timeout' | 'no_coverage' | 'invalid_response' | 'invalid_request' | 'aborted', message: string) {
    super(message);
    this.name = 'AnalysisServiceError';
  }
}

function abortError(): AnalysisServiceError { return new AnalysisServiceError('aborted', 'The analysis was cancelled.'); }

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createMockProvider(scenarioId: ScenarioId, options: { latencyMs?: number } = {}): AnalysisProvider {
  return {
    async analyze(value, signal) {
      const request = validateAnalysisRequest(value);
      await delay(options.latencyMs ?? 800, signal);
      if (scenarioId === 'api-unavailable') throw new AnalysisServiceError('unavailable', 'Analysis unavailable. The demo service is intentionally offline in this test bench. Try another scenario or retry.');
      return makeMockAnalysis(request, scenarioId);
    },
  };
}

export function createApiProvider(baseUrl: string, options: { timeoutMs?: number } = {}): AnalysisProvider {
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new AnalysisServiceError('invalid_request', 'Enter a complete HTTP or HTTPS backend URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new AnalysisServiceError('invalid_request', 'Use an HTTP or HTTPS backend URL without embedded credentials, query parameters, or fragments.');
  const clean = parsed.toString().replace(/\/$/, '');
  const endpoint = clean.endsWith('/v1/analysis') ? clean : clean.endsWith('/v1') ? `${clean}/analysis` : `${clean}/v1/analysis`;
  return {
    async analyze(value, signal) {
      const request = validateAnalysisRequest(value);
      if (signal?.aborted) throw abortError();
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 12000);
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
        if (response.status === 404 || response.status === 422) {
          const body: unknown = await response.json().catch(() => null);
          const code = body && typeof body === 'object' && 'code' in body ? body.code : null;
          if (code === 'NO_COVERAGE') throw new AnalysisServiceError('no_coverage', 'No environmental data covers this field. Try another boundary or add local information.');
          throw new AnalysisServiceError('invalid_request', `The analysis request was not accepted (HTTP ${response.status}). Check the field and backend endpoint.`);
        }
        if (!response.ok) throw new AnalysisServiceError('unavailable', `Analysis unavailable (HTTP ${response.status}). Your saved farm is still available.`);
        let result;
        try { result = validateAnalysisResult(await response.json()); }
        catch { throw new AnalysisServiceError('invalid_response', 'The backend returned an incompatible analysis. Check the response contract; no demo result has been substituted.'); }
        if (result.requestId !== request.requestId || result.farmId !== request.farmId || result.boundaryVersion !== request.boundaryVersion) throw new AnalysisServiceError('invalid_response', 'The backend response belongs to a different request or field boundary.');
        return result;
      } catch (error) {
        if (timedOut) throw new AnalysisServiceError('timeout', 'The analysis request timed out. Check the backend connection and try again.');
        if (signal?.aborted) throw abortError();
        if (error instanceof AnalysisServiceError) throw error;
        throw new AnalysisServiceError('unavailable', 'Cannot reach the analysis service. Check the connection, HTTPS endpoint, and CORS settings. Your saved farm is still available.');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
