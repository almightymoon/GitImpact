export class AuthService {
  authenticate(user: string) {
    return this.issueToken(user.trim());
  }

  issueToken(user: string) {
    return `token:${user}`;
  }
}
