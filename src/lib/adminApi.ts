export async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result === 'object'
      && result !== null
      && 'error' in result
      && typeof result.error === 'string'
      ? result.error
      : `Admin request failed (${response.status}).`;
    throw new Error(message);
  }
  return result as T;
}
