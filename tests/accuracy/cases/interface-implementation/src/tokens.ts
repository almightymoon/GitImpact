export interface TokenIssuer {
  issue(): string;
}

export class JwtIssuer implements TokenIssuer {
  issue() {
    return "jwt";
  }
}

export function issueWith(issuer: TokenIssuer) {
  return issuer.issue();
}
