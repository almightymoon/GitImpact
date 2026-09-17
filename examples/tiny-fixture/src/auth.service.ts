import { UserRepository, createUser } from "./users";

export class AuthService {
  private users = new UserRepository();

  register(email: string) {
    return createUser(email);
  }

  authenticate(email: string, password: string) {
    if (!email || !password) {
      throw new Error("missing credentials");
    }
    const user = this.users.findByEmail(email);
    return { token: "demo", email: user.email };
  }

  generateToken(email: string) {
    return { token: `tok-${email}` };
  }
}

export function register(email: string) {
  return new AuthService().register(email);
}

export function authenticate(email: string, password: string) {
  return new AuthService().authenticate(email, password);
}
