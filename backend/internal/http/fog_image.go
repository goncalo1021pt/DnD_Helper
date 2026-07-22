package http

import (
	"bytes"
	"fmt"
	"hash/fnv"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"math"
	"sort"
	"strconv"
	"sync"

	"github.com/google/uuid"
)

// Server-side fog compositing. The client fog was only a canvas drawn over the
// full image, so a player could open the image URL and see the whole map. The
// real fix is to never send the hidden pixels: for a fogged player we render a
// copy of the image with everything outside their revealed circles painted
// opaque black, and serve that. The DM still gets the full image.

// circleGeom is a reveal circle in fractional map coordinates (radius as a
// fraction of width) — the same geometry the client canvas and the
// pin-visibility test use: a circle centered at (x*w, y*h) with radius r*w in
// pixel space.
type circleGeom struct{ X, Y, R float64 }

// revealFeather is the fraction of a circle's radius, measured inward from
// its rim, over which reveal fades from fully shown to fully fogged. Mirrors
// the client's own draft/DM veil (FogCanvas in MapPage.tsx), so the drawn
// preview and the server-rendered image the player actually receives agree.
const revealFeather = 0.38

// renderFoggedImage returns image bytes with everything outside the revealed
// circles blacked out and each circle's rim faded rather than cut hard, so
// the reveal reads as a torch's edge instead of a stencil. The fade is
// entirely inside the circle's own radius — it softens the boundary, it
// never exposes ground beyond it — so no unrevealed pixel data leaves the
// fog. Content type is preserved (JPEG stays JPEG, PNG stays PNG). With no
// circles the whole image comes back black.
func renderFoggedImage(raw []byte, contentType string, circles []circleGeom) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	out := image.NewRGBA(b)
	draw.Draw(out, b, image.NewUniform(color.RGBA{A: 255}), image.Point{}, draw.Src)

	w := b.Dx()
	fw := float64(w)
	fh := float64(b.Dy())

	// How revealed each pixel is, 0 (fogged) to 1 (fully shown). Kept
	// separate from `out` so overlapping circles take the strongest reveal
	// rather than repeatedly re-blending the same pixel.
	alpha := make([]float64, w*b.Dy())

	for _, c := range circles {
		cx := c.X * fw
		cy := c.Y * fh
		cr := c.R * fw
		if cr <= 0 {
			continue
		}
		inner := cr * (1 - revealFeather)
		// Walk only the circle's bounding box.
		minX := clampInt(b.Min.X+int(cx-cr), b.Min.X, b.Max.X)
		maxX := clampInt(b.Min.X+int(cx+cr)+1, b.Min.X, b.Max.X)
		minY := clampInt(b.Min.Y+int(cy-cr), b.Min.Y, b.Max.Y)
		maxY := clampInt(b.Min.Y+int(cy+cr)+1, b.Min.Y, b.Max.Y)
		for py := minY; py < maxY; py++ {
			dy := float64(py-b.Min.Y) - cy
			row := (py - b.Min.Y) * w
			for px := minX; px < maxX; px++ {
				dx := float64(px-b.Min.X) - cx
				d := math.Sqrt(dx*dx + dy*dy)
				if d >= cr {
					continue
				}
				a := 1.0
				if d > inner {
					a = (cr - d) / (cr - inner)
				}
				if i := row + (px - b.Min.X); a > alpha[i] {
					alpha[i] = a
				}
			}
		}
	}

	for py := b.Min.Y; py < b.Max.Y; py++ {
		row := (py - b.Min.Y) * w
		for px := b.Min.X; px < b.Max.X; px++ {
			a := alpha[row+(px-b.Min.X)]
			if a <= 0 {
				continue // stays opaque black
			}
			sr, sg, sb, _ := src.At(px, py).RGBA()
			r8, g8, b8 := uint8(sr>>8), uint8(sg>>8), uint8(sb>>8)
			if a >= 1 {
				out.Set(px, py, color.RGBA{R: r8, G: g8, B: b8, A: 255})
				continue
			}
			// Blend toward the black veil; still fully opaque, so the fade
			// never reveals anything beyond the circle's own edge.
			out.Set(px, py, color.RGBA{
				R: uint8(float64(r8) * a),
				G: uint8(float64(g8) * a),
				B: uint8(float64(b8) * a),
				A: 255,
			})
		}
	}

	var buf bytes.Buffer
	if contentType == "image/png" {
		err = png.Encode(&buf, out)
	} else {
		err = jpeg.Encode(&buf, out, &jpeg.Options{Quality: 85})
	}
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// fogVersion is a stable fingerprint of a reveal set, used for the ETag and the
// render cache key. Order-independent (circles are sorted first) so it only
// changes when the actual revealed area does.
func fogVersion(circles []circleGeom) string {
	cs := append([]circleGeom(nil), circles...)
	sort.Slice(cs, func(i, j int) bool {
		if cs[i].X != cs[j].X {
			return cs[i].X < cs[j].X
		}
		if cs[i].Y != cs[j].Y {
			return cs[i].Y < cs[j].Y
		}
		return cs[i].R < cs[j].R
	})
	h := fnv.New64a()
	for _, c := range cs {
		fmt.Fprintf(h, "%.6f,%.6f,%.6f;", c.X, c.Y, c.R)
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// fogImageCache holds the latest rendered fogged image per map. All players
// share the party pool in stage 1, so one render serves every player; it is
// re-rendered only when the reveal fingerprint changes.
type fogImageCache struct {
	mu      sync.RWMutex
	entries map[uuid.UUID]fogCacheEntry
}

type fogCacheEntry struct {
	version     string
	body        []byte
	contentType string
}

func newFogImageCache() *fogImageCache {
	return &fogImageCache{entries: make(map[uuid.UUID]fogCacheEntry)}
}

func (c *fogImageCache) get(mapID uuid.UUID, version string) (fogCacheEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[mapID]
	if ok && e.version == version {
		return e, true
	}
	return fogCacheEntry{}, false
}

func (c *fogImageCache) put(mapID uuid.UUID, e fogCacheEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[mapID] = e
}
