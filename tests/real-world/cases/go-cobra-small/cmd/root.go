package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "app",
	Short: "demo cobra app",
}

var serverCmd = &cobra.Command{
	Use:   "server",
	Short: "run server",
	Run: func(cmd *cobra.Command, args []string) {
		StartServer()
	},
}

func init() {
	rootCmd.AddCommand(serverCmd)
}

func Execute() {
	_ = rootCmd.Execute()
}

func StartServer() {
	fmt.Println("listening")
}
