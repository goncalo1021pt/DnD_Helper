package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnforceTLS(t *testing.T) {
	handler := enforceTLS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	tests := []struct {
		name         string
		method       string
		proto        string // X-Forwarded-Proto; empty means header absent
		wantStatus   int
		wantLocation string
		wantHSTS     bool
	}{
		{
			name:       "https gets HSTS header",
			method:     http.MethodGet,
			proto:      "https",
			wantStatus: http.StatusOK,
			wantHSTS:   true,
		},
		{
			name:         "http GET redirects with 301",
			method:       http.MethodGet,
			proto:        "http",
			wantStatus:   http.StatusMovedPermanently,
			wantLocation: "https://dnd.example.net/api/me?x=1",
		},
		{
			name:         "http POST redirects with 308",
			method:       http.MethodPost,
			proto:        "http",
			wantStatus:   http.StatusPermanentRedirect,
			wantLocation: "https://dnd.example.net/api/me?x=1",
		},
		{
			name:       "no header passes through untouched",
			method:     http.MethodGet,
			proto:      "",
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "http://dnd.example.net/api/me?x=1", nil)
			if tt.proto != "" {
				req.Header.Set("X-Forwarded-Proto", tt.proto)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := rec.Header().Get("Location"); got != tt.wantLocation {
				t.Errorf("Location = %q, want %q", got, tt.wantLocation)
			}
			if got := rec.Header().Get("Strict-Transport-Security"); (got != "") != tt.wantHSTS {
				t.Errorf("Strict-Transport-Security = %q, wantHSTS %v", got, tt.wantHSTS)
			}
			if tt.wantHSTS && rec.Header().Get("Strict-Transport-Security") != hstsValue {
				t.Errorf("Strict-Transport-Security = %q, want %q", rec.Header().Get("Strict-Transport-Security"), hstsValue)
			}
		})
	}
}
