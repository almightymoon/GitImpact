export class TokenService {
  issue(user: string, ttl: number): string {
    audit(user);
    return sign(user);
  }
}

function sign(user: string): string {
  return `tok:${user}`;
}

function audit(user: string): void {
  void user;
}
