import { authenticate, register, AuthService } from "./auth.service";
import { updateProfile } from "./users";

export class AuthController {
  private auth = new AuthService();

  loginHandler(email: string, password: string) {
    return this.auth.authenticate(email, password);
  }

  signupHandler(email: string) {
    return register(email);
  }

  profileHandler(userId: string, name: string) {
    return updateProfile(userId, name);
  }

  tokenHandler(email: string) {
    return this.auth.generateToken(email);
  }
}

export function loginHandler(email: string, password: string) {
  return authenticate(email, password);
}

export function signupHandler(email: string) {
  return register(email);
}

export function profileHandler(userId: string, name: string) {
  return updateProfile(userId, name);
}
