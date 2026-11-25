package db_test

import (
	"database/sql"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	_ "modernc.org/sqlite"

	"krss/backend/internal/db"

	"github.com/stretchr/testify/require"
)

func TestOpen(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "krss-db-test")
	require.NoError(t, err)
	defer os.RemoveAll(tempDir)

	dbPath := filepath.Join(tempDir, "test.db")
	database, err := db.Open(dbPath)
	require.NoError(t, err)
	require.NotNil(t, database)
	defer database.Close()

	// Verify table exists (basic check)
	var name string
	err = database.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='feeds'").Scan(&name)
	require.NoError(t, err)
	require.Equal(t, "feeds", name)
}

func TestBuildDSN(t *testing.T) {
	dsn := db.BuildDSN("test.db")
	require.Contains(t, dsn, "file:test.db")
	require.Contains(t, dsn, "journal_mode")
	require.Contains(t, dsn, "WAL")
	require.Contains(t, dsn, "foreign_keys")
	require.Contains(t, dsn, "ON")
}

// TestBuildDSN_ContainsBusyTimeout tests the BUG fix:
// Pragmas must be embedded in DSN to ensure all connections in the pool have them.
// Without busy_timeout in DSN, concurrent refreshes would cause "database is locked" errors.
// See: fix: Concurrent refresh SQLite lock issue
func TestBuildDSN_ContainsBusyTimeout(t *testing.T) {
	dsn := db.BuildDSN("test.db")

	// busy_timeout is critical for concurrent access
	require.Contains(t, dsn, "busy_timeout", "DSN must contain busy_timeout for concurrent access")
	require.Contains(t, dsn, "30000", "busy_timeout should be set to 30000ms")

	// synchronous is also important for performance
	require.Contains(t, dsn, "synchronous", "DSN must contain synchronous pragma")
	require.Contains(t, dsn, "NORMAL", "synchronous should be set to NORMAL")
}

// TestBuildDSN_AllPragmasInDSN verifies all required pragmas are embedded in DSN.
// This is essential because pragmas applied via Exec only affect the current connection,
// not other connections in the pool.
func TestBuildDSN_AllPragmasInDSN(t *testing.T) {
	dsn := db.BuildDSN("mydb.sqlite")

	// URL decode for easier verification
	decodedDSN, err := url.QueryUnescape(dsn)
	require.NoError(t, err)

	expectedPragmas := []string{
		"journal_mode(WAL)",
		"foreign_keys(ON)",
		"busy_timeout(30000)",
		"synchronous(NORMAL)",
	}

	for _, pragma := range expectedPragmas {
		require.Contains(t, decodedDSN, pragma, "DSN must contain pragma: "+pragma)
	}
}

func TestMigrate_ClosedDB(t *testing.T) {
	database, err := sql.Open("sqlite", "file::memory:?cache=shared")
	require.NoError(t, err)
	require.NoError(t, database.Close())

	err = db.Migrate(database)
	require.Error(t, err)
}

// S5：数据目录和库文件不该让同机其它用户读到。
func TestOpenCreatesPrivateDataDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 只有只读位，权限断言没有意义")
	}
	root := t.TempDir()
	dbPath := filepath.Join(root, "nested", "deeper", "krss.db")

	database, err := db.Open(dbPath)
	require.NoError(t, err)
	defer database.Close()

	for _, dir := range []string{filepath.Join(root, "nested"), filepath.Join(root, "nested", "deeper")} {
		info, err := os.Stat(dir)
		require.NoError(t, err)
		require.Equal(t, os.FileMode(0o700), info.Mode().Perm(), "新建的数据目录应为 0700: %s", dir)
	}

	info, err := os.Stat(dbPath)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0o600), info.Mode().Perm(), "库文件应为 0600")
}

// S5：已经跑过的部署，目录/库文件原先按 0755/umask 建 —— 打开时收紧。
func TestOpenTightensExistingLoosePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 只有只读位，权限断言没有意义")
	}
	root := t.TempDir()
	dir := filepath.Join(root, "data")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.Chmod(dir, 0o755))
	dbPath := filepath.Join(dir, "krss.db")

	database, err := db.Open(dbPath)
	require.NoError(t, err)
	defer database.Close()

	dirInfo, err := os.Stat(dir)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0o700), dirInfo.Mode().Perm(), "已存在的宽目录应被收紧到 0700")

	fileInfo, err := os.Stat(dbPath)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0o600), fileInfo.Mode().Perm(), "库文件应被收紧到 0600")

	// WAL 伴随文件跟着一起收紧（存在才断言）
	for _, suffix := range []string{"-wal", "-shm"} {
		info, err := os.Stat(dbPath + suffix)
		if err != nil {
			continue
		}
		require.Equal(t, os.FileMode(0o600), info.Mode().Perm(), "%s 应被收紧到 0600", suffix)
	}
}
