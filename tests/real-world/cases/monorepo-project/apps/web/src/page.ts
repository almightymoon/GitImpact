import { queryUsers } from "@acme/db";
import { Button } from "@acme/ui";

export function HomePage() {
  const users = queryUsers();
  return Button(`Users: ${users.length}`);
}

export async function lazyHome() {
  const { queryUsers: q } = await import("@acme/db");
  return q();
}
