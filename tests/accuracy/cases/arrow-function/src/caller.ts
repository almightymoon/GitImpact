import { login } from "./auth";

export function handleLogin(user: string) {
  return login(user);
}
