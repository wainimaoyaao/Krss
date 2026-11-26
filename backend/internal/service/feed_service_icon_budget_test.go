package service_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
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

// iconAddFixture 是「添加订阅 + 图标抓取」这一组用例共用的骨架：
// 一个受控 HTTP 源、三个仓储 mock、一个图标服务 mock。
type iconAddFixture struct {
	ctrl       *gomock.Controller
	feeds      *mock.MockFeedRepository
	entries    *mock.MockEntryRepository
	icons      *servicemock.MockIconService
	svc        service.FeedService
	iconCalls  atomic.Int32
	iconStart  chan struct{}
	savedIcons chan string
}

const iconAddFeedURL = "https://example.com/rss"

func newIconAddFixture(t *testing.T) *iconAddFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	t.Cleanup(ctrl.Finish)

	feeds := mock.NewMockFeedRepository(ctrl)
	folders := mock.NewMockFolderRepository(ctrl)
	entries := mock.NewMockEntryRepository(ctrl)
	icons := servicemock.NewMockIconService(ctrl)

	client := &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(sampleRSS)),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})}

	feeds.EXPECT().FindByURL(gomock.Any(), iconAddFeedURL).Return(nil, nil)
	feeds.EXPECT().IngestRSS(gomock.Any(), gomock.Any(), true, gomock.Any()).DoAndReturn(
		func(_ context.Context, feed model.Feed, _ bool, save func(repository.EntryRepository, int64) error) (model.Feed, error) {
			feed.ID = 4242
			return feed, save(entries, feed.ID)
		},
	)
	entries.EXPECT().CreateOrUpdate(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	savedIcons := make(chan string, 8)
	// 规则引擎、折叠等旁路不在这条用例的观察范围
	feeds.EXPECT().UpdateIconPath(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ int64, iconPath string) error {
			select {
			case savedIcons <- iconPath:
			default:
			}
			return nil
		},
	).AnyTimes()

	f := &iconAddFixture{
		ctrl:       ctrl,
		feeds:      feeds,
		entries:    entries,
		icons:      icons,
		iconStart:  make(chan struct{}, 8),
		savedIcons: savedIcons,
	}
	f.svc = service.NewFeedService(feeds, folders, entries, icons, nil, network.NewClientFactoryForTest(client), nil, nil)
	return f
}

// blockFirstIconCall 让第一次图标调用一直睡到 context 结束（模拟「站点没有 favicon、
// 后面两档兜底也出不去网」），之后的调用立刻按 next 返回 —— 第二次就是后台补齐那次。
func (f *iconAddFixture) blockFirstIconCall(t *testing.T, nextPath string, nextErr error) {
	t.Helper()
	f.icons.EXPECT().FetchAndSaveIconForFeed(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, _ int64, _ string, _ string) (string, error) {
			call := f.iconCalls.Add(1)
			select {
			case f.iconStart <- struct{}{}:
			default:
			}
			if call > 1 {
				return nextPath, nextErr
			}
			<-ctx.Done()
			return "", ctx.Err()
		},
	).AnyTimes()
}

// 添加订阅时用户正在对话框里等。站点没有图标时，图标阶梯每一档都耗到超时，实测 10.31 秒。
// 这条用例钉住：预算到点就必须放行，不能把「添加订阅」拖成十几秒。
func TestAddFeedDoesNotWaitForeverForIcons(t *testing.T) {
	f := newIconAddFixture(t)
	f.blockFirstIconCall(t, "", context.Canceled)

	started := time.Now()
	feed, err := f.svc.Add(context.Background(), iconAddFeedURL, nil, "", "article")
	elapsed := time.Since(started)

	require.NoError(t, err)
	require.Equal(t, int64(4242), feed.ID)
	require.Nil(t, feed.IconPath, "预算用尽时先不给图标，交给后台补")
	require.Less(t, elapsed, 6*time.Second, "添加订阅不能被图标抓取拖住")

	select {
	case <-f.iconStart:
	default:
		t.Fatal("图标服务没被调用")
	}

	// 后台补齐那次会立刻返回（这里让它报「没有图标」），等它跑完再结束用例，
	// 免得 goroutine 越过 ctrl.Finish()。
	require.Eventually(t, func() bool { return f.iconCalls.Load() >= 2 }, 5*time.Second, 20*time.Millisecond,
		"预算用尽后应排一次后台补齐")
}

// 预算用尽只是「先放行」，图标不该丢：后台那次抓到了要写回订阅。
func TestAddFeedBackfillsIconAfterBudget(t *testing.T) {
	f := newIconAddFixture(t)
	f.blockFirstIconCall(t, "/icons/4242.png", nil)

	feed, err := f.svc.Add(context.Background(), iconAddFeedURL, nil, "", "article")
	require.NoError(t, err)
	require.Nil(t, feed.IconPath)

	require.Eventually(t, func() bool {
		select {
		case path := <-f.savedIcons:
			require.Equal(t, "/icons/4242.png", path)
			return true
		default:
			return false
		}
	}, 5*time.Second, 20*time.Millisecond, "后台补齐成功后要写回订阅图标")
}

// 抓得到就别多此一举：预算内的正常路径维持原样（当场写回 + 返回里就带图标）。
func TestAddFeedSavesIconWithinBudget(t *testing.T) {
	f := newIconAddFixture(t)
	f.icons.EXPECT().FetchAndSaveIconForFeed(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return("/icons/fast.png", nil).Times(1)

	feed, err := f.svc.Add(context.Background(), iconAddFeedURL, nil, "", "article")
	require.NoError(t, err)
	require.NotNil(t, feed.IconPath)
	require.Equal(t, "/icons/fast.png", *feed.IconPath)
	require.Equal(t, int32(0), f.iconCalls.Load(), "走的是不带 ctx 计数的直通分支")
}
