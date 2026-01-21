package core

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"

	"minimal-go/internal/config"
	"minimal-go/internal/policy"
	"minimal-go/internal/ui"
)

type MainOptions struct {
	Debug bool
}

func Main(options MainOptions) error {
	debug := options.Debug
	debugLog := func(label string, data interface{}) {
		if !debug {
			return
		}
		fmt.Println(ui.Magenta("[DEBUG] " + label))
		if data != nil {
			payload, _ := json.MarshalIndent(data, "", "  ")
			fmt.Println(ui.Magenta(string(payload)))
		}
	}

	if err := config.EnsureMinimalDir(); err != nil {
		printError("~/.minimal directory not found.")
		fmt.Println(ui.Gray("Run the following to initialize:"))
		fmt.Println(ui.Gray("  mkdir -p ~/.minimal/skills"))
		fmt.Println(ui.Gray("  echo \"You are a helpful coding assistant.\" > ~/.minimal/system.md"))
		return err
	}

	cfg, err := config.LoadConfig()
	if err != nil {
		printError(err.Error())
		return err
	}

	systemPrompt, err := config.LoadSystemPrompt()
	if err != nil {
		printError("~/.minimal/system.md not found or empty.")
		fmt.Println(ui.Gray("Run: mkdir -p ~/.minimal && touch ~/.minimal/system.md"))
		return err
	}

	workspaceRoot := os.Getenv("WORKSPACE_ROOT")
	if workspaceRoot == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return err
		}
		workspaceRoot = cwd
	}
	workspaceRoot, _ = filepath.Abs(workspaceRoot)

	reader := bufio.NewReader(os.Stdin)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)

	promptApproval := func(command string) (bool, error) {
		fmt.Println("")
		fmt.Println(ui.Yellow("Command:"))
		fmt.Println(ui.Bold("  " + command))
		fmt.Println("")
		fmt.Println(ui.Gray("  [enter/y] Run"))
		fmt.Println(ui.Gray("  [n]       Reject"))
		fmt.Println(ui.Gray("  [ctrl+c]  Cancel"))
		fmt.Println("")

		line, cancelled, err := readLine(reader, ui.Cyan("> "), sigCh, true)
		if err != nil {
			return false, err
		}
		if cancelled {
			fmt.Println(ui.Yellow("\n✗ Cancelled"))
			return false, nil
		}

		answer := strings.ToLower(strings.TrimSpace(line))
		if answer == "" || answer == "y" {
			printSuccess("✓ Running...")
			return true, nil
		}
		fmt.Println(ui.Yellow("✗ Rejected"))
		return false, nil
	}

	agent, err := CreateAgent(AgentOptions{
		Config:        cfg,
		SystemPrompt:  systemPrompt,
		WorkspaceRoot: workspaceRoot,
		Debug:         debug,
		Callbacks: AgentCallbacks{
			PromptApproval: promptApproval,
			OnAutoApproved: printAutoApproved,
			OnDenied:       printDenied,
			OnDebugLog:     debugLog,
		},
	})
	if err != nil {
		printError(err.Error())
		return err
	}

	fmt.Println(ui.Bold("Minimal Agent") + ui.Gray(fmt.Sprintf(" (%s)", agent.GetModel())))
	if debug {
		fmt.Println(ui.Magenta("[DEBUG MODE ENABLED]"))
	}
	fmt.Println(ui.Gray("Type /help for commands, /exit to quit."))
	fmt.Println("")

	bufferedShellOutput := ""

	for {
		tokens := agent.GetTokens()
		if tokens.Total > 0 {
			fmt.Println(ui.Gray(fmt.Sprintf("[session] %d tokens", tokens.Total)))
		}

		line, cancelled, err := readLine(reader, ui.Cyan("> "), sigCh, false)
		if err != nil {
			return err
		}
		if cancelled {
			return nil
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "!") {
			command := strings.TrimSpace(strings.TrimPrefix(line, "!"))
			if command == "" {
				continue
			}
			result := policy.RunBash(command, workspaceRoot)
			if strings.TrimSpace(result.Stdout) != "" {
				fmt.Println(strings.TrimRight(result.Stdout, "\n"))
			}
			if strings.TrimSpace(result.Stderr) != "" {
				if result.Code != 0 {
					fmt.Println(ui.Red(strings.TrimRight(result.Stderr, "\n")))
				} else {
					fmt.Println(strings.TrimRight(result.Stderr, "\n"))
				}
			}

			formatted := policy.FormatCommandResult(command, result)
			if bufferedShellOutput == "" {
				bufferedShellOutput = formatted
			} else {
				bufferedShellOutput += "\n\n" + formatted
			}
			continue
		}

		if strings.HasPrefix(line, "/") {
			shouldContinue, err := handleSlashCommand(line, reader, agent, &bufferedShellOutput)
			if err != nil {
				printError(err.Error())
				continue
			}
			if !shouldContinue {
				break
			}
			continue
		}

		userContent := line
		if bufferedShellOutput != "" {
			userContent = bufferedShellOutput + "\n\n" + line
			bufferedShellOutput = ""
		}
		agent.AddUserMessage(userContent)

		if err := agent.RunAgentTurn(); err != nil {
			printError(err.Error())
		}
	}

	return nil
}

