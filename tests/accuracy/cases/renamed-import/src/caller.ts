import { foo as renamedFoo } from "./foo";

export function caller() {
  return renamedFoo();
}
