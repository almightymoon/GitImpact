import Auth from "./auth";

export function handleLogin(user: string) {
  return new Auth().login(user);
}
