import { authenticate, register } from "./auth.service";
import { updateProfile } from "./users";

export function loginHandler(email: string, password: string) {
  return authenticate(email, password);
}

export function signupHandler(email: string) {
  return register(email);
}

export function profileHandler(userId: string, name: string) {
  return updateProfile(userId, name);
}
