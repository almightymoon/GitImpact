export class TokenService {
  issue(user: string): string {
    return sign(user);
  }

  revoke(token: string): boolean {
    return token.length > 0;
  }
}

function sign(user: string): string {
  return `tok:${user}`;
}
