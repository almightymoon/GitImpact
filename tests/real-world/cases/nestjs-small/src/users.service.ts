import { Injectable } from "./decorators";

@Injectable()
export class UsersService {
  findAll() {
    return this.findOne("1");
  }

  findOne(id: string) {
    return { id, name: "Ada" };
  }
}
