export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, { credentials: 'include', ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers } });
  } catch { throw new ApiError('Cannot reach the server. Check your connection and retry.', 0); }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.message ?? 'The server is unavailable. Please retry.', response.status);
  return data as T;
}
