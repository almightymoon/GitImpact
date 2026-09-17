export function authenticate(email: string, password: string) {
  return { email, ok: Boolean(password) };
}
