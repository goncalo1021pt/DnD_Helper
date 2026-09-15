package config

import "testing"

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