func handleSlashCommand(line string, reader *bufio.Reader, agent Agent, bufferedShellOutput *string) (bool, error) {
	parts := strings.Fields(strings.TrimPrefix(line, "/"))
	if len(parts) == 0 {
		return true, nil
	}

	cmd := parts[0]
	args := strings.Join(parts[1:], " ")

	switch cmd {
	case "exit", "quit":
		return false, nil
	case "clear", "new":
		agent.Clear()
		*bufferedShellOutput = ""
		printSuccess("✓ Conversation cleared.")
		return true, nil
	case "help":
		printHelp()
		return true, nil
	case "skill":
		if args == "" {
			printSkillList(listSkills())
			return true, nil
		}
		skillContent, err := loadSkill(args)
		if err != nil {
			printError(fmt.Sprintf("Skill not found: %s", args))
			printSkillList(listSkills())
			return true, nil
		}

		printSkillLoaded(args, skillContent)
		fmt.Print(ui.Gray("Additional input (optional): "))
		additional, _ := reader.ReadString('\n')
		additional = strings.TrimSpace(additional)

		baseContent := skillContent
		if additional != "" {
			baseContent = baseContent + "\n\n" + additional
		}

		userContent := baseContent
		if *bufferedShellOutput != "" {
			userContent = *bufferedShellOutput + "\n\n" + baseContent
			*bufferedShellOutput = ""
		}

		agent.AddUserMessage(userContent)
		if err := agent.RunAgentTurn(); err != nil {
			printError(err.Error())
		}
		return true, nil
	default:
		printError(fmt.Sprintf("Unknown command: /%s", cmd))
		printHelp()
		return true, nil
	}
}

func readLine(reader *bufio.Reader, prompt string, sigCh <-chan os.Signal, allowCancel bool) (string, bool, error) {
	fmt.Print(prompt)

	lineCh := make(chan string, 1)
	errCh := make(chan error, 1)

	go func() {
		text, err := reader.ReadString('\n')
		if err != nil {
			errCh <- err
			return
		}
		lineCh <- text
	}()

	select {
	case sig := <-sigCh:
		_ = sig
		if allowCancel {
			return "", true, nil
		}
		return "", true, nil
	case err := <-errCh:
		if errors.Is(err, os.ErrClosed) {
			return "", true, nil
		}
		return "", false, err
	case line := <-lineCh:
		return line, false, nil
	}
}

func listSkills() []string {
	entries, err := os.ReadDir(config.SkillsDir)
	if err != nil {
		return nil
	}
	var skills []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasSuffix(name, ".md") {
			skills = append(skills, strings.TrimSuffix(name, ".md"))
		}
	}
	return skills
}

func loadSkill(name string) (string, error) {
	path := filepath.Join(config.SkillsDir, name+".md")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func printHelp() {
	fmt.Println("")
	fmt.Println(ui.Bold("Commands:"))
	fmt.Println(ui.Cyan("  /skill <name>") + ui.Gray("   Load skill from ~/.minimal/skills/"))
	fmt.Println(ui.Cyan("  /clear, /new") + ui.Gray("    Reset conversation"))
	fmt.Println(ui.Cyan("  /help") + ui.Gray("           Show this help"))
	fmt.Println(ui.Cyan("  /exit, /quit") + ui.Gray("    Exit"))
	fmt.Println("")
	fmt.Println(ui.Cyan("  !<command>") + ui.Gray("      Execute shell command directly"))
	fmt.Println("")
}

func printSkillList(skills []string) {
	fmt.Println("")
	fmt.Println(ui.Bold("Available skills:"))
	if len(skills) == 0 {
		fmt.Println(ui.Gray("  (none)"))
	} else {
		for i, skill := range skills {
			fmt.Println(ui.Cyan(fmt.Sprintf("  %d.", i+1)) + " " + skill)
		}
	}
	fmt.Println(ui.Gray("\nUsage: /skill <name>"))
	fmt.Println("")
}

func printSkillLoaded(name string, content string) {
	fmt.Println(ui.Green(fmt.Sprintf("✓ Loaded: %s", name)))
	fmt.Println(ui.Gray(strings.Repeat("─", 40)))
	preview := content
	if len(preview) > 200 {
		preview = preview[:200] + "..."
	}
	fmt.Println(ui.Gray(preview))
	fmt.Println(ui.Gray(strings.Repeat("─", 40)))
}

func printDenied(command string) {
	fmt.Println("")
	fmt.Println(ui.Bold(ui.Red("✗ Denied by policy:")))
	fmt.Println(ui.Gray("  " + command))
	fmt.Println("")
}

func printAutoApproved(command string) {
	fmt.Println(ui.Green("✓ " + command))
}

func printError(msg string) {
	fmt.Println(ui.Red("Error: " + msg))
}

func printSuccess(msg string) {
	fmt.Println(ui.Green(msg))
}
