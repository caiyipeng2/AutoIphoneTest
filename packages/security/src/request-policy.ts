export function assertAllowedHost(host: string | undefined, port: number): void {
  const allowed = new Set([`127.0.0.1:${String(port)}`, `[::1]:${String(port)}`]);
  if (host === undefined || !allowed.has(host)) {
    throw new TypeError("Host is not an allowed loopback address.");
  }
}

export function assertSameOrigin(origin: string | undefined, port: number): void {
  const allowed = new Set([`http://127.0.0.1:${String(port)}`, `http://[::1]:${String(port)}`]);
  if (origin === undefined || !allowed.has(origin)) {
    throw new TypeError("Origin is not the launcher console origin.");
  }
}

export function assertValidCsrf(
  cookieToken: string | undefined,
  headerToken: string | undefined,
): void {
  if (cookieToken === undefined || headerToken === undefined || cookieToken !== headerToken) {
    throw new TypeError("CSRF token is missing or invalid.");
  }
}
