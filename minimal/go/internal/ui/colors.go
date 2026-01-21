package ui

import "fmt"

const (
	colorReset   = "\033[0m"
	colorBold    = "\033[1m"
	colorRed     = "\033[31m"
	colorGreen   = "\033[32m"
	colorYellow  = "\033[33m"
	colorMagenta = "\033[35m"
	colorCyan    = "\033[36m"
	colorGray    = "\033[90m"
)

func Red(text string) string {
	return colorRed + text + colorReset
}

func Green(text string) string {
	return colorGreen + text + colorReset
}

func Yellow(text string) string {
	return colorYellow + text + colorReset
}

func Magenta(text string) string {
	return colorMagenta + text + colorReset
}

func Cyan(text string) string {
	return colorCyan + text + colorReset
}

func Gray(text string) string {
	return colorGray + text + colorReset
}

func Bold(text string) string {
	return colorBold + text + colorReset
}

func BoldCyan(text string) string {
	return fmt.Sprintf("%s%s%s", colorBold+colorCyan, text, colorReset)
}
