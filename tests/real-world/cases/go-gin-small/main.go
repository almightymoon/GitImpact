package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()
	r.POST("/orders", createOrder)
	r.GET("/orders/:id", getOrder)
	_ = r.Run(":8080")
	_ = http.StatusOK
}

func createOrder(c *gin.Context) {
	c.JSON(http.StatusCreated, gin.H{"id": "1"})
}

func getOrder(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id")})
}
