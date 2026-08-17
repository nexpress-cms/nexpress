const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);

export function isTransientGitHubError(error) {
  const status = error instanceof Error ? error.status : undefined;
  return TRANSIENT_STATUS_CODES.has(status);
}

export async function retryGitHubRequest(
  request,
  {
    attempts = 6,
    baseDelayMs = 1_000,
    maxDelayMs = 30_000,
    onRetry = () => {},
    sleep = defaultSleep,
  } = {},
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const status = error instanceof Error ? error.status : undefined;
      if (!isTransientGitHubError(error) || attempt === attempts) {
        throw error;
      }

      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      onRetry({ attempt, attempts, delayMs, status });
      await sleep(delayMs);
    }
  }

  throw new Error("GitHub request retry exhausted unexpectedly.");
}

export async function retryGitHubStatusWrite(write, options) {
  return retryGitHubRequest(write, options);
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
