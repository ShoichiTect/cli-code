package policy

import (
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"minimal-go/internal/config"
)

type PolicyResult string

const (
	PolicyAuto PolicyResult = "auto"
	PolicyAsk  PolicyResult = "ask"
	PolicyDeny PolicyResult = "deny"
)

const bashTimeout = 30 * time.Second

var (
	dangerousFilePatterns = []*regexp.Regexp{
		regexp.MustCompile(`\.env$`),
		regexp.MustCompile(`\.env\.`),
		regexp.MustCompile(`\.dev\.vars$`),
		regexp.MustCompile(`credentials`),
		regexp.MustCompile(`secret`),
		regexp.MustCompile(`\.pem$`),
		regexp.MustCompile(`\.key$`),
		regexp.MustCompile(`id_rsa`),
		regexp.MustCompile(`id_ed25519`),
		regexp.MustCompile(`package-lock\.json$`),
		regexp.MustCompile(`yarn\.lock$`),
		regexp.MustCompile(`pnpm-lock\.yaml$`),
		regexp.MustCompile(`\.DS_Store$`),
		regexp.MustCompile(`node_modules`),
	}
	builtinDenyPatterns = []*regexp.Regexp{
		regexp.MustCompile(`rm\s+(-[rf]+\s+)*\/`),
		regexp.MustCompile(`rm\s+-rf?\s+\*`),
		regexp.MustCompile(`rm\s+-rf?\s+\.\*`),
		regexp.MustCompile(`mkfs`),
		regexp.MustCompile(`dd\s+if=.*of=\/dev`),
		regexp.MustCompile(`>\s*\/dev\/sd`),
		regexp.MustCompile(`gcloud\s+.*delete`),
		regexp.MustCompile(`gcloud\s+.*destroy`),
		regexp.MustCompile(`aws\s+.*delete`),
		regexp.MustCompile(`aws\s+.*terminate`),
		regexp.MustCompile(`kubectl\s+delete`),
		regexp.MustCompile(`:\(\)\s*\{.*\|.*&.*\}`),
		regexp.MustCompile(`chmod\s+-R\s+777\s+\/`),
		regexp.MustCompile(`chown\s+-R.*\/`),
		regexp.MustCompile(`curl.*\|\s*(ba)?sh`),
		regexp.MustCompile(`wget.*\|\s*(ba)?sh`),
		regexp.MustCompile(`ls\s+-[^\s]*R`),
		regexp.MustCompile(`ls\s+-R`),
		regexp.MustCompile(`sed\s.*-i`),
	}
	builtinAutoCommands = []string{
		"ls",
		"ls -la",
		"ls -l",
		"ls -a",
		"pwd",
		"whoami",
		"date",
		"which",
		"cat",
		"head",
		"tail",
		"less",
		"more",
		"wc",
		"file",
		"stat",
		"tree",
		"find",
		"fd",
		"grep",
		"rg",
		"sed -n",
		"git status",
		"git diff",
		"git log",
		"git branch",
	}
	forceAskPattern = regexp.MustCompile("[|;&`$()]")
)

func CheckPolicy(command string, cfg config.Config) PolicyResult {
	cmd := strings.TrimSpace(command)
	denyPatterns := append([]*regexp.Regexp{}, builtinDenyPatterns...)
	for _, pattern := range cfg.Policy.DenyPatterns {
		if pattern == "" {
			continue
		}
		if re, err := regexp.Compile(pattern); err == nil {
			denyPatterns = append(denyPatterns, re)
		}
	}

	autoCommands := append([]string{}, builtinAutoCommands...)
	autoCommands = append(autoCommands, cfg.Policy.AutoCommands...)

	for _, pattern := range denyPatterns {
		if pattern.MatchString(cmd) {
			return PolicyDeny
		}
	}

	fields := strings.Fields(cmd)
	args := ""
	if len(fields) > 1 {
		args = strings.Join(fields[1:], " ")
	}
	for _, pattern := range dangerousFilePatterns {
		if pattern.MatchString(args) {
			return PolicyDeny
		}
	}

	if forceAskPattern.MatchString(cmd) {
		return PolicyAsk
	}

	for _, autoCmd := range autoCommands {
		if cmd == autoCmd || strings.HasPrefix(cmd, autoCmd+" ") {
			return PolicyAuto
		}
	}

	if cfg.Policy.DefaultAction == "deny" {
		return PolicyDeny
	}
	return PolicyAsk
}

type BashResult struct {
	Stdout string
	Stderr string
	Code   int
}

func FormatCommandResult(command string, result BashResult) string {
	content := "[command] " + command
	if strings.TrimSpace(result.Stdout) != "" {
		content += "\n[stdout]\n" + strings.TrimRight(result.Stdout, "\n")
	}
	if strings.TrimSpace(result.Stderr) != "" {
		content += "\n[stderr]\n" + strings.TrimRight(result.Stderr, "\n")
	}
	if result.Code != 0 {
		content += "\n[exit_code] " + strconv.Itoa(result.Code)
	}
	return content
}

func RunBash(command string, workspaceRoot string) BashResult {
	ctx, cancel := context.WithTimeout(context.Background(), bashTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "bash", "-c", command)
	cmd.Dir = workspaceRoot
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return BashResult{Stdout: stdout.String(), Stderr: "Command timed out (30s)", Code: 124}
	}

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	return BashResult{Stdout: stdout.String(), Stderr: stderr.String(), Code: exitCode}
}
