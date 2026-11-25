package db_test

import (
	"context"
	"crypto/sha256"
	"fmt"
	"testing"

	"krss/backend/internal/db"
	"krss/backend/internal/repository"
	"krss/backend/internal/repository/testutil"
	"krss/backend/internal/service"

	"github.com/stretchr/testify/require"
)

func TestMigrateMCPOutboundTokenPreservesClientCredential(t *testing.T) {
	conn := testutil.NewTestDB(t)
	ctx := context.Background()
	settings := repository.NewSettingsRepository(conn)
	legacy := service.MCPTokenPrefix + "fixture-legacy-token"
	const prefix = "krss_mcp_fixture-"
	require.NoError(t, settings.SetMany(ctx, map[string]string{
		"mcp.outbound_token":        legacy,
		"mcp.outbound_token_hash":   fmt.Sprintf("%x", sha256.Sum256([]byte("older-token"))),
		"mcp.outbound_token_prefix": prefix,
	}))
	for range 2 {
		require.NoError(t, db.Migrate(conn))
		plain, err := settings.Get(ctx, "mcp.outbound_token")
		require.NoError(t, err)
		require.Nil(t, plain)
		hash, err := settings.Get(ctx, "mcp.outbound_token_hash")
		require.NoError(t, err)
		require.NotNil(t, hash)
		require.Equal(t, fmt.Sprintf("%x", sha256.Sum256([]byte(legacy))), hash.Value)
		storedPrefix, err := settings.Get(ctx, "mcp.outbound_token_prefix")
		require.NoError(t, err)
		require.NotNil(t, storedPrefix)
		require.Equal(t, prefix, storedPrefix.Value)
		outbound := service.NewMCPOutboundService(settings, nil, nil, nil)
		require.True(t, outbound.Authorize(ctx, legacy))
		require.False(t, outbound.Authorize(ctx, "older-token"))
	}
}
