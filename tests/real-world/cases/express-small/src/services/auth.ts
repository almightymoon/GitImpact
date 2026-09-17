export async function verifyToken(token: string): Promise<boolean> {
  return token.startsWith("Bearer ");
}

export async function issueToken(userId: string): Promise<string> {
  return `Bearer ${userId}`;
}
