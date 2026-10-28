package api

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

func NewEngine(addr string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	// r.Use()
	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
		})
	})
	return r
}

func StartServer(r *gin.Engine) {
	if r == nil {
		r = NewEngine(":8080")
	}
	go func() {
		if err := r.Run(); err != nil {
			log.Fatalf("failed to run server: %v", err)
		}
	}()
}

// func StartServer(addr string) {
// }
