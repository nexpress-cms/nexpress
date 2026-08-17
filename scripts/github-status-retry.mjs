const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);

export async function retryGitHubStatusWrite(
  write,
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
      return await write();
    } catch (error) {
      const status = error instanceof Error ? error.status : undefined;
      if (!TRANSIENT_STATUS_CODES.has(status) || attempt === attempts) {
        throw error;
      }

      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      onRetry({ attempt, attempts, delayMs, status });
      await sleep(delayMs);
    }
  }

  throw new Error("GitHub status retry exhausted unexpectedly.");
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
