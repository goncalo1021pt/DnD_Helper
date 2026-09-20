// Package mail sends the transactional emails — address verification,
// password recovery, the account tripwires, and the notices of #316 —
// through Resend. When no API key is configured (local development) it falls
// back to logging the message and its link, so the flows are fully testable
// without a real mail provider.
package mail

import (
	"context"
	"fmt"
	"html"
	"log"
	"sort"
	"strings"

	"github.com/resend/resend-go/v3"
)

// Message is one email: who, what, and the headers a notice carries
// (List-Unsubscribe), which the transactional ones do not.
type Message struct {
	To      string
	Subject string
	HTML    string
	Text    string
	Headers map[string]string
}

// Mailer sends one email. Implementations must be safe for concurrent use.
type Mailer interface {
	Send(ctx context.Context, m Message) error
}

// New returns a Resend-backed mailer when apiKey is set, or a logging mailer
// (dev fallback) otherwise. from is the "From" header, e.g.
// "Quest Board <no-reply@fontao.net>".
func New(apiKey, from string) Mailer {
	if apiKey == "" {
		log.Println("mail: RESEND_API_KEY not set — emails will be logged, not sent")
		return &logMailer{}
	}
	return &resendMailer{client: resend.NewClient(apiKey), from: from}
}

type resendMailer struct {
	client *resend.Client
	from   string
}

func (m *resendMailer) Send(ctx context.Context, msg Message) error {
	_, err := m.client.Emails.SendWithContext(ctx, &resend.SendEmailRequest{
		From:    m.from,
		To:      []string{msg.To},
		Subject: msg.Subject,
		Html:    msg.HTML,
		Text:    msg.Text,
		Headers: msg.Headers,
	})
	return err
}

// logMailer prints what would have been sent — enough to follow a link during
// local development.
type logMailer struct{}

func (m *logMailer) Send(_ context.Context, msg Message) error {
	var hdr strings.Builder
	keys := make([]string, 0, len(msg.Headers))
	for k := range msg.Headers {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		hdr.WriteString("\n  " + k + ": " + msg.Headers[k])
	}
	log.Printf("mail (dev, not sent) → %s\n  subject: %s%s\n  %s", msg.To, msg.Subject, hdr.String(), msg.Text)
	return nil
}

// --- templates -------------------------------------------------------------

// content is the per-message copy poured into the shared tavern-parchment
// skeleton.
type content struct {
	Preheader string // inbox preview snippet
	Intro     string // the lead paragraph (plain text; no user input)
	CTALabel  string // button text
	Link      string // the action URL
	Note      string // small print under the button (e.g. expiry)
	Footer    string // the closing line; empty = "you can safely ignore this"
	Unsub     string // a notice's way out: the unsubscribe page; empty on a transactional email
}

