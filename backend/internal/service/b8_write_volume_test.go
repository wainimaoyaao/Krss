package service_test

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"krss/backend/internal/model"
	"krss/backend/internal/repository"
	"krss/backend/internal/repository/testutil"
	"krss/backend/internal/service"
	"krss/backend/pkg/network"

	"github.com/stretchr/testify/require"
)

// B8：内容没变的条目不该被再写一次。
//
// 改前实测：200 条未变化的源每轮刷新改 200 行、updated_at 全抖。
// 这里用真库 + 真仓储钉住三件事：没变不写、变了照写、该回填的照回填。

const b8FeedXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>B8 Feed</title>
<link>https://example.com</link>
<description>desc</description>
<item><title>First</title><link>https://example.com/1</link><guid>urn:b8:1</guid><description>Body 1</description><pubDate>Mon, 24 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Second</title><link>https://example.com/2</link><guid>urn:b8:2</guid><description>Body 2</description><pubDate>Mon, 24 Nov 2026 11:00:00 GMT</pubDate></item>
</channel></rss>`

type b8Fixture struct {
	db       *sql.DB
	svc      service.RefreshService
	feedID   int64
	feedBody string
}

func newB8Fixture(t *testing.T) *b8Fixture {
	t.Helper()
	db := testutil.NewTestDB(t)
	if _, err := db.ExecContext(context.Background(), "PRAGMA busy_timeout = 5000"); err != nil {
		t.Fatalf("set busy timeout: %v", err)
	}

	fx := &b8Fixture{db: db, feedBody: b8FeedXML}
	feeds := repository.NewFeedRepository(db)
	entries := repository.NewEntryRepository(db)

	feed, err := feeds.Create(context.Background(), model.Feed{URL: "https://example.com/rss", Title: "B8 Feed", FolderID: nil})
	require.NoError(t, err)
	fx.feedID = feed.ID

	client := &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(fx.feedBody)),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})}

	fx.svc = service.NewRefreshService(
		feeds,
		entries,
		nil,
		nil,
		network.NewClientFactoryForTest(client),
		nil,
		nil,
		nil,
	)
	return fx
}

func (f *b8Fixture) updatedAt(t *testing.T) map[string]string {
	t.Helper()
	rows, err := f.db.QueryContext(context.Background(), "SELECT url, updated_at FROM entries WHERE feed_id = ?", f.feedID)
	require.NoError(t, err)
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var url string
		var updated string
		require.NoError(t, rows.Scan(&url, &updated))
		out[url] = updated
	}
	return out
}

// 第二轮刷新：内容一模一样 → 一行都不该被改写。
func TestRefreshDoesNotRewriteUnchangedEntries(t *testing.T) {
	fx := newB8Fixture(t)
	require.NoError(t, fx.svc.RefreshAll(context.Background()))
	require.Len(t, fx.updatedAt(t), 2)

	before := fx.updatedAt(t)
	require.NoError(t, fx.svc.RefreshAll(context.Background()))
	after := fx.updatedAt(t)

	require.Equal(t, before, after, "内容没变的条目被重写了")
	results := fx.svc.LastRefreshResults()
	require.Len(t, results, 1)
	require.Equal(t, 0, results[0].New)
	require.Equal(t, 0, results[0].Updated)
}

// 内容真变了：只有那一条被写，其余不动，计数照旧。
func TestRefreshWritesOnlyChangedEntry(t *testing.T) {
	fx := newB8Fixture(t)
	require.NoError(t, fx.svc.RefreshAll(context.Background()))
	before := fx.updatedAt(t)

	fx.feedBody = strings.Replace(b8FeedXML, "<title>First</title>", "<title>First (edited)</title>", 1)
	require.NoError(t, fx.svc.RefreshAll(context.Background()))
	after := fx.updatedAt(t)

	require.NotEqual(t, before["https://example.com/1"], after["https://example.com/1"], "改过的条目没落库")
	require.Equal(t, before["https://example.com/2"], after["https://example.com/2"], "没改的条目被连带重写")

	results := fx.svc.LastRefreshResults()
	require.Len(t, results, 1)
	require.Equal(t, 0, results[0].New)
	require.Equal(t, 1, results[0].Updated)
}

// 旧行缺 published_at：跳过写入会让 COALESCE 永远补不上，所以这种必须写。
func TestRefreshBackfillsMissingPublishedAt(t *testing.T) {
	fx := newB8Fixture(t)
	require.NoError(t, fx.svc.RefreshAll(context.Background()))

	_, err := fx.db.ExecContext(context.Background(), "UPDATE entries SET published_at = NULL WHERE feed_id = ? AND url = ?", fx.feedID, "https://example.com/1")
	require.NoError(t, err)

	require.NoError(t, fx.svc.RefreshAll(context.Background()))

	var published sql.NullString
	err = fx.db.QueryRowContext(context.Background(), "SELECT published_at FROM entries WHERE feed_id = ? AND url = ?", fx.feedID, "https://example.com/1").Scan(&published)
	require.NoError(t, err)
	require.True(t, published.Valid && published.String != "", "发布时间没有被回填")

	// 内容没变，所以计数口径仍是 0（回填不算「更新」）。
	results := fx.svc.LastRefreshResults()
	require.Equal(t, 0, results[0].Updated)
}

// legacy 的 URL 派生 hash 升级：hash 不同就必须写（走原地升级），且不能多出一条。
func TestRefreshStillUpgradesLegacyHashInPlace(t *testing.T) {
	fx := newB8Fixture(t)
	require.NoError(t, fx.svc.RefreshAll(context.Background()))

	_, err := fx.db.ExecContext(context.Background(),
		"UPDATE entries SET hash = ? WHERE feed_id = ? AND url = ?",
		"legacy-url-hash", fx.feedID, "https://example.com/1")
	require.NoError(t, err)

	require.NoError(t, fx.svc.RefreshAll(context.Background()))

	var count int
	require.NoError(t, fx.db.QueryRowContext(context.Background(),
		"SELECT COUNT(*) FROM entries WHERE feed_id = ?", fx.feedID).Scan(&count))
	require.Equal(t, 2, count, "hash 升级不该多出重复条目")

	var hash string
	require.NoError(t, fx.db.QueryRowContext(context.Background(),
		fmt.Sprintf("SELECT hash FROM entries WHERE feed_id = %d AND url = 'https://example.com/1'", fx.feedID)).Scan(&hash))
	require.NotEqual(t, "legacy-url-hash", hash, "旧 hash 没被升级")
}
