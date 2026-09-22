import { fetchWithTimeout } from '../../src/services/routing';

describe('fetchWithTimeout', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('devuelve la respuesta si OSRM contesta a tiempo', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 }));

    const response = await fetchWithTimeout('https://osrm.example/route', {
      headers: { Accept: 'application/json' },
    }, 1000);

    expect(response.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('corta el request colgado para no trabar el recálculo de ruta', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const pending = fetchWithTimeout('https://osrm.example/route', {}, 800);
    const expectation = expect(pending).rejects.toThrow('Tiempo de espera de ruta agotado');
    await jest.advanceTimersByTimeAsync(800);
    await expectation;
  });
});
