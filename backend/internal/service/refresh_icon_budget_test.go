package service_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"krss/backend/internal/model"
	"krss/backend/internal/repository"
	"krss/backend/internal/repository/mock"
	"krss/backend/internal/service"
	servicemock "krss/backend/internal/service/mock"
	"krss/backend/pkg/network"
)

// 图标抓取挂在刷新轮次的收尾路径上。站点没有图标、或出网受限时，它原来会把整轮拖到
// 十几秒（实测受控源单轮 10.4–12.3 秒，与条目数无关）。这条用例钉住三件事：
// 1) 它有预算，图标服务一直不返回时刷新仍在预算量级内结束；
// 2) 预算用尽后，同一订阅同一来源的下一轮直接跳过，不再白付这份预算；
// 3) 强制刷新与「来源地址变了」都不受冷却影响 —— 用户明确要重抓、或订阅换了地址时照旧试。
func TestRefreshDoesNotWaitForeverForIcons(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockFeeds := mock.NewMockFeedRepository(ctrl)
	mockEntries := mock.NewMockEntryRepository(ctrl)
	mockIcons := servicemock.NewMockIconService(ctrl)

	feed := model.Feed{ID: 7, URL: "https://example.com/rss", Title: "NoIcon"}
	movedFeed := model.Feed{ID: 7, URL: "https://example.org/rss", Title: "NoIcon"}
	// 四轮：预算 → 冷却跳过 → 强制刷新 → 换地址
	for _, round := range []model.Feed{feed, feed, feed, movedFeed} {
		mockFeeds.EXPECT().List(gomock.Any(), (*int64)(nil)).Return([]model.Feed{round}, nil)
	}
	mockFeeds.EXPECT().UpdateRSSRefreshStatus(gomock.Any(), int64(7), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	mockFeeds.EXPECT().IngestRSS(gomock.Any(), gomock.Any(), false, gomock.Any()).DoAndReturn(
		func(_ context.Context, f model.Feed, _ bool, save func(repository.EntryRepository, int64) error) (model.Feed, error) {
			return f, nil
		},
	).Times(4)

	// 图标服务：睡到 context 结束（模拟「favicon、首页、Google、DuckDuckGo 全不可达」）
	started := make(chan struct{}, 1)
	var iconAttempts int
	mockIcons.EXPECT().FetchAndSaveIconForFeed(gomock.Any(), int64(7), gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, _ int64, _ string, _ string) (string, error) {
			iconAttempts++
			select {
			case started <- struct{}{}:
			default:
			}
			<-ctx.Done()
			return "", ctx.Err()
		},
	).Times(3)

	client := &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(sampleRSS)),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})}

	svc := service.NewRefreshService(mockFeeds, mockEntries, nil, mockIcons, network.NewClientFactoryForTest(client), nil, nil, nil)

	// 第一轮：图标服务不返回，刷新必须在预算量级内结束。
	before := time.Now()
	require.NoError(t, svc.RefreshAll(context.Background()))
	elapsed := time.Since(before)

	select {
	case <-started:
	default:
		t.Fatal("图标服务没被调用")
	}
	require.Less(t, elapsed, 6*time.Second, "图标抓取必须有预算，不能把整轮拖住")
	results := svc.LastRefreshResults()
	require.Len(t, results, 1)
	require.Empty(t, results[0].Error)
	require.Equal(t, 1, iconAttempts)

	// 第二轮：同一来源还在冷却里，条目照常入库但完全不碰图标服务。
	second := time.Now()
	require.NoError(t, svc.RefreshAll(context.Background()))
	require.Less(t, time.Since(second), time.Second, "冷却期内不该再等图标预算")
	require.Equal(t, 1, iconAttempts, "冷却期内不该调用图标服务")
	require.Empty(t, svc.LastRefreshResults()[0].Error)

	// 第三轮：强制刷新不受冷却影响。
	require.NoError(t, svc.ForceRefreshAll(context.Background()))
	require.Equal(t, 2, iconAttempts, "强制刷新应重新尝试图标")
	require.Empty(t, svc.LastRefreshResults()[0].Error)

	// 第四轮：订阅换了地址 = 来源变了，冷却作废，再试一次。
	require.NoError(t, svc.RefreshAll(context.Background()))
	require.Equal(t, 3, iconAttempts, "来源地址变了应重新尝试图标")
	require.Empty(t, svc.LastRefreshResults()[0].Error)
}
