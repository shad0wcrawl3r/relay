package main

import (
	"math"
	"testing"
)

func TestClampZoom(t *testing.T) {
	for in, want := range map[float64]float64{0: 1, -1: 1, 0.1: 0.5, 1: 1, 1.1: 1.1, 1.249999: 1.25, 5: 2} {
		if got := clampZoom(in); got != want {
			t.Errorf("clampZoom(%v) = %v, want %v", in, got, want)
		}
	}
	if got := clampZoom(math.NaN()); got != 1 {
		t.Errorf("clampZoom(NaN) = %v", got)
	}
}
