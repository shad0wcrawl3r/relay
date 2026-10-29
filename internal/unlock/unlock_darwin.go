//go:build darwin

package unlock

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework LocalAuthentication -framework Foundation
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <stdlib.h>

// 0 none, 1 Touch ID, 2 Face ID, 3 Optic ID
static int relay_biometry(void) {
	LAContext *ctx = [[LAContext alloc] init];
	if (![ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:nil]) return 0;
	switch (ctx.biometryType) {
	case LABiometryTypeTouchID: return 1;
	case LABiometryTypeFaceID: return 2;
	default: return 3;
	}
}

static int relay_can_authenticate(void) {
	LAContext *ctx = [[LAContext alloc] init];
	return [ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil] ? 1 : 0;
}

// Device-owner authentication: biometrics when enrolled, with the login
// password as the fallback (and the only option without biometrics).
// Returns 0 on success, 1 when cancelled, 2 on failure (message in *msg).
static int relay_authenticate(const char *reason, char **msg) {
	__block int result = 2;
	__block NSString *text = nil;
	dispatch_semaphore_t done = dispatch_semaphore_create(0);
	LAContext *ctx = [[LAContext alloc] init];
	ctx.localizedFallbackTitle = @"Use Password";
	[ctx evaluatePolicy:LAPolicyDeviceOwnerAuthentication
	    localizedReason:[NSString stringWithUTF8String:reason]
	              reply:^(BOOL ok, NSError *error) {
		if (ok) {
			result = 0;
		} else if (error.code == LAErrorUserCancel || error.code == LAErrorAppCancel || error.code == LAErrorSystemCancel) {
			result = 1;
		} else {
			text = error.localizedDescription;
		}
		dispatch_semaphore_signal(done);
	}];
	dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
	if (text) *msg = strdup(text.UTF8String);
	return result;
}
*/
import "C"

import (
	"errors"
	"unsafe"
)

func Available() Method {
	if C.relay_can_authenticate() == 0 {
		return Method{}
	}
	switch C.relay_biometry() {
	case 1:
		return Method{Available: true, Biometry: "touchid", Label: "Unlock with Touch ID"}
	case 2:
		return Method{Available: true, Biometry: "faceid", Label: "Unlock with Face ID"}
	case 3:
		return Method{Available: true, Biometry: "opticid", Label: "Unlock with Optic ID"}
	}
	return Method{Available: true, Label: "Unlock with password"}
}

// Authenticate blocks until the user confirms or cancels. Reason completes
// the system prompt's "Relay is trying to …".
func Authenticate(reason string) error {
	cr := C.CString(reason)
	defer C.free(unsafe.Pointer(cr))
	var msg *C.char
	switch C.relay_authenticate(cr, &msg) {
	case 0:
		return nil
	case 1:
		return ErrCancelled
	}
	if msg != nil {
		defer C.free(unsafe.Pointer(msg))
		return errors.New(C.GoString(msg))
	}
	return errors.New("authentication failed")
}
