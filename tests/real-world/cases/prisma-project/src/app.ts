import { createUser, listUsers } from "./users.repo";

export async function register(email: string) {
  await createUser(email);
  return listUsers();
}
