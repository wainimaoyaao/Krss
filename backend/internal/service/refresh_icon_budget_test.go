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
// 十几秒（实测受控源单轮 10.4–12.3 秒，与条目数无关）。这条用例钉住「它有预算」：
// 图标服务一直不返回，刷新仍必须在预算量级内结束，且结果照常记账。
func TestRefreshDoesNotWaitForeverForIcons(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockFeeds := mock.NewMockFeedRepository(ctrl)
	mockEntries := mock.NewMockEntryRepository(ctrl)
	mockIcons := servicemock.NewMockIconService(ctrl)

	feed := model.Feed{ID: 7, URL: "https://example.com/rss", Title: "NoIcon"}
	mockFeeds.EXPECT().List(gomock.Any(), (*int64)(nil)).Return([]model.Feed{feed}, nil)
	mockFeeds.EXPECT().UpdateRSSRefreshStatus(gomock.Any(), int64(7), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	mockFeeds.EXPECT().IngestRSS(gomock.Any(), gomock.Any(), false, gomock.Any()).DoAndReturn(
		func(_ context.Context, f model.Feed, _ bool, save func(repository.EntryRepository, int64) error) (model.Feed, error) {
			return f, nil
		},
	)

	// 图标服务：睡到 context 结束（模拟「favicon、首页、Google、DuckDuckGo 全不可达」）
	started := make(chan struct{}, 1)
	mockIcons.EXPECT().FetchAndSaveIconForFeed(gomock.Any(), int64(7), gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, _ int64, _ string, _ string) (string, error) {
			select {
			case started <- struct{}{}:
			default:
			}
			<-ctx.Done()
			return "", ctx.Err()
		},
	)

	client := &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(sampleRSS)),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})}

	svc := service.NewRefreshService(mockFeeds, mockEntries, nil, mockIcons, network.NewClientFactoryForTest(client), nil, nil, nil)

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

	// 预算用尽不该算刷新失败（Error 是字符串，空串即没失败）
	require.Equal(t, "", svc.LastRefreshResults()[0].Error)
}
