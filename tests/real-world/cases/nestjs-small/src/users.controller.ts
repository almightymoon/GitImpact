import { Controller, Get, Post } from "./decorators";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.findAll();
  }

  @Post()
  create() {
    return this.users.findOne("new");
  }
}
