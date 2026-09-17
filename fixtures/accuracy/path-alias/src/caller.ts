import { AuthService } from "@/services/auth";

export function caller() {
  return new AuthService().login();
}
