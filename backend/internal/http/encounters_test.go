package http

import (
	"strings"
	"testing"
)

// The library's session tag is hand-typed, so it is trimmed and bounded before
// it ever reaches the shelf labels.
func TestFilingTag(t *testing.T) {
	tag, msg := filingTag(nil)
	if tag != "" || msg != "" {
		t.Fatalf("absent tag = (%q, %q), want empty and accepted", tag, msg)
	}

	spaced := "  Session 12  "
	if tag, msg = filingTag(&spaced); tag != "Session 12" || msg != "" {
		t.Fatalf("filingTag(%q) = (%q, %q), want trimmed and accepted", spaced, tag, msg)
	}

	blank := "   "
	if tag, msg = filingTag(&blank); tag != "" || msg != "" {
		t.Fatalf("blank tag = (%q, %q), want empty and accepted — that is how a tag is cleared", tag, msg)
	}

	atCap := strings.Repeat("x", maxFilingTag)
	if tag, msg = filingTag(&atCap); tag != atCap || msg != "" {
		t.Fatalf("a %d-character tag was refused: %q", maxFilingTag, msg)
	}

	tooLong := strings.Repeat("x", maxFilingTag+1)
	if tag, msg = filingTag(&tooLong); msg == "" {
		t.Fatalf("a %d-character tag was accepted as %q, want refusal", maxFilingTag+1, tag)
	}
}
