package network

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"time"
)

var ErrNonPublicAddress = errors.New("non-public destination is not allowed")

var publicIPv6 = netip.MustParsePrefix("2000::/3")

var specialUsePrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

func isPublicIP(ip netip.Addr) bool {
	if ip.Zone() != "" {
		return false
	}
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || (ip.Is6() && !publicIPv6.Contains(ip)) {
		return false
	}
	for _, prefix := range specialUsePrefixes {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

// CheckPublicIPLiteral rejects non-public IP literals without resolving hostnames.
// Name resolution and address enforcement happen together in the dialer.
func CheckPublicIPLiteral(host string) error {
	if ip, err := netip.ParseAddr(host); err == nil && !isPublicIP(ip) {
		return ErrNonPublicAddress
	}
	return nil
}

// NewPublicHTTPClient is a direct-only client for untrusted media URLs.
// Forward proxies would resolve the target independently of this dialer's checks.
func (f *ClientFactory) NewPublicHTTPClient(ctx context.Context, timeout time.Duration) *http.Client {
	if f.testHTTPClient != nil {
		client := *f.testHTTPClient
		return &client
	}
	stack := f.getIPStack(ctx)
	return &http.Client{
		Timeout: timeout,
		Transport: newOneShotTransport(func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialPublic(ctx, network, addr, stack)
		}, nil),
	}
}

func dialPublic(ctx context.Context, network, addr, stack string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("destination has no IP addresses")
	}
	for _, ip := range ips {
		if !isPublicIP(ip) {
			return nil, ErrNonPublicAddress
		}
	}
	ordered := ips
	if stack == "ipv4" || stack == "ipv6" {
		ordered = make([]netip.Addr, 0, len(ips))
		for _, preferred := range []bool{true, false} {
			for _, ip := range ips {
				if (ip.Unmap().Is4() == (stack == "ipv4")) == preferred {
					ordered = append(ordered, ip)
				}
			}
		}
	}
	// Dial only numeric addresses from this lookup; retain the URL hostname
	// in net/http so Host, TLS server name and certificate checks stay intact.
	d := net.Dialer{Timeout: 3 * time.Second}
	for _, ip := range ordered {
		conn, dialErr := d.DialContext(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
		if dialErr == nil {
			return conn, nil
		}
		err = dialErr
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, fmt.Errorf("dial public destination: %w", err)
}
