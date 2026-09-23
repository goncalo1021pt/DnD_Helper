package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/oasdiff/yaml"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/static"
	"github.com/goncalo1021pt/questboard/backend/internal/version"
)

/*
The API documents itself (#348).

The contract compiled into the binary (`embedded-spec`) is served at
/api/openapi.json and /api/openapi.yaml, and /api/docs is one page that reads
it. Every operation's description opens with the scope a token needs — or
"session only" — derived here, at serve time, from the same security
declaration scopeGate reads, so the reference can never disagree with a 403
and nobody maintains a second list. The guide at the top of the page is
docs/API.md, spliced into info.description by the bundler.

All three doors are public: a script author reads the sign before they hold a
key, and the code is public anyway.
*/

var spec struct {
	once sync.Once
	json []byte
	yaml []byte
	err  error
}

func buildSpec() {
	doc, err := api.GetSwagger()
	if err != nil {
		spec.err = err
		return
	}
	// The contract served is the one this binary runs, so it carries the
	// build's version rather than the placeholder authored in the index.
	doc.Info.Version = version.Current
	for _, item := range doc.Paths.Map() {
		for _, op := range item.Operations() {
			op.Description = strings.TrimSpace(scopeLine(op) + "\n\n" + op.Description)
		}
	}
	if spec.json, spec.err = doc.MarshalJSON(); spec.err != nil {
		return
	}
	spec.yaml, spec.err = yaml.JSONToYAML(spec.json)
}

// scopeLine reads an operation's declaration the way scopeGate does: a
// bearerToken requirement names the scope a token needs; anything else
// (sessionCookie alone, or the index's fail-closed default) is session-only.
func scopeLine(op *openapi3.Operation) string {
	if op.Security != nil {
		for _, req := range *op.Security {
			if scopes, ok := req["bearerToken"]; ok && len(scopes) > 0 {
				return "**Token scope:** `" + strings.Join(scopes, "`, `") + "`"
			}
		}
	}
	return "**Session only** — a token cannot reach this door."
}

func serveSpec(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		spec.once.Do(buildSpec)
		if spec.err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "the contract could not be read"})
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		switch kind {
		case "yaml":
			w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
			_, _ = w.Write(spec.yaml)
		default:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(spec.json)
		}
	}
}

// serveDocs is the reference page: a second Vite entry (frontend/api-docs.html)
// embedded beside the SPA, mounted here under /api so the SPA fallback never
// answers it with the app shell.
var serveDocs = static.Page("api-docs.html")
