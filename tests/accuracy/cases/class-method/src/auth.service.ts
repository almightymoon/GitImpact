export class AuthService {
  authenticate() {
    return this.issueToken();
  }

  issueToken() {
    return "token";
  }
}
