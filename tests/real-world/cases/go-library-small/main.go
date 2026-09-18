package main

import (
	"fmt"

	"example.com/tokens/pkg/tokens"
)

func main() {
	t := tokens.Issue("u1")
	ok := tokens.Verify(t)
	fmt.Println(t, ok)
}
