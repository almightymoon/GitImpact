import { createUser } from "./users";

export function register(email: string) {
  return createUser(email);
}

export function authenticate(email: string, password: string) {
  if (!email || !password) {
    throw new Error("missing credentials");
  }
  return { token: "demo", email };
}
