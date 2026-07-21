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

// renderFoggedImage returns image bytes with everything outside the revealed
// circles blacked out. Content type is preserved (JPEG stays JPEG, PNG stays
// PNG). With no circles the whole image comes back black.
func renderFoggedImage(raw []byte, contentType string, circles []circleGeom) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	out := image.NewRGBA(b)
	draw.Draw(out, b, image.NewUniform(color.RGBA{A: 255}), image.Point{}, draw.Src)

	fw := float64(b.Dx())
	fh := float64(b.Dy())
	for _, c := range circles {
		cx := c.X * fw
		cy := c.Y * fh
		cr := c.R * fw
		if cr <= 0 {
			continue
		}
		cr2 := cr * cr
		// Walk only the circle's bounding box, copying source pixels inside it.
		minX := clampInt(b.Min.X+int(cx-cr), b.Min.X, b.Max.X)
		maxX := clampInt(b.Min.X+int(cx+cr)+1, b.Min.X, b.Max.X)
		minY := clampInt(b.Min.Y+int(cy-cr), b.Min.Y, b.Max.Y)
		maxY := clampInt(b.Min.Y+int(cy+cr)+1, b.Min.Y, b.Max.Y)
		for py := minY; py < maxY; py++ {
			dy := float64(py-b.Min.Y) - cy
			for px := minX; px < maxX; px++ {
				dx := float64(px-b.Min.X) - cx
				if dx*dx+dy*dy <= cr2 {
					out.Set(px, py, src.At(px, py))
				}
			}
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
