package http

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// solidPNG builds a w×h opaque image of a single colour, PNG-encoded.
func solidPNG(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode source png: %v", err)
	}
	return buf.Bytes()
}

func decodePNG(t *testing.T, raw []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("decode fogged png: %v", err)
	}
	return img
}

func isBlack(c color.Color) bool {
	r, g, b, _ := c.RGBA()
	return r == 0 && g == 0 && b == 0
}

func TestRenderFoggedImage(t *testing.T) {
	src := color.RGBA{R: 20, G: 200, B: 120, A: 255}
	raw := solidPNG(t, 100, 100, src)

	t.Run("reveals inside the circle and blacks out the rest", func(t *testing.T) {
		out, err := renderFoggedImage(raw, "image/png", []circleGeom{{X: 0.5, Y: 0.5, R: 0.2}})
		if err != nil {
			t.Fatalf("renderFoggedImage: %v", err)
		}
		img := decodePNG(t, out)

		// Centre is inside the revealed circle -> original colour.
		if r, g, b, _ := img.At(50, 50).RGBA(); r>>8 != 20 || g>>8 != 200 || b>>8 != 120 {
			t.Errorf("centre pixel = (%d,%d,%d); want source colour (revealed)", r>>8, g>>8, b>>8)
		}
		// A far corner is outside every circle -> opaque black (must not leak).
		if !isBlack(img.At(0, 0)) {
			t.Error("corner pixel is not black — hidden ground leaked through the fog")
		}
		if !isBlack(img.At(99, 99)) {
			t.Error("opposite corner leaked through the fog")
		}
	})

	t.Run("no circles blacks out the whole image", func(t *testing.T) {
		out, err := renderFoggedImage(raw, "image/png", nil)
		if err != nil {
			t.Fatalf("renderFoggedImage: %v", err)
		}
		img := decodePNG(t, out)
		if !isBlack(img.At(50, 50)) {
			t.Error("with no reveals the centre must be black")
		}
	})

	t.Run("feathers the rim instead of cutting it hard", func(t *testing.T) {
		out, err := renderFoggedImage(raw, "image/png", []circleGeom{{X: 0.5, Y: 0.5, R: 0.2}})
		if err != nil {
			t.Fatalf("renderFoggedImage: %v", err)
		}
		img := decodePNG(t, out)

		// 16px from a 20px-radius circle's centre sits inside the feather band
		// (inner edge at 62% of the radius, i.e. 12.4px) — it should be dimmed
		// toward black, not the full source colour and not pure black.
		r, g, b, _ := img.At(66, 50).RGBA()
		r8, g8, b8 := r>>8, g>>8, b>>8
		if r8 == 20 && g8 == 200 && b8 == 120 {
			t.Error("rim pixel is full brightness — the feather has no effect")
		}
		if r8 == 0 && g8 == 0 && b8 == 0 {
			t.Error("rim pixel is pure black — the reveal has a hard edge, not a feather")
		}
	})

	t.Run("zero-radius circle reveals nothing", func(t *testing.T) {
		out, err := renderFoggedImage(raw, "image/png", []circleGeom{{X: 0.5, Y: 0.5, R: 0}})
		if err != nil {
			t.Fatalf("renderFoggedImage: %v", err)
		}
		if !isBlack(decodePNG(t, out).At(50, 50)) {
			t.Error("a zero-radius reveal must not expose any pixels")
		}
	})

	t.Run("rejects undecodable input", func(t *testing.T) {
		if _, err := renderFoggedImage([]byte("not an image"), "image/png", nil); err == nil {
			t.Error("expected an error decoding garbage input")
		}
	})
}

func TestFogVersion(t *testing.T) {
	a := []circleGeom{{X: 0.1, Y: 0.2, R: 0.3}, {X: 0.4, Y: 0.5, R: 0.6}}
	reordered := []circleGeom{{X: 0.4, Y: 0.5, R: 0.6}, {X: 0.1, Y: 0.2, R: 0.3}}

	if fogVersion(a) != fogVersion(reordered) {
		t.Error("fogVersion must be order-independent")
	}
	if fogVersion(a) == fogVersion(nil) {
		t.Error("a non-empty reveal set must not share the empty fingerprint")
	}
	moved := []circleGeom{{X: 0.1, Y: 0.2, R: 0.3}, {X: 0.4, Y: 0.5, R: 0.61}}
	if fogVersion(a) == fogVersion(moved) {
		t.Error("changing a radius must change the fingerprint")
	}
	if fogVersion(nil) != fogVersion([]circleGeom{}) {
		t.Error("nil and empty reveal sets should fingerprint the same")
	}
}

func TestClampInt(t *testing.T) {
	tests := []struct{ v, lo, hi, want int }{
		{5, 0, 10, 5},
		{-3, 0, 10, 0},
		{42, 0, 10, 10},
		{0, 0, 10, 0},
		{10, 0, 10, 10},
	}
	for _, tc := range tests {
		if got := clampInt(tc.v, tc.lo, tc.hi); got != tc.want {
			t.Errorf("clampInt(%d,%d,%d) = %d; want %d", tc.v, tc.lo, tc.hi, got, tc.want)
		}
	}
}
