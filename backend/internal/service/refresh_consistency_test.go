package service_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"krss/backend/internal/repository"
	"krss/backend/internal/repository/testutil"
	"krss/backend/internal/service"
	"krss/backend/pkg/network"

	"github.com/stretchr/testify/require"
)

func TestRefreshPreservesConcurrentFeedEdit(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("ETag", `"v1"`)
		fmt.Fprint(w, sampleRSS)
	}))
	defer upstream.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, feedSvc, refresh, entries := newRSSConsistencyFixture(t, upstream.Client())
	feed, _, err := feedSvc.AddWithoutFetch(ctx, upstream.URL, nil, "original", "article")
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() { done <- refresh.RefreshFeed(ctx, feed.ID) }()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("refresh did not request the feed")
	}
	_, err = feedSvc.Update(ctx, feed.ID, "edited", nil, nil)
	require.NoError(t, err)
	close(release)
	require.NoError(t, <-done)
	all, err := feedSvc.List(ctx, nil)
	require.NoError(t, err)
	require.Len(t, all, 1)
	require.Equal(t, "edited", all[0].Title)
	saved, err := entries.List(ctx, repository.EntryListFilter{FeedID: &feed.ID, Limit: 10})
	require.NoError(t, err)
	require.Len(t, saved, 1)
}

func newRSSConsistencyFixture(t *testing.T, httpClient *http.Client) (*sql.DB, service.FeedService, service.RefreshService, repository.EntryRepository) {
	t.Helper()
	db := testutil.NewTestDB(t)
	feeds := repository.NewFeedRepository(db)
	entries := repository.NewEntryRepository(db)
	client := network.NewClientFactoryForTest(httpClient)
	feedSvc := service.NewFeedService(feeds, repository.NewFolderRepository(db), entries, nil, nil, client, nil, nil)
	refresh := service.NewRefreshService(feeds, entries, nil, nil, client, nil, nil, nil)
	return db, feedSvc, refresh, entries
}

func TestRSSIngestionRollsBackAndRetries(t *testing.T) {
	for _, initial := range []bool{true, false} {
		name := "refresh"
		if initial {
			name = "add"
		}
		t.Run(name, func(t *testing.T) {
			var version atomic.Int32
			version.Store(1)
			requests := make(chan http.Header, 10)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests <- r.Header.Clone()
				v := version.Load()
				etag := fmt.Sprintf(`"v%d"`, v)
				if v != 3 {
					w.Header().Set("ETag", etag)
				}
				if v == 1 {
					w.Header().Set("Last-Modified", "Mon, 02 Jan 2006 15:04:05 GMT")
				}
				if v != 3 && r.Header.Get("If-None-Match") == etag {
					w.WriteHeader(http.StatusNotModified)
					return
				}
				fmt.Fprint(w, strings.Replace(sampleRSS, "</channel>", `<item><title>Second</title><link>https://example.com/2</link></item></channel>`, 1))
			}))
			defer upstream.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			db, feeds, refresh, entries := newRSSConsistencyFixture(t, upstream.Client())
			var id int64
			if !initial {
				feed, _, err := feeds.AddWithoutFetch(ctx, upstream.URL, nil, "", "article")
				require.NoError(t, err)
				id = feed.ID
			}
			_, err := db.ExecContext(ctx, `CREATE TRIGGER fail_second BEFORE INSERT ON entries WHEN NEW.url = 'https://example.com/2' BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END`)
			require.NoError(t, err)
			if initial {
				_, err := feeds.Add(ctx, upstream.URL, nil, "", "article")
				require.ErrorContains(t, err, "fixture write failure")
				list, err := feeds.List(ctx, nil)
				require.NoError(t, err)
				require.Empty(t, list)
			} else {
				require.ErrorContains(t, refresh.RefreshFeed(ctx, id), "fixture write failure")
				list, err := entries.List(ctx, repository.EntryListFilter{FeedID: &id, Limit: 10})
				require.NoError(t, err)
				require.Empty(t, list)
			}
			require.Empty(t, (<-requests).Get("If-None-Match"))
			_, err = db.ExecContext(ctx, `DROP TRIGGER fail_second`)
			require.NoError(t, err)
			if initial {
				feed, err := feeds.Add(ctx, upstream.URL, nil, "", "article")
				require.NoError(t, err)
				id = feed.ID
			} else {
				require.NoError(t, refresh.RefreshFeed(ctx, id))
			}
			require.Empty(t, (<-requests).Get("If-None-Match"))
			require.NoError(t, refresh.RefreshFeed(ctx, id))
			header := <-requests
			require.Equal(t, `"v1"`, header.Get("If-None-Match"))
			require.NotEmpty(t, header.Get("If-Modified-Since"))
			version.Store(3)
			require.NoError(t, refresh.RefreshFeed(ctx, id))
			<-requests
			require.NoError(t, refresh.RefreshFeed(ctx, id))
			header = <-requests
			require.Empty(t, header.Get("If-None-Match"))
			require.Empty(t, header.Get("If-Modified-Since"))
			list, err := entries.List(ctx, repository.EntryListFilter{FeedID: &id, Limit: 10})
			require.NoError(t, err)
			require.Len(t, list, 2)
		})
	}
}

