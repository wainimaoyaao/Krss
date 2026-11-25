package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"krss/backend/internal/db"
	"krss/backend/internal/hashutil"
	"krss/backend/internal/model"
	"krss/backend/internal/repository"
	"krss/backend/pkg/snowflake"
)

// B9：entries_fts 从来没人查（搜索走 LIKE），但每条新条目都要多写一次 FTS 行。
// 迁移 40 把它连同两条同步触发器一起删掉；这里钉住「删了之后一切照旧」。
func TestUnusedFTSIsRemoved(t *testing.T) {
	dir := t.TempDir()
	database, err := db.Open(dir + "/krss.db")
	require.NoError(t, err)
	defer database.Close()

	// 表没了
	var name string
	err = database.QueryRow(`SELECT name FROM sqlite_master WHERE name = 'entries_fts'`).Scan(&name)
	require.Error(t, err, "entries_fts 应该已经被删掉")

	// 触发器也没了（否则插入会因为「表不存在」直接失败）
	var trigger string
	err = database.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('entries_ai','entries_ad')`).Scan(&trigger)
	require.Error(t, err, "entries_ai / entries_ad 应该已经被删掉")

	require.NoError(t, snowflake.Init(1))
	_, err = database.Exec(`INSERT INTO feeds (id, title, url, created_at, updated_at) VALUES (1, 'f', 'https://example.com/rss', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	require.NoError(t, err)

	repo := repository.NewEntryRepository(database)
	ctx := context.Background()
	content := "今天黄金不错，附一段 English text。"
	published := time.Now().Add(-time.Hour)
	require.NoError(t, repo.CreateOrUpdate(ctx, model.Entry{
		ID: snowflake.NextID(), FeedID: 1, Hash: hashutil.SHA256Hex(content),
		Title: strptr("黄金行情"), URL: strptr("https://example.com/1"),
		Content: strptr(content), Author: strptr("作者"), PublishedAt: &published,
	}))

	// 搜索照常（中文子串命中）
	hits, err := repo.Search(ctx, "黄金", 30)
	require.NoError(t, err)
	require.Len(t, hits, 1)
	require.Equal(t, "黄金行情", *hits[0].Title)

	// 删除照常（触发器没了也不该报错）：删掉订阅里的条目，搜索变空
	_, err = database.Exec(`DELETE FROM entries WHERE feed_id = 1`)
	require.NoError(t, err)
	hits, err = repo.Search(ctx, "黄金", 30)
	require.NoError(t, err)
	require.Empty(t, hits)

	// 迁移可重跑
	require.NoError(t, db.Migrate(database))
}

func strptr(s string) *string { return &s }
