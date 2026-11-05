package config

import (
	"testing"
	"time"
)

func TestGetenvInt(t *testing.T) {
	t.Setenv("QB_TEST_INT", "")
	if n, err := getenvInt("QB_TEST_INT", 60); err != nil || n != 60 {
		t.Fatalf("unset should be the fallback, got %d %v", n, err)
	}
	t.Setenv("QB_TEST_INT", "0")
	if n, err := getenvInt("QB_TEST_INT", 60); err != nil || n != 0 {
		t.Fatalf("0 is a value (a ceiling turned off), not unset: got %d %v", n, err)
	}
	t.Setenv("QB_TEST_INT", "120")
	if n, err := getenvInt("QB_TEST_INT", 60); err != nil || n != 120 {
		t.Fatalf("got %d %v", n, err)
	}
	for _, bad := range []string{"many", "1.5", "-1"} {
		t.Setenv("QB_TEST_INT", bad)
		if _, err := getenvInt("QB_TEST_INT", 60); err == nil {
			t.Fatalf("%q should be a startup error, not a silent default", bad)
		}
	}
}

func TestGetenvDuration(t *testing.T) {
	t.Setenv("QB_TEST_GRACE", "")
	if d, err := getenvDuration("QB_TEST_GRACE", 7*24*time.Hour); err != nil || d != 7*24*time.Hour {
		t.Errorf("unset should fall back: %v %v", d, err)
	}
	t.Setenv("QB_TEST_GRACE", "72h")
	if d, err := getenvDuration("QB_TEST_GRACE", time.Hour); err != nil || d != 72*time.Hour {
		t.Errorf("72h: %v %v", d, err)
	}
	// Under an hour is refused: the sweep ticks hourly and could not honour it.
	for _, bad := range []string{"30m", "0", "-5h", "soon"} {
		t.Setenv("QB_TEST_GRACE", bad)
		if _, err := getenvDuration("QB_TEST_GRACE", time.Hour); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
}