func TestRefreshDiscardsResponseAfterChangingURL(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var oldRequests atomic.Int32
	newHeaders := make(chan http.Header, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/new" {
			newHeaders <- r.Header.Clone()
			fmt.Fprint(w, strings.ReplaceAll(sampleRSS, "https://example.com/1", "https://example.com/new"))
			return
		}
		w.Header().Set("ETag", `"old"`)
		w.Header().Set("Last-Modified", "Mon, 02 Jan 2006 15:04:05 GMT")
		if oldRequests.Add(1) == 1 {
			fmt.Fprint(w, strings.ReplaceAll(strings.ReplaceAll(sampleRSS, "<item>", "<ignored>"), "</item>", "</ignored>"))
			return
		}
		close(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		fmt.Fprint(w, sampleRSS)
	}))
	defer upstream.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, feeds, refresh, entries := newRSSConsistencyFixture(t, upstream.Client())
	feed, err := feeds.Add(ctx, upstream.URL+"/old", nil, "", "article")
	require.NoError(t, err)
	require.NotNil(t, feed.ETag)
	done := make(chan error, 1)
	go func() { done <- refresh.RefreshFeed(ctx, feed.ID) }()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("refresh did not request old URL")
	}
	_, err = feeds.UpdateURL(ctx, feed.ID, upstream.URL+"/new")
	require.NoError(t, err)
	close(release)
	require.Error(t, <-done)
	require.NoError(t, refresh.RefreshFeed(ctx, feed.ID))
	header := <-newHeaders
	require.Empty(t, header.Get("If-None-Match"))
	require.Empty(t, header.Get("If-Modified-Since"))
	list, err := entries.List(ctx, repository.EntryListFilter{FeedID: &feed.ID, Limit: 10})
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.NotNil(t, list[0].URL)
	require.Equal(t, "https://example.com/new", *list[0].URL)
}

func TestRefreshDiscardsStatusAfterChangingURL(t *testing.T) {
	for _, code := range []int{http.StatusNotModified, http.StatusNotFound} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			started, release := make(chan struct{}), make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/new" {
					w.WriteHeader(http.StatusGone)
					return
				}
				close(started)
				select {
				case <-release:
					w.WriteHeader(code)
				case <-r.Context().Done():
				}
			}))
			defer upstream.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			db, feeds, refresh, _ := newRSSConsistencyFixture(t, upstream.Client())
			repo := repository.NewFeedRepository(db)
			feed, _, err := feeds.AddWithoutFetch(ctx, upstream.URL+"/old", nil, "fixture", "article")
			require.NoError(t, err)
			done := make(chan error, 1)
			go func() { done <- refresh.RefreshFeed(ctx, feed.ID) }()
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatal("refresh did not request old URL")
			}
			_, err = feeds.UpdateURL(ctx, feed.ID, upstream.URL+"/new")
			require.NoError(t, err)
			require.NoError(t, refresh.RefreshFeed(ctx, feed.ID))
			close(release)
			err = <-done
			if code == http.StatusNotModified {
				require.ErrorIs(t, err, repository.ErrRSSSourceChanged)
			} else {
				require.NoError(t, err)
			}
			got, err := repo.GetByID(ctx, feed.ID)
			require.NoError(t, err)
			require.NotNil(t, got.ErrorMessage)
			require.Equal(t, "HTTP 410", *got.ErrorMessage)
			require.EqualValues(t, 1, got.RefreshFailCount)
		})
	}
}
