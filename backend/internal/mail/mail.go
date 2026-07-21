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

const wrap = `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#2e1d0f">
  <h1 style="font-size:22px;margin:0 0 6px">Quest Board</h1>
  <p style="color:#6b533a;margin:0 0 22px;font-style:italic">est. by the table</p>
  %s
  <hr style="border:none;border-top:1px solid #e5d8be;margin:26px 0 14px">
  <p style="font-size:12px;color:#9c855e">If you didn't request this, you can safely ignore this email.</p>
</div>`

// VerifyEmail builds the address-confirmation message pointing at link.
func VerifyEmail(link string) (subject, htmlBody, textBody string) {
	subject = "Confirm your Quest Board email"
	body := fmt.Sprintf(`<p>Welcome to the table! Confirm this email to secure your account and enable password recovery.</p>
  <p style="margin:24px 0"><a href="%s" style="background:#8b2520;color:#f3e6c8;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold">Confirm my email</a></p>
  <p style="font-size:13px;color:#6b533a">Or paste this link into your browser:<br><a href="%s" style="color:#8b2520">%s</a></p>
  <p style="font-size:13px;color:#9c855e">This link expires in 24 hours.</p>`,
		html.EscapeString(link), html.EscapeString(link), html.EscapeString(link))
	htmlBody = fmt.Sprintf(wrap, body)
	textBody = fmt.Sprintf("Confirm your Quest Board email by opening this link (expires in 24 hours):\n\n%s", link)
	return
}

// ResetPassword builds the password-reset message pointing at link.
func ResetPassword(link string) (subject, htmlBody, textBody string) {
	subject = "Reset your Quest Board password"
	body := fmt.Sprintf(`<p>Someone asked to reset the password for this account. If it was you, choose a new one:</p>
  <p style="margin:24px 0"><a href="%s" style="background:#8b2520;color:#f3e6c8;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold">Set a new password</a></p>
  <p style="font-size:13px;color:#6b533a">Or paste this link into your browser:<br><a href="%s" style="color:#8b2520">%s</a></p>
  <p style="font-size:13px;color:#9c855e">This link expires in 1 hour and can be used once.</p>`,
		html.EscapeString(link), html.EscapeString(link), html.EscapeString(link))
	htmlBody = fmt.Sprintf(wrap, body)
	textBody = fmt.Sprintf("Reset your Quest Board password with this link (expires in 1 hour, single use):\n\n%s", link)
	return
}
