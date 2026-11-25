//go:generate mockgen -source=$GOFILE -destination=mock/$GOFILE -package=mock
package service

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"

	"krss/backend/internal/config"
	"krss/backend/internal/service/anubis"
	"krss/backend/pkg/logger"
	"krss/backend/pkg/network"
)

const proxyTimeout = 30 * time.Second

// maxProxyMediaBytes 单次代理回传的上限（视频可能几十 MB，别把内存吃爆）
const maxProxyMediaBytes = 64 << 20

var (
	ErrPrivateNetwork   = network.ErrNonPublicAddress
	ErrInvalidURL       = fmt.Errorf("invalid URL")
	ErrInvalidProtocol  = fmt.Errorf("invalid protocol")
	ErrRequestTimeout   = fmt.Errorf("request timeout")
	ErrFetchFailed      = fmt.Errorf("fetch failed")
	ErrUpstreamRejected = fmt.Errorf("upstream rejected")
	ErrInvalidImage     = fmt.Errorf("invalid image")
)

type ProxyResult struct {
	Data        []byte
	ContentType string
	// StatusCode 上游返回的状态码（206 表示这是 Range 请求的片段）
	StatusCode int
	// ContentRange / AcceptRanges 透传给浏览器，<video> 拖动进度条要用
	ContentRange string
	AcceptRanges string
}

type ProxyService interface {
	FetchImage(ctx context.Context, imageURL, refererURL string) (*ProxyResult, error)
	// WithMediaCache 开启代理媒体磁盘缓存（50-2）。dir 为空则不缓存（测试/未配置时）。
	WithMediaCache(dir string, maxBytes int64) ProxyService
	// MediaCacheStats 当前缓存的文件数与总字节（没开缓存时全 0）。
	MediaCacheStats() (files int, bytes int64)
	// FetchMedia 与 FetchImage 同一条管线，但额外支持音视频类型与 Range 请求
	// （正文里的 <video> 走代理，见 frontend/src/components/ui/article-video.tsx）
	FetchMedia(ctx context.Context, mediaURL, refererURL, rangeHeader string) (*ProxyResult, error)
	Close()
}

type proxyService struct {
	clientFactory *network.ClientFactory
	anubis        AnubisSolver
	// mediaCache 代理媒体（图片/音视频）的磁盘缓存：没有它每次都要重新出网取
	// （实测同一张图连取三遍 0.708 / 0.967 / 0.669 s，一点没快）
	mediaCache *mediaCache
}

func NewProxyService(clientFactory *network.ClientFactory, anubisSolver AnubisSolver) ProxyService {
	return &proxyService{
		clientFactory: clientFactory,
		anubis:        anubisSolver,
	}
}

func (s *proxyService) Close() {
	// No persistent resources to release
}

func (s *proxyService) FetchImage(ctx context.Context, imageURL, refererURL string) (*ProxyResult, error) {
	return s.FetchMedia(ctx, imageURL, refererURL, "")
}

func (s *proxyService) FetchMedia(ctx context.Context, mediaURL, refererURL, rangeHeader string) (*ProxyResult, error) {
	if _, err := parseMediaURL(mediaURL); err != nil {
		return nil, err
	}
	// 隔离旧缓存：旧版本可能缓存了未受出站限制的内容。
	cacheKey := "public-media-v1:" + mediaURL
	cacheable := rangeHeader == "" && s.mediaCache != nil
	if cacheable {
		if hit, ok := s.mediaCache.Get(cacheKey); ok {
			return hit, nil
		}
	}
	result, err := s.fetchWithStandardClient(ctx, mediaURL, refererURL, rangeHeader)
	if err == nil && cacheable && result.StatusCode == http.StatusOK {
		s.mediaCache.Put(cacheKey, result)
	}
	return result, err
}

// WithMediaCache 挂上磁盘缓存（dir 空则不启用）。
func (s *proxyService) WithMediaCache(dir string, maxBytes int64) ProxyService {
	if dir == "" {
		return s
	}
	s.mediaCache = newMediaCache(dir, maxBytes)
	return s
}

// MediaCacheStats 当前缓存规模（排查/测试用）。
func (s *proxyService) MediaCacheStats() (int, int64) {
	return s.mediaCache.Stats()
}

func parseMediaURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, ErrInvalidURL
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, ErrInvalidProtocol
	}
	if u.Hostname() == "" || u.User != nil {
		return nil, ErrInvalidURL
	}
	return u, network.CheckPublicIPLiteral(u.Hostname())
}

