package term

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestShellArgs(t *testing.T) {
	cases := map[string][]string{
		"/bin/zsh":                               {"-l"},
		"/usr/bin/fish":                          {"-l"},
		`C:\Program Files\Git\bin\bash.exe`:      {"-l"},
		`C:\Program Files\PowerShell\7\pwsh.exe`: {"-NoLogo"},
		`C:\Windows\System32\cmd.exe`:            nil,
		`C:\Windows\System32\wsl.exe`:            nil,
	}
	for path, want := range cases {
		if got := shellArgs(path); !slices.Equal(got, want) {
			t.Errorf("shellArgs(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestShellsDefaultFirst(t *testing.T) {
	shells := Shells()
	if len(shells) == 0 {
		t.Skip("no shells found")
	}
	for i, s := range shells {
		if s.Default != (i == 0) && s.Default {
			t.Fatalf("default shell %v isn't first", s)
		}
		if !Usable(s.Path) {
			t.Fatalf("listed shell %v doesn't exist", s)
		}
	}
}

func TestUsable(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "sh")
	if err := os.WriteFile(f, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	if !Usable(f) || Usable(dir) || Usable("") || Usable(filepath.Join(dir, "missing")) {
		t.Fatal("Usable is wrong")
	}
}
