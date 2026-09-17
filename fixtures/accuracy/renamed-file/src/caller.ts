import { AuthService } from "./auth.service";

export function login(user: string) {
  return new AuthService().authenticate(user);
}