func (s *proxyService) fetchWithStandardClient(ctx context.Context, imageURL, refererURL, rangeHeader string) (*ProxyResult, error) {
	parsedURL, err := parseMediaURL(imageURL)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, ErrInvalidURL
	}
	setProxyImageHeaders(req.Header, refererURL, parsedURL)

	if cachedCookie := getCachedAnubisCookie(ctx, s.anubis, parsedURL.Host, req.Header); cachedCookie != "" {
		req.Header.Set("Cookie", cachedCookie)
	}

	client := s.clientFactory.NewPublicHTTPClient(ctx, proxyTimeout)
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != via[0].URL.Scheme || req.URL.Host != via[0].URL.Host {
			req.Header.Del("Cookie")
		}
		_, err := parseMediaURL(req.URL.String())
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrFetchFailed, err)
	}
	defer resp.Body.Close()

	// 200 整段、206 片段都算成功（<video> 会带 Range 请求）
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return nil, fmt.Errorf("%w: %d", ErrFetchFailed, resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxProxyMediaBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrFetchFailed, err)
	}
	if len(data) > maxProxyMediaBytes {
		return nil, fmt.Errorf("%w: response too large", ErrFetchFailed)
	}

	// 不启动不受本客户端约束的 Anubis challenge 出站请求。
	if s.anubis != nil && anubis.IsAnubisPage(data) {
		return nil, ErrUpstreamRejected
	}
	contentType, err := detectProxyMediaContentType(resp.Header.Get("Content-Type"), data)
	if err != nil {
		logger.Debug("proxy standard client got unsupported media", "module", "service", "action", "fetch", "resource", "proxy", "result", "failed", "host", parsedURL.Host, "error", err)
		return nil, err
	}

	statusCode := resp.StatusCode
	contentRange := resp.Header.Get("Content-Range")
	if statusCode == http.StatusOK && rangeHeader != "" {
		// 上游没理 Range（很常见）：我们在代理层把片段切出来并回 206，
		// 否则浏览器认为不可跳转，<video> 进度条一拖就弹回
		sliced, derivedRange, derivedStatus := sliceByRange(data, rangeHeader)
		if derivedStatus == http.StatusPartialContent {
			data = sliced
			contentRange = derivedRange
			statusCode = derivedStatus
		}
	}

	return &ProxyResult{
		Data:         data,
		ContentType:  contentType,
		StatusCode:   statusCode,
		ContentRange: contentRange,
		AcceptRanges: "bytes",
	}, nil
}

// setProxyImageHeaders 给标准客户端设置与 azuretls 那条路一致的取图请求头
func setProxyImageHeaders(header http.Header, refererURL string, parsedURL *url.URL) {
	header.Set("accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	header.Set("accept-language", "zh-CN,zh;q=0.9")
	header.Set("referer", buildReferer(refererURL, parsedURL))
	header.Set("sec-ch-ua", config.ChromeSecChUa)
	header.Set("sec-ch-ua-mobile", "?0")
	header.Set("sec-ch-ua-platform", `"Windows"`)
	header.Set("sec-fetch-dest", "image")
	header.Set("sec-fetch-mode", "no-cors")
	header.Set("sec-fetch-site", "cross-site")
	header.Set("user-agent", config.ChromeUserAgent)
}

// detectProxyMediaContentType 判定代理回来的东西能不能直接回给浏览器：
// 图片照旧，另外放行 video/* 与 audio/*（正文里的 <video> 走的就是这条代理）。
// header 优先（视频类型按内容嗅探不一定准），判定不出来再看内容。
func detectProxyMediaContentType(header string, data []byte) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(strings.Split(header, ";")[0]))
	if isProxyableMediaType(normalized) {
		return normalized, nil
	}

	contentType, err := detectProxyImageContentType(data)
	if err == nil {
		return contentType, nil
	}

	mtype := strings.ToLower(mimetype.Detect(data).String())
	if isProxyableMediaType(mtype) {
		return mtype, nil
	}

	return "", fmt.Errorf("%w: %s", ErrInvalidImage, mtype)
}

func isProxyableMediaType(contentType string) bool {
	return strings.HasPrefix(contentType, "image/") ||
		strings.HasPrefix(contentType, "video/") ||
		strings.HasPrefix(contentType, "audio/")
}

func detectProxyImageContentType(data []byte) (string, error) {
	mtype := mimetype.Detect(data)
	contentType := strings.ToLower(mtype.String())
	if strings.HasPrefix(contentType, "image/") {
		return contentType, nil
	}
	if isSVGDocument(data) {
		return "image/svg+xml", nil
	}
	return "", fmt.Errorf("%w: %s", ErrInvalidImage, contentType)
}

func isSVGDocument(data []byte) bool {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	for {
		token, err := decoder.Token()
		if err != nil {
			return false
		}
		if start, ok := token.(xml.StartElement); ok {
			return strings.EqualFold(start.Name.Local, "svg")
		}
	}
}

// buildReferer constructs the Referer header value
func buildReferer(refererURL string, parsedURL *url.URL) string {
	if refererURL != "" {
		if parsed, err := url.Parse(refererURL); err == nil {
			return parsed.Scheme + "://" + parsed.Host + "/"
		}
	}
	return parsedURL.Scheme + "://" + parsedURL.Host + "/"
}
