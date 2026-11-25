package handler_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"krss/backend/internal/handler"
	"krss/backend/internal/model"
	servicemock "krss/backend/internal/service/mock"
)

// S6：OAuth 回调结果页会把请求里的 `?error=` 和上游错误串拼进 HTML。
// 这个页面由本应用同源返回，所以未转义 = 第三方站点一个链接触发本源脚本执行。
func newOAuthCallbackServer(t *testing.T) (*echo.Echo, *servicemock.MockMCPService) {
	t.Helper()
	ctrl := gomock.NewController(t)
	mcpService := servicemock.NewMockMCPService(ctrl)
	e := echo.New()
	handler.NewMCPHandler(mcpService, nil).RegisterPublicRoutes(e)
	return e, mcpService
}

func TestOAuthCallbackEscapesQueryError(t *testing.T) {
	e, _ := newOAuthCallbackServer(t)
	payload := `"><script>alert(1)</script>`

	req := httptest.NewRequest(http.MethodGet, "/api/mcp/oauth/callback?error="+urlEscape(payload), nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	body := rec.Body.String()
	require.Equal(t, http.StatusOK, rec.Code)
	require.NotContains(t, body, "<script>", "回调页把攻击者的标签原样输出了")
	require.NotContains(t, body, `"><script`, "回调页把攻击者的属性闭合原样输出了")
	require.Contains(t, body, "&lt;script&gt;", "转义后的文本应仍然可见")
	require.Contains(t, body, "MCP 授权失败")
}

func TestOAuthCallbackEscapesServiceError(t *testing.T) {
	e, mcpService := newOAuthCallbackServer(t)
	mcpService.EXPECT().
		OAuthCallback(gomock.Any(), "the-state", "the-code").
		Return(model.MCPServer{}, errString("state 不匹配 <img src=x onerror=alert(1)>"))

	req := httptest.NewRequest(http.MethodGet, "/api/mcp/oauth/callback?state=the-state&code=the-code", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	body := rec.Body.String()
	require.Equal(t, http.StatusOK, rec.Code)
	require.NotContains(t, body, "<img src=x", "上游错误串里的标签被原样输出了")
	require.Contains(t, body, "&lt;img src=x")
}

// 正常成功页不受影响（仍然是纯静态 HTML，没有 message 可注入）。
func TestOAuthCallbackSuccessPage(t *testing.T) {
	e, mcpService := newOAuthCallbackServer(t)
	mcpService.EXPECT().OAuthCallback(gomock.Any(), gomock.Any(), gomock.Any()).Return(model.MCPServer{}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/mcp/oauth/callback?state=s&code=c", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	body := rec.Body.String()
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, body, "MCP 授权成功")
	require.True(t, strings.HasPrefix(body, "<!doctype html>"))
}

func urlEscape(raw string) string {
	return strings.NewReplacer(`"`, "%22", `<`, "%3C", `>`, "%3E", " ", "%20", `'`, "%27").Replace(raw)
}

type errString string

func (e errString) Error() string { return string(e) }
