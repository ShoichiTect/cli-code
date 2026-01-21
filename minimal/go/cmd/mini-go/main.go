package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"

	"minimal-go/internal/core"
)

func main() {
	loadDotEnv(filepath.Join(".", ".env"))

	debug := false
	for _, arg := range os.Args[1:] {
		if arg == "-d" || arg == "--debug" {
			debug = true
			break
		}
	}

	if err := core.Main(core.MainOptions{Debug: debug}); err != nil {
		os.Exit(1)
	}
}

func loadDotEnv(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
}
