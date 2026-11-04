package http

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"

	xdraw "golang.org/x/image/draw"
)

/*
A handout is a picture, so reading one means showing the model the picture
(#425). An upload may be 10 MB and several thousand pixels across, which as a
tool answer is slow and past what a model reads anyway: past about 1568 px on
the long edge a vision model scales it down itself, having first been sent the
bytes. So the picture is sent as stored when it is already modest, and
otherwise shrunk here.
*/

const (
	// modelImageEdge is the long edge a model gets; handwriting on a letter
	// is still legible at this size.
	modelImageEdge = 1568
	// modelImageBytes is how large a stored picture may be and still go as is.
	modelImageBytes = 1 << 20
	// modelImagePixels bounds what is decoded to shrink, since a PNG a few
	// kilobytes long can declare a canvas of gigapixels.
	modelImagePixels = 40_000_000
)

var errImageTooBig = errors.New("the picture is too large to shrink")

// handoutImageForModel returns the picture a model should be handed and its
// type: the stored bytes when they are small enough, else a JPEG scaled to
// modelImageEdge on its long edge, flattened onto white because JPEG has no
// transparency and a letter scanned onto a clear PNG would otherwise go black.
func handoutImageForModel(raw []byte, contentType string) ([]byte, string, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, "", err
	}
	long := max(cfg.Width, cfg.Height)
	if long <= modelImageEdge && len(raw) <= modelImageBytes {
		return raw, contentType, nil
	}
	if cfg.Width*cfg.Height > modelImagePixels {
		return nil, "", errImageTooBig
	}
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "", err
	}
	w, h := cfg.Width, cfg.Height
	if long > modelImageEdge {
		w = max(1, w*modelImageEdge/long)
		h = max(1, h*modelImageEdge/long)
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Over, nil)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85}); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), "image/jpeg", nil
}
