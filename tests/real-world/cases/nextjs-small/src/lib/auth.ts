export async function hashPassword(password: string): Promise<string> {
  return `hashed:${password}`;
}

export async function verifySession(token: string): Promise<boolean> {
  return token.length > 10;
}
