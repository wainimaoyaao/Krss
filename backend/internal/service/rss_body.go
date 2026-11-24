package service

import (
	"errors"
	"io"
)

const maxRSSBodyBytes = 8 << 20 // 8 MiB per response, after HTTP decompression.

// ErrFeedBodyTooLarge identifies an upstream RSS response exceeding the read budget.
var ErrFeedBodyTooLarge = errors.New("RSS response exceeds the 8 MiB decoded body limit")

// readRSSBody reads from the HTTP client's already-decoded response stream.
// Read one extra byte to distinguish an exact fit from an oversized response.
func readRSSBody(body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, maxRSSBodyBytes+1))
	if len(data) > maxRSSBodyBytes {
		return nil, ErrFeedBodyTooLarge
	}
	if err != nil {
		return nil, err
	}
	return data, nil
}

func feedBodyReadError(err error) error {
	if errors.Is(err, ErrFeedBodyTooLarge) {
		return err
	}
	return ErrFeedFetch
}
