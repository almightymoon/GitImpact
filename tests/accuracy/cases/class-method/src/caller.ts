import { AuthService } from "./auth.service";

export function login() {
  return new AuthService().authenticate();
}
