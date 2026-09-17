import { JwtIssuer, issueWith } from "./tokens";

export function caller() {
  return issueWith(new JwtIssuer());
}
