export function authenticate(email: string, password: string) {
  return { email, password, ok: true };
}
