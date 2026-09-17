export class BaseAuth {
  createSession() {
    return "session";
  }
}

export class AuthService extends BaseAuth {
  login() {
    return this.createSession();
  }
}
