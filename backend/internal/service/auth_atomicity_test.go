package service_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"krss/backend/internal/repository"
	"krss/backend/internal/repository/testutil"
	"krss/backend/internal/service"
)

func newAuthFixture(t *testing.T) (*sql.DB, service.AuthService) {
	t.Helper()
	db := testutil.NewTestDB(t)
	if _, err := db.ExecContext(context.Background(), "PRAGMA busy_timeout = 5000"); err != nil {
		t.Fatalf("set busy timeout: %v", err)
	}
	return db, service.NewAuthService(repository.NewSettingsRepository(db))
}

func settingValue(t *testing.T, db *sql.DB, key string) string {
	t.Helper()
	var value string
	err := db.QueryRowContext(context.Background(), "SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return ""
	}
	require.NoError(t, err)
	return value
}

func TestRegisterOnlyOneConcurrentRegistrationWins(t *testing.T) {
	db, svc := newAuthFixture(t)
	ctx := context.Background()

	const attempts = 8
	var won, rejected, failed atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := svc.Register(ctx, fmt.Sprintf("user%d", i), "", "owner@example.com", "secret1")
			switch {
			case err == nil:
				won.Add(1)
			case errors.Is(err, service.ErrUserExistsHelper):
				rejected.Add(1)
			default:
				failed.Add(1)
				t.Errorf("unexpected register error: %v", err)
			}
		}(i)
	}
	wg.Wait()

	require.EqualValues(t, 1, won.Load(), "exactly one registration may succeed")
	require.EqualValues(t, attempts-1, rejected.Load(), "the rest must see an existing user")
	require.EqualValues(t, 0, failed.Load())

	username := settingValue(t, db, "user.username")
	require.NotEmpty(t, username, "the winner must be recorded")
	require.NotEmpty(t, settingValue(t, db, "user.password_hash"))
	require.NotEmpty(t, settingValue(t, db, "user.jwt_secret"))

	// The stored account must be a complete, usable one.
	login, err := svc.Login(ctx, username, "secret1")
	require.NoError(t, err)
	require.Equal(t, username, login.User.Username)
}

func TestRegisterLeavesNoPartialAccountWhenAWriteFails(t *testing.T) {
	db, svc := newAuthFixture(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `CREATE TRIGGER fail_secret BEFORE INSERT ON settings
		WHEN NEW.key = 'user.jwt_secret' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`)
	require.NoError(t, err)

	_, err = svc.Register(ctx, "alice", "", "alice@example.com", "secret1")
	require.Error(t, err)

	for _, key := range []string{"user.username", "user.nickname", "user.email", "user.password_hash", "user.jwt_secret"} {
		require.Empty(t, settingValue(t, db, key), "%s must not survive a failed registration", key)
	}
	exists, err := svc.CheckUserExists(ctx)
	require.NoError(t, err)
	require.False(t, exists)
}

func TestPasswordChangeKeepsOldCredentialsWhenSecretWriteFails(t *testing.T) {
	db, svc := newAuthFixture(t)
	ctx := context.Background()

	registered, err := svc.Register(ctx, "alice", "", "alice@example.com", "secret1")
	require.NoError(t, err)
	require.NotEmpty(t, registered.Token)

	_, err = db.ExecContext(ctx, `CREATE TRIGGER fail_secret_update BEFORE UPDATE ON settings
		WHEN NEW.key = 'user.jwt_secret' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`)
	require.NoError(t, err)

	_, err = svc.UpdateProfile(ctx, "", "", "secret1", "secret2", nil)
	require.Error(t, err)

	// Neither half of the change may be visible.
	_, err = svc.Login(ctx, "alice", "secret1")
	require.NoError(t, err, "old password must still work")
	_, err = svc.Login(ctx, "alice", "secret2")
	require.ErrorIs(t, err, service.ErrInvalidPasswordHelper)
	valid, err := svc.ValidateToken(registered.Token)
	require.NoError(t, err)
	require.True(t, valid, "the old token must survive a failed password change")

	// With the blocker gone the same change applies and both halves move together.
	_, err = db.ExecContext(ctx, "DROP TRIGGER fail_secret_update")
	require.NoError(t, err)
	updated, err := svc.UpdateProfile(ctx, "", "", "secret1", "secret2", nil)
	require.NoError(t, err)
	require.NotNil(t, updated.Token)
	_, err = svc.Login(ctx, "alice", "secret1")
	require.ErrorIs(t, err, service.ErrInvalidPasswordHelper)
	_, err = svc.Login(ctx, "alice", "secret2")
	require.NoError(t, err)
	valid, err = svc.ValidateToken(registered.Token)
	require.Error(t, err, "previously issued tokens must be rejected")
	require.False(t, valid)
}
