package mcp

// 出向端点守卫（S3）：一个 MCP 服务的地址是用户填的，但它**回给我们的地址**不是。
// 恶意或写坏的 MCP 服务可以借 endpoint 事件、重定向、OAuth 元数据把 Krss 指到
// 内网服务或云元数据端点（169.254.169.254）。这里把「这次会话能打到哪儿」收紧成两条：
//
//  1. 配置里的地址本身就是本机/内网（自建 MCP 很常见）→ 只许留在同一个 host 上，
//     不许跳到别的 host，也不许换协议；本地开发照常可用。
//  2. 配置里的是公网地址 → 任何地址都不许落在回环/私网/链路本地/保留段上，
//     且 https 的服务器不许被降级成 http。
//
// 重定向逐跳校验（CheckRedirect）；SSE 的 endpoint 事件必须与配置地址同源。

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"

	"krss/backend/pkg/network"
)

var (
	// ErrEndpointNotAllowed 目标地址被守卫拒绝（内网/回环/保留段/跨 host）。
	ErrEndpointNotAllowed = errors.New("mcp endpoint is not allowed")
	// ErrEndpointScheme 目标地址协议不合法（只允许 http/https）。
	ErrEndpointScheme = errors.New("mcp endpoint must use http or https")
)

// EndpointGuard 一个 MCP 会话的出向约束（由配置里的服务器地址决定）。
type EndpointGuard struct {
	base      *url.URL
	baseLocal bool
	// invalid 记下配置地址解析失败的情况：这种会话本来也连不上，
	// 守卫保持放行，让真正的连接错误原样报出来，而不是变成一句「地址不允许」。
	invalid bool
}

// NewEndpointGuard 按配置里的服务器地址建守卫。
func NewEndpointGuard(endpoint string) *EndpointGuard {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Host == "" {
		return &EndpointGuard{base: &url.URL{}, invalid: true}
	}
	return &EndpointGuard{base: parsed, baseLocal: isLocalHost(parsed.Hostname())}
}

// BaseLocal 配置里的地址是不是本机/内网。
func (g *EndpointGuard) BaseLocal() bool {
	if g == nil {
		return false
	}
	return g.baseLocal
}

// CheckURL 校验一个要出网的地址（工具调用、SSE POST 地址、OAuth 端点都用它）。
func (g *EndpointGuard) CheckURL(raw string) error {
	if g == nil || g.invalid {
		return nil
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("%w: %q 不是合法地址", ErrEndpointNotAllowed, raw)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("%w: %q", ErrEndpointScheme, parsed.Scheme)
	}
	if parsed.Host == "" {
		return fmt.Errorf("%w: %q 缺主机名", ErrEndpointNotAllowed, raw)
	}
	if strings.EqualFold(g.base.Scheme, "https") && scheme != "https" {
		return fmt.Errorf("%w: https 的服务不许降级到 %s", ErrEndpointNotAllowed, scheme)
	}
	if g.baseLocal {
		// 本机/内网的服务器：只许留在自己那个 host 上，换个 host 就是越界。
		if !strings.EqualFold(parsed.Hostname(), g.base.Hostname()) {
			return fmt.Errorf("%w: 本机服务的会话不许打到 %s", ErrEndpointNotAllowed, parsed.Hostname())
		}
		return nil
	}
	// 公网服务器：目标必须落在公网地址上（IP 字面量在这里就挡住；域名交给 TLS/解析侧）。
	return checkPublicEndpoint(parsed)
}

// CheckEndpointEvent 校验 SSE 的 endpoint 事件：旧传输里服务器能指定「往哪儿 POST」，
// 必须与配置地址同源，否则等于把整个内网交出去。
func (g *EndpointGuard) CheckEndpointEvent(raw string) error {
	if g == nil || g.invalid {
		return nil
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("%w: SSE endpoint 事件给的不是合法地址", ErrEndpointNotAllowed)
	}
	if err := g.CheckURL(raw); err != nil {
		return err
	}
	if !strings.EqualFold(parsed.Hostname(), g.base.Hostname()) || normalizePort(parsed) != normalizePort(g.base) {
		return fmt.Errorf("%w: SSE endpoint 事件指向了别的 host（%s）", ErrEndpointNotAllowed, parsed.Host)
	}
	return nil
}

// Client 给客户端挂上逐跳校验的 CheckRedirect（保留原有 Transport 与超时）。
// 返回的是副本，不改调用方传进来的那个。
func (g *EndpointGuard) Client(base *http.Client) *http.Client {
	if base == nil {
		return nil
	}
	if g == nil || g.invalid {
		return base
	}
	cloned := *base
	original := base.CheckRedirect
	cloned.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("%w: 重定向次数过多", ErrEndpointNotAllowed)
		}
		if err := g.CheckURL(req.URL.String()); err != nil {
			return err
		}
		if original != nil {
			return original(req, via)
		}
		return nil
	}
	return &cloned
}

// checkPublicEndpoint 目标必须是公网地址（IP 字面量当场判，域名留到解析）。
func checkPublicEndpoint(parsed *url.URL) error {
	host := parsed.Hostname()
	if err := network.CheckPublicIPLiteral(host); err != nil {
		return fmt.Errorf("%w: %s 不是公网地址", ErrEndpointNotAllowed, host)
	}
	if isLocalHost(host) {
		return fmt.Errorf("%w: %s 是本机地址", ErrEndpointNotAllowed, host)
	}
	return nil
}

// isLocalHost 判断 host 是不是「本机/内网」那一类。
func isLocalHost(host string) bool {
	name := strings.ToLower(strings.TrimSuffix(host, "."))
	if name == "" {
		return false
	}
	if name == "localhost" || strings.HasSuffix(name, ".localhost") || strings.HasSuffix(name, ".local") || strings.HasSuffix(name, ".internal") {
		return true
	}
	if ip := net.ParseIP(name); ip != nil {
		// 回环、私网、链路本地、未指定地址都算本地；其余公网 IP 交给细节判断。
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return true
		}
		return network.CheckPublicIPLiteral(name) != nil
	}
	return false
}

func normalizePort(u *url.URL) string {
	port := u.Port()
	if port != "" {
		return port
	}
	if strings.EqualFold(u.Scheme, "https") {
		return "443"
	}
	return "80"
}
