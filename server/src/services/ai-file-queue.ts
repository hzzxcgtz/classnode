const pending: Array<() => void> = [];
const configuredConcurrency = Number(process.env.CLASSNODE_REVIEW_CONCURRENCY ?? 8);
const concurrency = Number.isInteger(configuredConcurrency) && configuredConcurrency >= 1 && configuredConcurrency <= 32
  ? configuredConcurrency
  : 8;
let running = 0;

export async function runFileRequest<T>(job: () => Promise<T>): Promise<T> {
  if (running < concurrency) {
    running++;
  } else {
    await new Promise<void>(resolve => pending.push(resolve));
  }
  try {
    return await job();
  } finally {
    const next = pending.shift();
    if (next) next();
    else running--;
  }
}

const activeByToken = new Map<string, number>();

export function cozeTokenLoad(token: string): number {
  return activeByToken.get(token) ?? 0;
}

export async function trackCozeRequest<T>(token: string, job: () => Promise<T>): Promise<T> {
  activeByToken.set(token, cozeTokenLoad(token) + 1);
  try {
    return await job();
  } finally {
    const remaining = cozeTokenLoad(token) - 1;
    if (remaining) activeByToken.set(token, remaining);
    else activeByToken.delete(token);
  }
}

// Space upload starts independently for each token, including multi-file jobs.
const uploadSlots = new Map<string, Promise<void>>();
const uploadSpacingMs = 125;

export async function waitForCozeUploadSlot(token: string): Promise<void> {
  const previous = uploadSlots.get(token) ?? Promise.resolve();
  const next = previous.then(() => new Promise<void>(resolve => setTimeout(resolve, uploadSpacingMs)));
  uploadSlots.set(token, next);
  void next.then(() => {
    if (uploadSlots.get(token) === next) uploadSlots.delete(token);
  });
  await previous;
}

const activeFilesByToken = new Map<string, number>();
const pendingCozeFiles: Array<{ tokens: string[]; start: (token: string) => void }> = [];

function drainCozeFiles() {
  for (let index = 0; index < pendingCozeFiles.length;) {
    const request = pendingCozeFiles[index];
    const available = request.tokens.filter(token => (activeFilesByToken.get(token) ?? 0) < concurrency);
    if (!available.length) {
      index++;
      continue;
    }
    const token = available.reduce((best, candidate) =>
      cozeTokenLoad(candidate) < cozeTokenLoad(best) ? candidate : best);
    pendingCozeFiles.splice(index, 1);
    request.start(token);
  }
}

export function runCozeFileRequest<T>(tokens: string[], job: (token: string) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingCozeFiles.push({
      tokens,
      start(token) {
        activeFilesByToken.set(token, (activeFilesByToken.get(token) ?? 0) + 1);
        void trackCozeRequest(token, () => job(token)).then(resolve, reject).finally(() => {
          const remaining = activeFilesByToken.get(token)! - 1;
          if (remaining) activeFilesByToken.set(token, remaining);
          else activeFilesByToken.delete(token);
          drainCozeFiles();
        });
      },
    });
    drainCozeFiles();
  });
}
