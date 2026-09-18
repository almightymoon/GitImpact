package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

func ListUsers(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"ok": "true"})
}

func Login(c echo.Context) error {
	token := IssueToken("user-1")
	return c.JSON(http.StatusOK, map[string]string{"token": token})
}

func IssueToken(userID string) string {
	return "token-" + userID
}
