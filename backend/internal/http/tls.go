package http

import "net/http"

// hstsMaxAge is one year, the baseline recommended by MDN and hstspreload.org.
const hstsValue = "max-age=31536000; includeSubDomains"

// enforceTLS redirects plain-HTTP requests to HTTPS and stamps HSTS on secure
// responses. TLS terminates at the Cloudflare edge, so the original scheme only
// reaches us via X-Forwarded-Proto; Cloudflare always sets it. Requests without
// the header (direct LAN access on :8080, the Vite dev proxy) pass through
// untouched, which keeps local development working without an APP_ENV switch.
func enforceTLS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("X-Forwarded-Proto") {
		case "https":
			w.Header().Set("Strict-Transport-Security", hstsValue)
		case "http":
			target := "https://" + r.Host + r.URL.RequestURI()
			status := http.StatusMovedPermanently
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				status = http.StatusPermanentRedirect // 308 keeps the method and body
			}
			http.Redirect(w, r, target, status)
			return
		}
		next.ServeHTTP(w, r)
	})
}
