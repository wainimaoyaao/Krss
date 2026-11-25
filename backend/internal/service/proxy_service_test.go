package service_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"krss/backend/internal/service"
	"krss/backend/internal/service/anubis"
	"krss/backend/pkg/network"

	"github.com/stretchr/testify/require"
)

var testPNGData = []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}

// The injected test transport may reach local fixtures; the production dialer never does.
func localFixtureURL(server *httptest.Server) string {
	return strings.Replace(server.URL, "127.0.0.1", "localhost", 1)
}

func TestBuildReferer(t *testing.T) {
	parsed, _ := http.NewRequest(http.MethodGet, "https://example.com/img.png", nil)
	referer := service.BuildReferer("https://example.com/article?id=1", parsed.URL)
	require.Equal(t, "https://example.com/", referer)

	referer = service.BuildReferer("http://[::1", parsed.URL)
	require.Equal(t, "https://example.com/", referer)
}

func TestProxyService_FetchImage_InvalidURL(t *testing.T) {
	clientFactory := network.NewClientFactoryForTest(&http.Client{})
	svc := service.NewProxyService(clientFactory, nil)

	_, err := svc.FetchImage(context.Background(), "://invalid", "")
	require.ErrorIs(t, err, service.ErrInvalidURL)
}

func TestProxyService_FetchImage_InvalidProtocol(t *testing.T) {
	clientFactory := network.NewClientFactoryForTest(&http.Client{})
	svc := service.NewProxyService(clientFactory, nil)

	_, err := svc.FetchImage(context.Background(), "ftp://example.com/a.png", "")
	require.ErrorIs(t, err, service.ErrInvalidProtocol)
}

func TestProxyService_FetchImage_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(testPNGData)
	}))
	defer server.Close()

	clientFactory := network.NewClientFactoryForTest(&http.Client{})
	svc := service.NewProxyService(clientFactory, nil)

	result, err := svc.FetchImage(context.Background(), localFixtureURL(server)+"/img.png", "")
	require.NoError(t, err)
	require.Equal(t, "image/png", result.ContentType)
	require.Equal(t, testPNGData, result.Data)
}

func TestProxyService_FetchImage_InvalidImage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data"))
	}))
	defer server.Close()

	clientFactory := network.NewClientFactoryForTest(&http.Client{})
	svc := service.NewProxyService(clientFactory, nil)

	_, err := svc.FetchImage(context.Background(), localFixtureURL(server)+"/img.png", "")
	require.ErrorIs(t, err, service.ErrInvalidImage)
}

func TestProxyService_FetchImage_SVG(t *testing.T) {
	svgData := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		_, _ = w.Write(svgData)
	}))
	defer server.Close()

	clientFactory := network.NewClientFactoryForTest(&http.Client{})
	svc := service.NewProxyService(clientFactory, nil)

	result, err := svc.FetchImage(context.Background(), localFixtureURL(server)+"/img.svg", "")
	require.NoError(t, err)
	require.Equal(t, "image/svg+xml", result.ContentType)
	require.Equal(t, svgData, result.Data)
}

func TestProxyService_FetchImage_SVGWithLongPrefixFallback(t *testing.T) {
	svgData := []byte(`<?xml version="1.0"?><!DOCTYPE svg><!-- ` + strings.Repeat("prefix", 700) + ` --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/xml")
		_, _ = w.Write(svgData)
	}))
	defer server.Close()

	clientFactory := network.NewClientFactoryForTest(&http.Client{})
	svc := service.NewProxyService(clientFactory, nil)

	result, err := svc.FetchImage(context.Background(), localFixtureURL(server)+"/img.svg", "")
	require.NoError(t, err)
	require.Equal(t, "image/svg+xml", result.ContentType)
	require.Equal(t, svgData, result.Data)
}

func TestProxyService_FetchImage_UpstreamRejected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<script id="anubis_challenge" type="application/json">null</script>`))
	}))
	defer server.Close()

	clientFactory := network.NewClientFactoryForTest(&http.Client{})
	anubisSolver := anubis.NewSolver(clientFactory, nil)
	svc := service.NewProxyService(clientFactory, anubisSolver)

	_, err := svc.FetchImage(context.Background(), localFixtureURL(server)+"/img.png", "")
	require.ErrorIs(t, err, service.ErrUpstreamRejected)
}

func TestProxyService_Close(t *testing.T) {
	clientFactory := network.NewClientFactoryForTest(&http.Client{})
	svc := service.NewProxyService(clientFactory, nil)
	svc.Close()
}

func TestProxyService_RejectsNonPublicRedirect(t *testing.T) {
	const target = "http://192.0.2.1/image.png"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target, http.StatusFound)
	}))
	defer server.Close()

	svc := service.NewProxyService(network.NewClientFactoryForTest(server.Client()), nil)
	_, err := svc.FetchMedia(context.Background(), localFixtureURL(server), "", "")
	require.ErrorIs(t, err, service.ErrPrivateNetwork)
}

func TestProxyService_RejectsNonPublicDestinations(t *testing.T) {
	svc := service.NewProxyService(network.NewClientFactory(nil, nil), nil)
	for _, host := range []string{"localhost", "127.0.0.1", "[::1]", "[::ffff:127.0.0.1]", "169.254.169.254"} {
		t.Run(host, func(t *testing.T) {
			_, err := svc.FetchMedia(context.Background(), "http://"+host+"/image.png", "", "")
			require.ErrorIs(t, err, service.ErrPrivateNetwork)
		})
	}
}
