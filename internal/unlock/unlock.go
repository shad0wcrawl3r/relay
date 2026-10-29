// Package unlock asks the OS to confirm the device owner before Relay shows
// locked projects: Touch ID (or Face ID) when available, the login password
// otherwise.
package unlock

import "errors"

var (
	ErrCancelled   = errors.New("unlock cancelled")
	ErrUnsupported = errors.New("unlocking isn't supported on this system yet")
)

// Method describes how Authenticate will verify the user.
type Method struct {
	Available bool   `json:"available"`
	Biometry  string `json:"biometry"` // "touchid", "faceid", "opticid" or ""
	Label     string `json:"label"`    // e.g. "Unlock with Touch ID"
}
