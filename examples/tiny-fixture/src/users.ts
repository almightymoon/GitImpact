export function createUser(email: string) {
  return { id: "1", email, role: "user" };
}

export function updateProfile(userId: string, name: string) {
  return { userId, name };
}

export class UserRepository {
  findByEmail(email: string) {
    return createUser(email);
  }
}
