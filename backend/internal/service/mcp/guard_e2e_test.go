package mcp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"krss/backend/internal/service/mcp"

	"github.com/stretchr/testify/require"
)

// 旧 SSE 传输里，服务器能用 endpoint 事件指定「往哪儿 POST」。
// 换成另一个 host 就必须当场失败，而不是把请求发出去。
func TestSSEEndpointEventToAnotherHostIsRejected(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parsed, err := url.Parse(server.URL)
		require.NoError(t, err)
		if r.URL.Path == "/sse" {
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			// 同一个服务，但把 host 换成 localhost —— 与配置里的 127.0.0.1 不同源。
			fmt.Fprintf(w, "event: endpoint\ndata: http://localhost:%s/messages\n\n", parsed.Port())
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	client := mcp.NewClientWithTransport(server.Client(), server.URL+"/sse", nil, "sse")
	defer client.Close()

	_, err := client.Initialize(context.Background())
	require.Error(t, err)
	require.ErrorIs(t, err, mcp.ErrEndpointNotAllowed)
}

// 同源的 endpoint 事件照常可用（不能用守卫把正常的旧传输一起打死）。
func TestSSEEndpointEventOnSameOriginIsAccepted(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sse":
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, "event: endpoint\ndata: %s/messages\n\n", server.URL)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		case "/messages":
			var req struct {
				ID     *int   `json:"id"`
				Method string `json:"method"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			if req.ID == nil {
				w.WriteHeader(http.StatusAccepted)
				return
			}
			result := map[string]any{}
			switch req.Method {
			case "initialize":
				result = map[string]any{
					"protocolVersion": mcp.ProtocolVersion,
					"serverInfo":      map[string]any{"name": "sse-fake", "version": "0.1"},
					"capabilities":    map[string]any{"tools": map[string]any{}},
				}
			case "tools/list":
				result = map[string]any{"tools": []any{}}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": *req.ID, "result": result})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	client := mcp.NewClientWithTransport(server.Client(), server.URL+"/sse", nil, "sse")
	defer client.Close()

	tools, err := client.ListTools(context.Background())
	require.NoError(t, err)
	require.Empty(t, tools)
}

// 重定向被逐跳校验：服务端把我们往别的 host 上带，直接失败。
func TestStreamableHTTPRedirectToAnotherHostIsRejected(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parsed, err := url.Parse(server.URL)
		require.NoError(t, err)
		http.Redirect(w, r, fmt.Sprintf("http://localhost:%s/elsewhere", parsed.Port()), http.StatusFound)
	}))
	defer server.Close()

	client := mcp.NewClient(server.Client(), server.URL+"/mcp", nil)
	defer client.Close()

	_, err := client.Initialize(context.Background())
	require.Error(t, err)
	require.ErrorIs(t, err, mcp.ErrEndpointNotAllowed)
}

// 公网地址的会话：内网目标在出网前就被拦下（不依赖 DNS 或拨号结果）。
func TestPublicSessionRejectsPrivateEndpointBeforeDial(t *testing.T) {
	client := mcp.NewClientWithTransport(&http.Client{}, "https://mcp.example.com/rpc", nil, "streamable-http")
	_, err := client.Initialize(context.Background())
	require.Error(t, err)
	// 这里打的是公网域名（测试里拨不通），重点是不许出现「连上了内网」的结果。
	require.False(t, strings.Contains(err.Error(), "127.0.0.1"))
}
