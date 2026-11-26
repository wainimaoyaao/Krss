package mcp_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"krss/backend/internal/service/mcp"

	"github.com/stretchr/testify/require"
)

// 公网服务器：任何地址都不许落到回环/私网/保留段上。
func TestEndpointGuard_PublicBaseRejectsPrivateTargets(t *testing.T) {
	guard := mcp.NewEndpointGuard("https://mcp.example.com/rpc")
	require.False(t, guard.BaseLocal())

	for _, raw := range []string{
		"http://127.0.0.1:6379/",
		"http://169.254.169.254/latest/meta-data/",
		"https://10.0.0.5/admin",
		"https://192.168.1.1/",
		"https://[::1]/",
		"http://localhost:8080/api",
	} {
		require.ErrorIs(t, guard.CheckURL(raw), mcp.ErrEndpointNotAllowed, raw)
	}

	// 公网 https 地址照常放行（授权服务器换个域名是正常形态）。
	require.NoError(t, guard.CheckURL("https://auth.example.net/token"))
	// 只允许 http/https。
	require.ErrorIs(t, guard.CheckURL("file:///etc/passwd"), mcp.ErrEndpointScheme)
	require.ErrorIs(t, guard.CheckURL("ftp://example.com/"), mcp.ErrEndpointScheme)
}

// https 的服务器不许被降级成 http。
func TestEndpointGuard_RejectsSchemeDowngrade(t *testing.T) {
	guard := mcp.NewEndpointGuard("https://mcp.example.com/rpc")
	require.ErrorIs(t, guard.CheckURL("http://mcp.example.com/rpc"), mcp.ErrEndpointNotAllowed)
}

// 本机/内网的自建服务：只许留在自己那个 host 上。
func TestEndpointGuard_LocalBaseStaysOnItsOwnHost(t *testing.T) {
	guard := mcp.NewEndpointGuard("http://127.0.0.1:8080/mcp")
	require.True(t, guard.BaseLocal())

	require.NoError(t, guard.CheckURL("http://127.0.0.1:8080/mcp/messages"))
	require.NoError(t, guard.CheckURL("http://127.0.0.1:9/other-port"))
	require.ErrorIs(t, guard.CheckURL("http://10.0.0.5/mcp"), mcp.ErrEndpointNotAllowed)
	require.ErrorIs(t, guard.CheckURL("http://127.0.0.2/mcp"), mcp.ErrEndpointNotAllowed)
}

// SSE 的 endpoint 事件由对方指定「往哪儿 POST」：必须与配置地址同源。
func TestEndpointGuard_EndpointEventMustMatchOrigin(t *testing.T) {
	guard := mcp.NewEndpointGuard("http://127.0.0.1:8080/sse")
	require.NoError(t, guard.CheckEndpointEvent("http://127.0.0.1:8080/messages?sessionId=1"))
	require.ErrorIs(t, guard.CheckEndpointEvent("http://127.0.0.1:8081/messages"), mcp.ErrEndpointNotAllowed)
	require.ErrorIs(t, guard.CheckEndpointEvent("http://169.254.169.254/latest"), mcp.ErrEndpointNotAllowed)

	public := mcp.NewEndpointGuard("https://mcp.example.com/sse")
	require.NoError(t, public.CheckEndpointEvent("https://mcp.example.com/messages?sessionId=1"))
	require.ErrorIs(t, public.CheckEndpointEvent("https://evil.example.net/messages"), mcp.ErrEndpointNotAllowed)
}

// 重定向逐跳校验：公网服务器把我们指向内网，当场就被拦下。
func TestEndpointGuard_RedirectToPrivateIsBlocked(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/metadata", http.StatusFound)
	}))
	defer redirector.Close()

	guard := mcp.NewEndpointGuard("https://mcp.example.com/rpc")
	client := guard.Client(redirector.Client())
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, redirector.URL, nil)
	require.NoError(t, err)

	_, err = client.Do(req)
	require.ErrorIs(t, err, mcp.ErrEndpointNotAllowed)
}

