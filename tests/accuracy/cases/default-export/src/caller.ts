import AuthService from "./auth";

export function caller() {
  return new AuthService().login();
}
