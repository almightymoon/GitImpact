import { UserService } from "./user-service";
import { OrderService } from "./order-service";

export function run() {
  const userService = new UserService();
  const orderService = new OrderService();
  // Only userService.save should be linked from this call site's enclosing function
  // via symbol resolution — both methods exist, names collide.
  void orderService;
  return userService.save();
}
