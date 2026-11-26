package service_test

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"krss/backend/internal/repository"
	"krss/backend/internal/service"
	"krss/backend/pkg/network"

	"github.com/stretchr/testify/require"
)

func TestEntryMedia_AddAndRefresh(t *testing.T) {
	fixture := newFilterFixture(t)
	ctx := context.Background()
	const enclosure = `<enclosure url="https://example.com/cover.jpg" length="1" type="image/jpeg"/>
	<enclosure url="https://example.com/episode.mp3" length="10" type="audio/mpeg"/>`
	const mediaRSS = `<media:group><media:content url="https://example.com/episode.mp4" type="video/mp4"/></media:group>`
	const invalid = `<enclosure url="file:///episode.mp3" length="10" type="audio/mpeg"/>`
	var attachment atomic.Value
	attachment.Store(enclosure)
	factory := network.NewClientFactoryForTest(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		body := fmt.Sprintf(`<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
		<title>Media</title><link>https://example.com/</link><description>Fixture</description>
		<item><title>Episode</title><guid isPermaLink="false">episode-1</guid><link>https://example.com/episode</link>%s</item>
		</channel></rss>`, attachment.Load().(string))
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: req}, nil
	})})
	feeds := service.NewFeedService(fixture.feeds, repository.NewFolderRepository(fixture.db), fixture.entries, nil, nil, factory, nil, fixture.service)
	refresh := service.NewRefreshService(fixture.feeds, fixture.entries, nil, nil, factory, nil, nil, fixture.service)
	feed, err := feeds.Add(ctx, "https://example.com/rss", nil, "", "audio")
	require.NoError(t, err)

	entries, err := fixture.entries.List(ctx, repository.EntryListFilter{FeedID: &feed.ID, Limit: 10})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	first := entries[0]
	require.NotNil(t, first.ThumbnailURL)
	require.Equal(t, "https://example.com/cover.jpg", *first.ThumbnailURL)
	require.NotNil(t, first.MediaURL)
	require.NotNil(t, first.MediaType)
	require.Equal(t, "https://example.com/episode.mp3", *first.MediaURL)
	require.Equal(t, "audio/mpeg", *first.MediaType)

	// Preserve the thumbnail so the second fetch differs only in attachment fields.
	attachment.Store(`<enclosure url="https://example.com/cover.jpg" length="1" type="image/jpeg"/>` + mediaRSS)
	require.NoError(t, refresh.RefreshFeed(ctx, feed.ID))
	updated, err := fixture.entries.GetByID(ctx, first.ID)
	require.NoError(t, err)
	require.NotNil(t, updated.MediaURL)
	require.NotNil(t, updated.MediaType)
	require.Equal(t, "https://example.com/episode.mp4", *updated.MediaURL)
	require.Equal(t, "video/mp4", *updated.MediaType)

	attachment.Store(invalid)
	require.NoError(t, refresh.RefreshFeed(ctx, feed.ID))
	removed, err := fixture.entries.GetByID(ctx, first.ID)
	require.NoError(t, err)
	require.Nil(t, removed.MediaURL)
	require.Nil(t, removed.MediaType)
}
