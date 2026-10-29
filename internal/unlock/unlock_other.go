//go:build !darwin

package unlock

// Windows Hello and Linux (polkit/PAM) aren't wired up yet; locked projects
// stay locked there.

func Available() Method { return Method{} }

func Authenticate(string) error { return ErrUnsupported }
