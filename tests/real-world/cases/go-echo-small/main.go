package main

import (
	"net/http"

	"example.com/echo-small/handlers"
	"github.com/labstack/echo/v4"
)

func main() {
	e := echo.New()
	e.GET("/users", handlers.ListUsers)
	e.POST("/login", handlers.Login)
	_ = e.Start(":1323")
	_ = http.StatusOK
}
