// Package mail sends the transactional emails for local accounts — address
// verification and password recovery — through Resend. When no API key is
// configured (local development) it falls back to logging the message and its
// link, so the flows are fully testable without a real mail provider.
package mail

import (
	"context"
	"fmt"
	"html"
	"log"

	"github.com/resend/resend-go/v3"
)

// Mailer sends one transactional email. Implementations must be safe for
// concurrent use.
type Mailer interface {
	Send(ctx context.Context, to, subject, htmlBody, textBody string) error
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

func (m *resendMailer) Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	_, err := m.client.Emails.SendWithContext(ctx, &resend.SendEmailRequest{
		From:    m.from,
		To:      []string{to},
		Subject: subject,
		Html:    htmlBody,
		Text:    textBody,
	})
	return err
}

// logMailer prints what would have been sent — enough to follow a link during
// local development.
type logMailer struct{}

func (m *logMailer) Send(_ context.Context, to, subject, _, textBody string) error {
	log.Printf("mail (dev, not sent) → %s\n  subject: %s\n  %s", to, subject, textBody)
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
      <div style="font-family:Georgia,'Times New Roman',serif;color:#9c855e;font-size:12px;line-height:1.55;">If you didn't request this, you can safely ignore this email — no action is needed and nothing changes.</div>
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
