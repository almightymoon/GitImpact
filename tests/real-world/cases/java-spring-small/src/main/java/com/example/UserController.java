package com.example;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserController {
  private final TokenService tokens = new TokenService();

  @GetMapping("/users")
  public String listUsers() {
    return tokens.issue();
  }
}
