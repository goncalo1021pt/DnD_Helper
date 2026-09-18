package webhooks

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// Guard is the URL policy (#295). This server sits on a LAN behind a tunnel,
// and a webhook is a request it makes on somebody's say-so: without a guard
// it is a probe of its own network. In production a URL must be https and
// must not resolve to a private, loopback or link-local address — checked at
// the dial, after DNS, so a name that resolves somewhere private later
// (rebinding) is refused too. Redirects are never followed, for the same
// reason. Permissive turns all of that off for development and the e2e,
// where the receiver is a test server on the docker host.
type Guard struct {
	Permissive bool
}

// ValidateURL is the check at registration: what a person can be told about
// straight away, rather than discover from a dead delivery.
func (g Guard) ValidateURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || u.Hostname() == "" {
		return errors.New("the URL must be absolute, like https://example.com/hook")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !g.Permissive {
			return errors.New("the URL must be https")
		}
	default:
		return errors.New("the URL must be https")
	}
	if u.User != nil {
		return errors.New("the URL must not carry credentials")
	}
	if !g.Permissive {
		if ip := net.ParseIP(u.Hostname()); ip != nil && isForbidden(ip) {
			return errors.New("the URL must not point at a private or local address")
		}
		if h := strings.ToLower(u.Hostname()); h == "localhost" || strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".internal") {
			return errors.New("the URL must not point at a private or local address")
		}
	}
	return nil
}

// Client is what the worker posts with: a short deadline, no redirects, and
// the dial-time address check.
func (g Guard) Client() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	if !g.Permissive {
		dialer.Control = func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip == nil || isForbidden(ip) {
				return fmt.Errorf("refusing to connect to %s: private or local address", host)
			}
			return nil
		}
	}
	return &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			DialContext:           dialer.DialContext,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 8 * time.Second,
			MaxIdleConns:          8,
			IdleConnTimeout:       30 * time.Second,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("redirects are not followed")
		},
	}
}

// isForbidden is every range a webhook must not reach: loopback, the private
// blocks, link-local (which includes the cloud metadata address), carrier NAT,
// multicast and the unspecified address.
func isForbidden(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		// 100.64.0.0/10, carrier-grade NAT — a home router's WAN side.
		return v4[0] == 100 && v4[1]&0xc0 == 64
	}
	return false
}

// dialContext is exposed for the tests, which need the Control hook alone.
func (g Guard) dial(ctx context.Context, network, address string) (net.Conn, error) {
	return g.Client().Transport.(*http.Transport).DialContext(ctx, network, address)
}
