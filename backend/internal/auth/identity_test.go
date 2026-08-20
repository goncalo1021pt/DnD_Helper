package auth

import "testing"

// One person, one account, however many doors (#269). The rules that can be
// stated without a database: how a refusal is worded, and that it names a door
// rather than leaving somebody stranded at the wrong one.

func TestATakenAddressNamesTheDoorToUseInstead(t *testing.T) {
	if got := emailTakenMessage("google"); got != "That email already signs in with Google — use that button instead." {
		t.Fatalf("a provider's address should point at that provider, got %q", got)
	}
	if got := emailTakenMessage("discord"); got != "That email already signs in with Discord — use that button instead." {
		t.Fatalf("the provider's name should be capitalised for the sentence, got %q", got)
	}
	if got := emailTakenMessage("local"); got != "That email already has an account here — sign in with your password instead." {
		t.Fatalf("a password account should point at the password, got %q", got)
	}
}

// When the holder cannot be read, the message falls back to the words this
// used to say — unhelpful, but never wrong, and never a blank refusal.
func TestAnUnreadableHolderStillGetsAnAnswer(t *testing.T) {
	if got := emailTakenMessage(""); got != "An account with that email already exists." {
		t.Fatalf("an unknown holder should still be refused in words, got %q", got)
	}
}

func TestTitleCaseLeavesNothingBehind(t *testing.T) {
	for in, want := range map[string]string{
		"google":  "Google",
		"discord": "Discord",
		"g":       "G",
		"":        "",
		"Ærial":   "Ærial",
	} {
		if got := titleCase(in); got != want {
			t.Fatalf("titleCase(%q) = %q, want %q", in, got, want)
		}
	}
}

// nilOrBlank decides whether an account is missing an address and may adopt the
// one a provider vouches for. A column holding "" or spaces is missing one just
// as much as a NULL is — the database's partial index takes the same view.
func TestAnAddressOfBlanksIsNoAddress(t *testing.T) {
	blank := ""
	spaces := "   "
	real := "someone@example.com"

	if !nilOrBlank(nil) {
		t.Fatal("no column at all is no address")
	}
	if !nilOrBlank(&blank) || !nilOrBlank(&spaces) {
		t.Fatal("an empty or whitespace address is no address")
	}
	if nilOrBlank(&real) {
		t.Fatal("a real address must not be treated as missing, or it would be overwritten")
	}
}