// renderEmail lays the content into an email-safe, table-based document —
// inline styles, ~600px, web-safe serif, a bulletproof button, a preheader,
// light color-scheme hints — dressed as a parchment card on a dark hearth.
func renderEmail(c content) string {
	link := html.EscapeString(c.Link)
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:#1a1109;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#1a1109;font-size:1px;line-height:1px;">` + html.EscapeString(c.Preheader) + `</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1a1109;">
<tr><td align="center" style="padding:32px 14px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#f5ecd6;border-radius:6px;overflow:hidden;">
    <tr><td align="center" style="padding:36px 44px 0;font-family:Georgia,'Times New Roman',serif;">
      <div style="font-size:26px;font-weight:bold;letter-spacing:4px;color:#2e1d0f;">QUEST BOARD</div>
      <div style="font-size:11px;font-style:italic;letter-spacing:3px;color:#9c7a3f;margin-top:7px;">EST. BY THE TABLE</div>
      <div style="height:1px;line-height:1px;font-size:0;background:#d8c48f;margin:22px 0 0;">&nbsp;</div>
    </td></tr>
    <tr><td style="padding:26px 44px 6px;font-family:Georgia,'Times New Roman',serif;color:#2e1d0f;font-size:15px;line-height:1.65;">` + c.Intro + `</td></tr>
    <tr><td align="center" style="padding:20px 44px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="#8b2520" style="border-radius:4px;">
          <a href="` + link + `" style="display:inline-block;padding:14px 32px;font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:bold;color:#f3e6c8;text-decoration:none;border-radius:4px;">` + html.EscapeString(c.CTALabel) + `</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:0 44px;font-family:Georgia,'Times New Roman',serif;color:#6b533a;font-size:12.5px;line-height:1.55;">
      Or paste this link into your browser:<br><a href="` + link + `" style="color:#8b2520;word-break:break-all;">` + link + `</a>
    </td></tr>
    <tr><td style="padding:12px 44px 0;font-family:Georgia,'Times New Roman',serif;color:#9c855e;font-size:12.5px;">` + html.EscapeString(c.Note) + `</td></tr>
    <tr><td style="padding:24px 44px 32px;">
      <div style="height:1px;line-height:1px;font-size:0;background:#e5d8be;margin:0 0 14px;">&nbsp;</div>
      <div style="font-family:Georgia,'Times New Roman',serif;color:#9c855e;font-size:12px;line-height:1.55;">` + html.EscapeString(footerOr(c.Footer)) + unsubRow(c.Unsub) + `</div>
    </td></tr>
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;"><tr>
    <td align="center" style="padding:16px 20px;font-family:Georgia,'Times New Roman',serif;color:#6b5333;font-size:11px;letter-spacing:1px;">Gather your party. · Quest Board</td>
  </tr></table>
</td></tr>
</table>
</body>
</html>`
}

func footerOr(s string) string {
	if s != "" {
		return s
	}
	return "If you didn't request this, you can safely ignore this email — no action is needed and nothing changes."
}

// unsubRow is the way out of a notice, on its own line under the footer.
func unsubRow(link string) string {
	if link == "" {
		return ""
	}
	return `<br><a href="` + html.EscapeString(link) + `" style="color:#8b2520;">Stop these emails</a> · or choose which ones reach you under Settings on your profile.`
}

// Notice is one notification (#316): what happened, in a line, and where it
// leads. Unsub is the page that asks before it acts; OneClick is the
// List-Unsubscribe URL a mail client may POST to without asking.
type Notice struct {
	Line     string
	Campaign string
	Link     string
	Unsub    string
	OneClick string
}

// Notification builds the email for a notice. The line is the subject and
// the lead alike, since a person skimming an inbox reads the one and not the
// other. The unsubscribe link rides both the body and the headers, because
// Resend expects it and so do people.
func Notification(n Notice) Message {
	subject := strings.TrimSuffix(n.Line, ".")
	if r := []rune(subject); len(r) > 110 {
		subject = string(r[:109]) + "…"
	}
	table := n.Campaign
	if table == "" {
		table = "your table"
	}
	htmlBody := renderEmail(content{
		Preheader: n.Line,
		Intro:     html.EscapeString(n.Line),
		CTALabel:  "Open " + table,
		Link:      n.Link,
		Note:      "You asked to be told when this happens at your tables.",
		Footer:    "Sent by Quest Board on behalf of " + table + ".",
		Unsub:     n.Unsub,
	})
	text := fmt.Sprintf("%s\n\nOpen the table:\n%s\n\nStop these emails: %s\nOr choose which ones reach you under Settings on your profile.", n.Line, n.Link, n.Unsub)
	return Message{
		Subject: subject,
		HTML:    htmlBody,
		Text:    text,
		Headers: map[string]string{
			"List-Unsubscribe":      "<" + n.OneClick + ">",
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	}
}

// TokenCreated tells the account that an API token was just minted on it
// (#294). It is the one tripwire an account signed in through a provider has,
// since re-authentication before minting cannot ask for a password it never
// set. tokenName is the user's own text and is escaped here.
func TokenCreated(tokenName, link string) (subject, htmlBody, textBody string) {
	subject = "A new API token was created on your Quest Board account"
	htmlBody = renderEmail(content{
		Preheader: "An API token was just created on your account.",
		Intro:     "An API token named <b>" + html.EscapeString(tokenName) + "</b> was just created on your account. It can act as you, within the scopes it was given, until it expires or you revoke it.",
		CTALabel:  "Review my tokens",
		Link:      link,
		Note:      "Tokens are listed under Settings on your profile, with when each was last used.",
		Footer:    "If this wasn't you, revoke the token from your profile and change your password.",
	})
	textBody = fmt.Sprintf("An API token named %q was just created on your Quest Board account. It can act as you, within the scopes it was given, until it expires or you revoke it.\n\nReview or revoke it here:\n\n%s\n\nIf this wasn't you, revoke the token and change your password.", tokenName, link)
	return
}

// WebhookDisabled tells the account that a webhook of theirs stopped (#295):
// eight deliveries in a row died, so the URL is not listening, and a dead URL
// must not be retried forever. url is the person's own text and is escaped.
func WebhookDisabled(url, link string) (subject, htmlBody, textBody string) {
	subject = "A webhook on your Quest Board account was disabled"
	htmlBody = renderEmail(content{
		Preheader: "A webhook of yours stopped answering and was switched off.",
		Intro:     "Your webhook at <b>" + html.EscapeString(url) + "</b> could not be reached eight deliveries in a row, so it has been switched off. Nothing is lost on our side — the events are still recorded — but nothing more will be sent there until you turn it back on.",
		CTALabel:  "Review my webhooks",
		Link:      link,
		Note:      "Webhooks are listed under Settings on your profile, with the last twenty deliveries and what each one answered.",
		Footer:    "If this wasn't you, remove the webhook from your profile and change your password.",
	})
	textBody = fmt.Sprintf("Your webhook at %s could not be reached eight deliveries in a row, so it has been switched off. Nothing more will be sent there until you turn it back on.\n\nReview or re-enable it here:\n\n%s\n\nIf this wasn't you, remove the webhook and change your password.", url, link)
	return
}

// VerifyEmail builds the address-confirmation message pointing at link.
func VerifyEmail(link string) (subject, htmlBody, textBody string) {
	subject = "Confirm your Quest Board email"
	htmlBody = renderEmail(content{
		Preheader: "Confirm your email to secure your account and enable password recovery.",
		Intro:     "Welcome to the table! Confirm this email to secure your account and turn on password recovery.",
		CTALabel:  "Confirm my email",
		Link:      link,
		Note:      "This link expires in 24 hours.",
	})
	textBody = fmt.Sprintf("Confirm your Quest Board email by opening this link (expires in 24 hours):\n\n%s", link)
	return
}

// ResetPassword builds the password-reset message pointing at link.
func ResetPassword(link string) (subject, htmlBody, textBody string) {
	subject = "Reset your Quest Board password"
	htmlBody = renderEmail(content{
		Preheader: "Reset your Quest Board password with the link inside.",
		Intro:     "Someone asked to reset the password for this account. If it was you, choose a new one below.",
		CTALabel:  "Set a new password",
		Link:      link,
		Note:      "This link expires in 1 hour and can be used once.",
	})
	textBody = fmt.Sprintf("Reset your Quest Board password with this link (expires in 1 hour, single use):\n\n%s", link)
	return
}
