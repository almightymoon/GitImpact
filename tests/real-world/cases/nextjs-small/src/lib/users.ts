export async function findUser(id: string) {
  return { id, name: "Ada" };
}

export async function listUsers() {
  return [await findUser("1")];
}
