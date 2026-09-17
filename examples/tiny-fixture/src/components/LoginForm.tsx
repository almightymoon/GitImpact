import { loginHandler } from "../auth.controller";

export function LoginForm() {
  return loginHandler("a@b.com", "secret");
}