// 同一个 host 内的重定向（本机服务自己换路径）不受影响。
func TestEndpointGuard_RedirectWithinLocalHostIsAllowed(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/final", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	var server *httptest.Server
	mux.HandleFunc("/start", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, server.URL+"/final", http.StatusFound)
	})
	server = httptest.NewServer(mux)
	defer server.Close()

	guard := mcp.NewEndpointGuard(server.URL + "/mcp")
	client := guard.Client(server.Client())
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL+"/start", nil)
	require.NoError(t, err)

	resp, err := client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
}

// 守卫不许改动调用方传进来的 client（只返回副本）。
func TestEndpointGuard_DoesNotMutateCallerClient(t *testing.T) {
	base := &http.Client{}
	guard := mcp.NewEndpointGuard("https://mcp.example.com/rpc")
	wrapped := guard.Client(base)
	require.NotSame(t, base, wrapped)
	require.Nil(t, base.CheckRedirect)
	require.NotNil(t, wrapped.CheckRedirect)

	// 配置地址解析不出 host 时守卫放行，让真实连接错误原样报出来。
	broken := mcp.NewEndpointGuard("")
	require.NoError(t, broken.CheckURL("http://127.0.0.1:8080/mcp"))
}

// 转向后的错误要是可判定的类型（service 层按它给出提示）。
func TestEndpointGuard_ErrorsAreClassifiable(t *testing.T) {
	guard := mcp.NewEndpointGuard("https://mcp.example.com/rpc")
	err := guard.CheckURL("http://127.0.0.1/")
	require.True(t, errors.Is(err, mcp.ErrEndpointNotAllowed))
}

// DNS rebinding：名字在「校验那一刻」是公网、在「拨号那一刻」解析到内网。
// 拨号器把解析与拨号收在一处，只按校验过的 IP 拨，这种名字根本拨不出去。
func TestEndpointGuard_DialerRejectsRebindingToLoopback(t *testing.T) {
	guard := mcp.NewEndpointGuard("https://mcp.example.com/rpc")
	client := guard.Client(&http.Client{Transport: &http.Transport{}})

	// localhost 在上游是合法地址（公网 base 允许任意公网域名），
	// 但它解析到回环地址 —— 必须在拨号阶段被拒。
	transport, ok := client.Transport.(*http.Transport)
	require.True(t, ok, "客户端应挂上加固过的传输")
	require.NotNil(t, transport.DialContext, "直连传输必须换成守卫拨号器")

	_, err := transport.DialContext(context.Background(), "tcp", "localhost:9")
	require.ErrorIs(t, err, mcp.ErrEndpointNotAllowed)
}

// 自建服务的会话要连本机，守卫拨号器不能把这条正常路径也拦掉。
func TestEndpointGuard_DialerKeepsLocalBaseWorking(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	guard := mcp.NewEndpointGuard(upstream.URL + "/mcp")
	require.True(t, guard.BaseLocal())
	client := guard.Client(&http.Client{Transport: &http.Transport{}})
	transport, ok := client.Transport.(*http.Transport)
	require.True(t, ok)
	require.NotNil(t, transport.DialContext)

	conn, err := transport.DialContext(context.Background(), "tcp", strings.TrimPrefix(upstream.URL, "http://"))
	require.NoError(t, err)
	require.NoError(t, conn.Close())

	// 换一个主机名就该被拒（同上游 CheckURL 的口径）。
	_, err = transport.DialContext(context.Background(), "tcp", "example.org:80")
	require.ErrorIs(t, err, mcp.ErrEndpointNotAllowed)
}

// 走前向代理的传输没法在 Krss 侧校验解析结果（解析发生在代理侧），
// 这时原样保留传输，不做「看似加固」的替换。
func TestEndpointGuard_LeavesProxiedTransportAlone(t *testing.T) {
	proxied := &http.Transport{Proxy: func(*http.Request) (*url.URL, error) {
		return url.Parse("http://127.0.0.1:7890")
	}}
	guard := mcp.NewEndpointGuard("https://mcp.example.com/rpc")
	client := guard.Client(&http.Client{Transport: proxied})
	require.Same(t, proxied, client.Transport)
}
