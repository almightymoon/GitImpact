export default class {
  login(user: string) {
    return this.hash(user);
  }

  hash(value: string) {
    return `hashed:${value}`;
  }
}
