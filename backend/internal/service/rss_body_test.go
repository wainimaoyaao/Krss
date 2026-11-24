package service_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"krss/backend/internal/repository"
	"krss/backend/internal/service"
)

func TestRSSDecodedBodyLimit(t *testing.T) {
	const limit = 8 << 20
	pad := func(n int) string { return sampleRSS + strings.Repeat(" ", n-len(sampleRSS)) }
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	_, err := writer.Write([]byte(pad(limit + 1)))
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	require.Less(t, compressed.Len(), limit)
	atLimit := pad(limit)
	var stage atomic.Int32
	var requests atomic.Int32
	var conditional atomic.Value
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		conditional.Store([2]string{r.Header.Get("If-None-Match"), r.Header.Get("If-Modified-Since")})
		switch stage.Load() {
		case 0:
			if r.URL.Path == "/exact" {
				_, _ = w.Write([]byte(atLimit))
				return
			}
			fallthrough
		case 2:
			w.Header().Set("ETag", `"oversized"`)
			w.Header().Set("Last-Modified", "Wed, 03 Jan 2024 00:00:00 GMT")
			w.Header().Set("Content-Encoding", "gzip")
			_, _ = w.Write(compressed.Bytes())
		case 4:
			w.WriteHeader(http.StatusServiceUnavailable)
			stage.Store(2)
		case 1:
			w.Header().Set("ETag", `"v1"`)
			w.Header().Set("Last-Modified", "Mon, 01 Jan 2024 00:00:00 GMT")
			_, _ = w.Write([]byte(sampleRSS))
		default:
			w.Header().Set("ETag", `"v2"`)
			_, _ = w.Write([]byte(strings.ReplaceAll(sampleRSS, "https://example.com/1", "https://example.com/2")))
		}
	}))
	defer upstream.Close()

	ctx := context.Background()
	db, feeds, refresh, entries := newRSSConsistencyFixture(t, upstream.Client())
	_, err = feeds.Preview(ctx, upstream.URL+"/exact")
	require.NoError(t, err)
	_, err = feeds.Preview(ctx, upstream.URL)
	require.ErrorIs(t, err, service.ErrFeedBodyTooLarge)
	_, err = feeds.Add(ctx, upstream.URL, nil, "", "article")
	require.ErrorIs(t, err, service.ErrFeedBodyTooLarge)
	list, err := feeds.List(ctx, nil)
	require.NoError(t, err)
	require.Empty(t, list)

	stage.Store(1)
	feed, err := feeds.Add(ctx, upstream.URL, nil, "", "article")
	require.NoError(t, err)
	stage.Store(2)
	before := requests.Load()
	require.ErrorIs(t, refresh.RefreshFeed(ctx, feed.ID), service.ErrFeedBodyTooLarge)
	require.Equal(t, before+1, requests.Load(), "oversize is not retried")
	stage.Store(4)
	before = requests.Load()
	require.ErrorIs(t, refresh.RefreshFeed(ctx, feed.ID), service.ErrFeedBodyTooLarge)
	require.Equal(t, before+2, requests.Load(), "the response after a 503 retry is capped too")
	stored, err := repository.NewFeedRepository(db).GetByID(ctx, feed.ID)
	require.NoError(t, err)
	require.Equal(t, feed.ETag, stored.ETag)
	require.Equal(t, feed.LastModified, stored.LastModified)
	require.NotNil(t, stored.ErrorMessage)
	require.Contains(t, *stored.ErrorMessage, "8 MiB")
	filter := repository.EntryListFilter{FeedID: &feed.ID, Limit: 10}
	rows, err := entries.List(ctx, filter)
	require.NoError(t, err)
	require.Len(t, rows, 1)

	stage.Store(3)
	require.NoError(t, refresh.RefreshFeed(ctx, feed.ID))
	require.Equal(t, [2]string{`"v1"`, "Mon, 01 Jan 2024 00:00:00 GMT"}, conditional.Load())
	rows, err = entries.List(ctx, filter)
	require.NoError(t, err)
	require.Len(t, rows, 2)
}
